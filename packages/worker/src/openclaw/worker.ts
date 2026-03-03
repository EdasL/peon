#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createLogger,
  type WorkerTransport,
} from "@lobu/core";
import * as Sentry from "@sentry/node";
import { handleExecutionError } from "../core/error-handler";
import { listAppDirectories } from "../core/project-scanner";
import type {
  ProgressUpdate,
  SessionExecutionResult,
  WorkerConfig,
  WorkerExecutor,
} from "../core/types";
import { WorkspaceManager } from "../core/workspace";
import { HttpWorkerTransport } from "../gateway/gateway-integration";
import { generateCustomInstructions } from "../instructions/builder";
import {
  getApiKeyEnvVarForProvider,
  getProviderAuthHintFromError,
} from "../shared/provider-auth-hints";
import { writeOpenClawConfig, clearOpenClawSession } from "./config-bridge";
import { OpenClawCoreInstructionProvider } from "./instructions";
import {
  PROVIDER_REGISTRY_ALIASES,
  resolveModelRef,
} from "./model-resolver";
import { OpenClawWsClient, type OpenClawEvent } from "./openclaw-ws-client";
import { getOpenClawProcess } from "./openclaw-process";
import { getOpenClawSessionContext } from "./session-context";

const logger = createLogger("worker");

export class OpenClawWorker implements WorkerExecutor {
  private workspaceManager: WorkspaceManager;
  public workerTransport: WorkerTransport;
  private config: WorkerConfig;
  private wsClient: OpenClawWsClient | null = null;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.workspaceManager = new WorkspaceManager(config.workspace);

    // Verify required environment variables
    const gatewayUrl = process.env.DISPATCHER_URL;
    const workerToken = process.env.WORKER_TOKEN;

    if (!gatewayUrl || !workerToken) {
      throw new Error(
        "DISPATCHER_URL and WORKER_TOKEN environment variables are required"
      );
    }

    if (!config.teamId) {
      throw new Error("teamId is required for worker initialization");
    }
    if (!config.conversationId) {
      throw new Error("conversationId is required for worker initialization");
    }
    this.workerTransport = new HttpWorkerTransport({
      gatewayUrl,
      workerToken,
      userId: config.userId,
      channelId: config.channelId,
      conversationId: config.conversationId,
      originalMessageTs: config.responseId,
      botResponseTs: config.botResponseId,
      teamId: config.teamId,
      platform: config.platform,
    });
  }

  /**
   * Main execution workflow
   */
  async execute(): Promise<void> {
    const executeStartTime = Date.now();

    try {
      logger.info(
        `🚀 Starting OpenClaw worker for session: ${this.config.sessionKey}`
      );
      logger.info(
        `[TIMING] Worker execute() started at: ${new Date(executeStartTime).toISOString()}`
      );

      // Decode user prompt
      const userPrompt = Buffer.from(this.config.userPrompt, "base64").toString(
        "utf-8"
      );
      logger.info(`User prompt: ${userPrompt.substring(0, 100)}...`);

      // Setup workspace
      logger.info("Setting up workspace...");

      await Sentry.startSpan(
        {
          name: "worker.workspace_setup",
          op: "worker.setup",
          attributes: {
            "user.id": this.config.userId,
            "session.key": this.config.sessionKey,
          },
        },
        async () => {
          await this.workspaceManager.setupWorkspace(
            this.config.userId,
            this.config.sessionKey
          );

          const { initModuleWorkspace } = await import("../modules/lifecycle");
          await initModuleWorkspace({
            workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
            username: this.config.userId,
            sessionKey: this.config.sessionKey,
          });
        }
      );

      // Setup I/O directories for file handling
      await this.setupIODirectories();

      // Download input files if any
      await this.downloadInputFiles();

      // Generate custom instructions
      let customInstructions = await generateCustomInstructions(
        new OpenClawCoreInstructionProvider(),
        {
          userId: this.config.userId,
          agentId: this.config.agentId,
          sessionKey: this.config.sessionKey,
          workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
          availableProjects: listAppDirectories(
            this.workspaceManager.getCurrentWorkingDirectory()
          ),
        }
      );

      // Call module onSessionStart hooks to allow modules to modify system prompt
      try {
        const { onSessionStart } = await import("../modules/lifecycle");
        const moduleContext = await onSessionStart({
          platform: this.config.platform,
          channelId: this.config.channelId,
          userId: this.config.userId,
          conversationId: this.config.conversationId,
          messageId: this.config.responseId,
          workingDirectory: this.workspaceManager.getCurrentWorkingDirectory(),
          customInstructions,
        });
        if (moduleContext.customInstructions) {
          customInstructions = moduleContext.customInstructions;
        }
      } catch (error) {
        logger.error("Failed to call onSessionStart hooks:", error);
      }

      // Add file I/O instructions AFTER module hooks so they aren't overwritten
      customInstructions += this.getFileIOInstructions();

      // Execute AI session
      logger.info(
        `[TIMING] Starting OpenClaw session at: ${new Date().toISOString()}`
      );
      const aiStartTime = Date.now();
      logger.info(
        `[TIMING] Total worker startup time: ${aiStartTime - executeStartTime}ms`
      );

      let firstOutputLogged = false;

      const result = await Sentry.startSpan(
        {
          name: "worker.openclaw_execution",
          op: "ai.inference",
          attributes: {
            "user.id": this.config.userId,
            "session.key": this.config.sessionKey,
            "conversation.id": this.config.conversationId,
            agent: "OpenClaw",
          },
        },
        async () => {
          return await this.runAISession(
            userPrompt,
            customInstructions,
            async (update) => {
              if (!firstOutputLogged && update.type === "output") {
                logger.info(
                  `[TIMING] First OpenClaw output at: ${new Date().toISOString()} (${Date.now() - aiStartTime}ms after start)`
                );
                firstOutputLogged = true;
              }

              if (update.type === "output" && update.data) {
                const delta =
                  typeof update.data === "string" ? update.data : null;
                if (delta) {
                  await this.workerTransport.sendStreamDelta(delta, false);
                }
              } else if (update.type === "status_update") {
                await this.workerTransport.sendStatusUpdate(
                  update.data.elapsedSeconds,
                  update.data.state
                );
              }
            }
          );
        }
      );

      // Collect module data before sending final response
      const { collectModuleData } = await import("../modules/lifecycle");
      const moduleData = await collectModuleData({
        workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
        userId: this.config.userId,
        conversationId: this.config.conversationId,
      });
      this.workerTransport.setModuleData(moduleData);

      // Handle result
      if (result.success) {
        logger.info("Session completed successfully - all content already streamed via WebSocket");
        await this.workerTransport.signalDone();
      } else {
        const errorMsg = result.error || "Unknown error";
        const isTimeout = result.exitCode === 124;

        if (isTimeout) {
          logger.info(
            `Session timed out (exit code 124) - will be retried automatically, not showing error to user`
          );
          throw new Error("SESSION_TIMEOUT");
        } else {
          await this.workerTransport.sendStreamDelta(
            `❌ Session failed: ${errorMsg}`,
            true,
            true
          );
          await this.workerTransport.signalError(new Error(errorMsg));
        }
      }

      logger.info(
        `Worker completed with ${result.success ? "success" : "failure"}`
      );
    } catch (error) {
      await handleExecutionError(error, this.workerTransport);
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info("Cleaning up worker resources...");
      if (this.wsClient) {
        this.wsClient.disconnect();
        this.wsClient = null;
      }
      logger.info("Worker cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }

  getWorkerTransport(): WorkerTransport | null {
    return this.workerTransport;
  }

  private getWorkingDirectory(): string {
    return this.workspaceManager.getCurrentWorkingDirectory();
  }

  // ---------------------------------------------------------------------------
  // AI session — OpenClaw via WebSocket
  // ---------------------------------------------------------------------------

  private async runAISession(
    userPrompt: string,
    customInstructions: string,
    onProgress: (update: ProgressUpdate) => Promise<void>
  ): Promise<SessionExecutionResult> {
    const rawOptions = JSON.parse(this.config.agentOptions) as Record<
      string,
      unknown
    >;

    // Fetch session context for provider config and gateway instructions
    const context = await getOpenClawSessionContext();
    const pc = context.providerConfig;
    if (pc.credentialEnvVarName) {
      process.env.CREDENTIAL_ENV_VAR_NAME = pc.credentialEnvVarName;
    }
    if (pc.defaultProvider) {
      process.env.AGENT_DEFAULT_PROVIDER = pc.defaultProvider;
    }
    if (pc.defaultModel) {
      process.env.AGENT_DEFAULT_MODEL = pc.defaultModel;
    }
    if (pc.providerBaseUrlMappings) {
      for (const [envVar, url] of Object.entries(pc.providerBaseUrlMappings)) {
        process.env[envVar] = url;
      }
    }

    const modelRef =
      typeof rawOptions.model === "string" ? rawOptions.model : "";

    const { provider: rawProvider, modelId } = resolveModelRef(modelRef);
    const provider = PROVIDER_REGISTRY_ALIASES[rawProvider] || rawProvider;

    // Dynamic provider base URL
    const dynamicMappings = rawOptions.providerBaseUrlMappings as
      | Record<string, string>
      | undefined;
    if (dynamicMappings && typeof dynamicMappings === "object") {
      for (const [envVar, url] of Object.entries(dynamicMappings)) {
        if (!process.env[envVar]) {
          process.env[envVar] = url;
        }
      }
    }

    const workspaceDir = this.getWorkingDirectory();

    // Detect provider change and reset session if needed
    const providerStateFile = path.join(
      workspaceDir,
      ".openclaw",
      "provider.json"
    );
    let sessionSummary: string | undefined;
    try {
      const raw = await fs.readFile(providerStateFile, "utf-8");
      const prevState = JSON.parse(raw) as {
        provider: string;
        modelId: string;
      };
      if (prevState.provider && prevState.provider !== provider) {
        logger.info(
          `Provider changed from ${prevState.provider} to ${provider}, resetting session`
        );
        sessionSummary = `[System note: The AI provider was just changed from ${prevState.provider} to ${provider}. Previous conversation history has been cleared.]`;
        await clearOpenClawSession(workspaceDir);
      }
    } catch {
      // No previous provider state — first run
    }

    // Persist current provider state
    await fs.mkdir(path.join(workspaceDir, ".openclaw"), { recursive: true });
    await fs.writeFile(
      providerStateFile,
      JSON.stringify({ provider, modelId }),
      "utf-8"
    );

    // Merge gateway instructions into custom instructions
    const instructionParts = [context.gatewayInstructions, customInstructions];

    // CLI backends
    const cliBackends = pc.cliBackends?.length
      ? pc.cliBackends
      : process.env.CLI_BACKENDS
        ? (JSON.parse(process.env.CLI_BACKENDS) as Array<{
            name: string;
            command: string;
            args?: string[];
          }>)
        : undefined;
    if (cliBackends?.length) {
      const agentList = cliBackends
        .map((b) => {
          const cmd = `${b.command} ${(b.args || []).join(" ")}`;
          const aliases = [b.name, (b as any).providerId].filter(
            (v, i, a) => v && a.indexOf(v) === i
          );
          return `### ${aliases.join(" / ")}
Run via Bash exactly as shown (do NOT modify the command):
\`\`\`bash
${cmd} "YOUR_PROMPT_HERE"
\`\`\``;
        })
        .join("\n\n");
      instructionParts.push(
        `## Available Coding Agents

You have access to the following AI coding agents. When the user mentions any of these by name (e.g. "use claude", "ask chatgpt"), you MUST run the exact command shown below via the Bash tool. Do NOT attempt to install or locate the CLI yourself — the command handles everything.

${agentList}

Replace "YOUR_PROMPT_HERE" with the user's request. These agents can read/write files, install packages, and run commands in the working directory.`
      );
    }

    instructionParts.push(`## Conversation History

You have access to GetChannelHistory to view previous messages in this thread.
Use it when the user references past discussions or you need context.`);

    const finalInstructions = instructionParts.filter(Boolean).join("\n\n");

    // Write OpenClaw config files (SOUL.md, skills, agents config)
    await writeOpenClawConfig({
      workspaceDir,
      gatewayInstructions: context.gatewayInstructions,
      customInstructions: finalInstructions,
      providerConfig: pc,
      cliBackends: pc.cliBackends,
    });

    // Credential injection — set env vars for OpenClaw gateway to use.
    //
    // In the proxy pattern the real API key never reaches the worker.
    // The gateway sets ANTHROPIC_BASE_URL to its proxy endpoint and the
    // proxy resolves the real credential at request time using the agentId
    // from the URL path.  The worker only needs *some* non-empty value in
    // ANTHROPIC_API_KEY so that OpenClaw accepts the provider as configured.
    const gatewayUrl = process.env.DISPATCHER_URL ?? "";
    const workerToken = process.env.WORKER_TOKEN ?? "";
    const credEnvVar = process.env.CREDENTIAL_ENV_VAR_NAME || null;
    const apiKeyEnvVar = credEnvVar && process.env[credEnvVar]
      ? credEnvVar
      : getApiKeyEnvVarForProvider(provider);

    if (credEnvVar && process.env[credEnvVar]) {
      process.env.ANTHROPIC_API_KEY = process.env[credEnvVar]!;
    } else if (process.env[apiKeyEnvVar]) {
      process.env.ANTHROPIC_API_KEY = process.env[apiKeyEnvVar]!;
    } else if (process.env.ANTHROPIC_BASE_URL) {
      // Proxy is configured but no credential env var was set (user
      // credentials live in the gateway DB, resolved by the proxy).
      // Provide a placeholder so OpenClaw doesn't reject the provider.
      process.env.ANTHROPIC_API_KEY = "lobu-proxy";
    }

    // Set MCP server env vars so OpenClaw passes them to the peon-gateway MCP subprocess
    process.env.CHANNEL_ID = this.config.channelId;
    process.env.CONVERSATION_ID = this.config.conversationId;

    // Consume config change notifications
    const { consumePendingConfigNotifications } = await import(
      "../gateway/sse-client"
    );
    const configNotifications = consumePendingConfigNotifications();

    let configNotice = "";
    if (configNotifications.length > 0) {
      const lines = configNotifications.map((n) => {
        let line = `- ${n.summary}`;
        if (n.details?.length) {
          line += `: ${n.details.join("; ")}`;
        }
        return line;
      });
      configNotice = `[System notice: Your configuration was updated since the last message]\n${lines.join("\n")}\n\n`;
    }

    const effectivePrompt = `${configNotice}${sessionSummary ? `${sessionSummary}\n\n` : ""}${userPrompt}`;

    logger.info(
      `Starting OpenClaw session: provider=${provider}, model=${modelId}`
    );

    // Ensure OpenClaw gateway is running
    const openclawProcess = getOpenClawProcess();
    await openclawProcess.ensureRunning();

    // Connect to OpenClaw via WebSocket
    const authToken = process.env.OPENCLAW_AUTH_TOKEN || "";
    if (!authToken) {
      logger.warn("No OPENCLAW_AUTH_TOKEN set — WebSocket auth may fail");
    }

    const wsUrl = openclawProcess.getWebSocketUrl();
    this.wsClient = new OpenClawWsClient({ url: wsUrl, authToken });

    // Heartbeat timer
    const HEARTBEAT_INTERVAL_MS = 20000;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    // Delta batching
    let pendingDelta = "";
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;
    const DELTA_BATCH_INTERVAL_MS = 150;

    const flushDelta = async () => {
      if (pendingDelta) {
        const toSend = pendingDelta;
        pendingDelta = "";
        await onProgress({
          type: "output",
          data: toSend,
          timestamp: Date.now(),
        });
      }
      if (deltaTimer) {
        clearTimeout(deltaTimer);
        deltaTimer = null;
      }
    };

    const scheduleDeltaFlush = () => {
      if (!deltaTimer) {
        deltaTimer = setTimeout(() => {
          flushDelta().catch((err) => {
            logger.error("Failed to flush delta:", err);
          });
        }, DELTA_BATCH_INTERVAL_MS);
      }
    };

    try {
      await this.wsClient.connect();
      logger.info(`Connected to OpenClaw gateway at ${wsUrl}`);

      // Set up heartbeat
      let elapsedTime = 0;
      let lastHeartbeatTime = Date.now();

      const sendHeartbeat = async () => {
        const now = Date.now();
        elapsedTime += now - lastHeartbeatTime;
        lastHeartbeatTime = now;
        const seconds = Math.floor(elapsedTime / 1000);

        await onProgress({
          type: "status_update",
          data: {
            elapsedSeconds: seconds,
            state: "is running..",
          },
          timestamp: Date.now(),
        });
      };

      heartbeatTimer = setInterval(() => {
        sendHeartbeat().catch((err) => {
          logger.error("Failed to send heartbeat:", err);
        });
      }, HEARTBEAT_INTERVAL_MS);

      // Send message to OpenClaw and process streaming events
      const sessionKey = `agent:main:peon:${this.config.conversationId}`;
      const events = this.wsClient.sendMessage({
        message: effectivePrompt,
        sessionKey,
        thinking: "high",
        model: `${provider}/${modelId}`,
      });

      let errorMessage: string | null = null;

      for await (const event of events) {
        this.processOpenClawEvent(event, (delta) => {
          pendingDelta += delta;
          scheduleDeltaFlush();
        }, (err) => {
          errorMessage = err;
        });
      }

      // Flush any remaining delta
      await flushDelta();

      if (errorMessage) {
        const errorWithHint = await this.maybeBuildAuthHintMessage(
          errorMessage,
          provider,
          modelId,
          gatewayUrl,
          workerToken
        );
        return {
          success: false,
          exitCode: 1,
          output: "",
          error: errorWithHint,
          sessionKey: this.config.sessionKey,
        };
      }

      return {
        success: true,
        exitCode: 0,
        output: "",
        sessionKey: this.config.sessionKey,
      };
    } catch (error) {
      await flushDelta();
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorWithHint = await this.maybeBuildAuthHintMessage(
        errorMsg,
        provider,
        modelId,
        gatewayUrl,
        workerToken
      );

      return {
        success: false,
        exitCode: 1,
        output: "",
        error: errorWithHint,
        sessionKey: this.config.sessionKey,
      };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (deltaTimer) {
        clearTimeout(deltaTimer);
        deltaTimer = null;
      }
      this.wsClient?.disconnect();
      this.wsClient = null;
    }
  }

  /**
   * Process a single OpenClaw WebSocket event.
   */
  private processOpenClawEvent(
    event: OpenClawEvent,
    onDelta: (delta: string) => void,
    onError: (message: string) => void
  ): void {
    switch (event.type) {
      case "text_delta":
        onDelta(event.delta);
        break;

      case "thinking":
        // Thinking events — could stream if verbose mode
        logger.debug(`[openclaw:thinking] ${event.delta.substring(0, 100)}...`);
        this.postAgentActivity({ type: "thinking", text: event.delta });
        break;

      case "tool_start":
        logger.info(`[openclaw:tool] Starting: ${event.name}`);
        onDelta(`\n> Running ${event.name}...\n`);
        this.postAgentActivity({ type: "tool_start", tool: event.name });
        break;

      case "tool_end":
        logger.info(`[openclaw:tool] Completed: ${event.name}`);
        this.postAgentActivity({ type: "tool_end", tool: event.name });
        break;

      case "turn_end":
        logger.info("OpenClaw turn completed");
        this.postAgentActivity({ type: "turn_end" });
        break;

      case "error":
        logger.error(`OpenClaw error: ${event.message}`);
        onError(event.message);
        break;
    }
  }

  /**
   * Fire-and-forget: POST an agent activity event to the gateway so it can
   * fan it out to SSE clients watching the project in real time.
   * Never throws — failures are logged but never propagate to the caller.
   */
  private postAgentActivity(
    event: { type: string; tool?: string; text?: string; message?: string }
  ): void {
    const gatewayUrl = process.env.DISPATCHER_URL;
    const workerToken = process.env.WORKER_TOKEN;
    if (!gatewayUrl || !workerToken) return;

    fetch(`${gatewayUrl}/internal/agent-activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ ...event, timestamp: Date.now() }),
      signal: AbortSignal.timeout(3000),
    }).catch((err) => {
      logger.debug(`Failed to post agent activity (${event.type}): ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async setupIODirectories(): Promise<void> {
    const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
    const inputDir = path.join(workspaceDir, "input");
    const outputDir = path.join(workspaceDir, "output");
    const tempDir = path.join(workspaceDir, "temp");

    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const files = await fs.readdir(outputDir);
      for (const file of files) {
        await fs.unlink(path.join(outputDir, file)).catch(() => {
          /* intentionally empty */
        });
      }
    } catch (error) {
      logger.debug("Could not clear output directory:", error);
    }

    logger.info("I/O directories setup completed");
  }

  private async downloadInputFiles(): Promise<void> {
    const files = (this.config as any).platformMetadata?.files || [];
    if (files.length === 0) {
      return;
    }

    logger.info(`Downloading ${files.length} input files...`);
    const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
    const inputDir = path.join(workspaceDir, "input");
    const dispatcherUrl = process.env.DISPATCHER_URL!;
    const workerToken = process.env.WORKER_TOKEN!;

    for (const file of files) {
      try {
        logger.info(`Downloading file: ${file.name} (${file.id})`);

        const response = await fetch(
          `${dispatcherUrl}/internal/files/download?fileId=${file.id}`,
          {
            headers: {
              Authorization: `Bearer ${workerToken}`,
            },
            signal: AbortSignal.timeout(60_000),
          }
        );

        if (!response.ok) {
          logger.error(
            `Failed to download file ${file.name}: ${response.statusText}`
          );
          continue;
        }

        const destPath = path.join(inputDir, file.name);
        const fileStream = Readable.fromWeb(response.body as any);
        const writeStream = (await import("node:fs")).createWriteStream(
          destPath
        );

        await pipeline(fileStream, writeStream);
        logger.info(`Downloaded: ${file.name} to input directory`);
      } catch (error) {
        logger.error(`Error downloading file ${file.name}:`, error);
      }
    }
  }

  private getFileIOInstructions(): string {
    const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
    const files = (this.config as any).platformMetadata?.files || [];

    let userFilesSection = "";
    if (files.length > 0) {
      userFilesSection = `

### User-Uploaded Files
The user has uploaded ${files.length} file(s) for you to analyze:
${files.map((f: any) => `- \`${workspaceDir}/input/${f.name}\` (${f.mimetype || "unknown type"})`).join("\n")}

**Use these files to answer the user's request.** You can read them with standard commands like \`cat\`, \`less\`, or \`head\`.`;
    }

    return `

## File Generation & Output

**When to Create Files:**
Create and show files for any output that helps answer the user's request by using \`UploadUserFile\` tool:
- **Charts & visualizations**: pie charts, bar graphs, plots, diagrams via \`matplotlib\`
- **Reports & documents**: analysis reports, summaries, PDFs
- **Data files**: CSV exports, JSON data, spreadsheets
- **Code files**: scripts, configurations, examples
- **Images**: generated images, processed photos, screenshots.${userFilesSection}
`;
  }

  private async maybeBuildAuthHintMessage(
    errorMessage: string,
    provider: string,
    modelId: string,
    gatewayUrl: string,
    workerToken: string
  ): Promise<string> {
    const authHint = getProviderAuthHintFromError(errorMessage, provider);
    if (!authHint) {
      return errorMessage;
    }

    try {
      const resp = await fetch(`${gatewayUrl}/internal/settings-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          reason: `Connect your ${authHint.providerName} account to use ${modelId} models`,
          prefillEnvVars: [authHint.envVar],
        }),
      });

      if (resp.ok) {
        const { url } = (await resp.json()) as { url: string };
        return `To use ${modelId}, you need to connect your ${authHint.providerName} account.\n\nOpen settings to add your API key: ${url}`;
      }
    } catch (linkError) {
      logger.error(
        "Failed to generate settings link for missing API key",
        linkError
      );
    }

    return errorMessage;
  }
}
