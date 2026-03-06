#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createLogger, type WorkerTransport } from "@lobu/core";
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
import { PROVIDER_REGISTRY_ALIASES, resolveModelRef } from "./model-resolver";
import { OpenClawWsClient, type OpenClawEvent } from "./openclaw-ws-client";
import { getOpenClawProcess } from "./openclaw-process";
import { getOpenClawSessionContext } from "./session-context";
import { ensureProjectAgent } from "./agent-registry";
import { buildToolActivityText } from "./tool-activity";

interface AgentActivityPayload {
  type: "tool_start" | "tool_end" | "turn_end" | "error";
  tool?: string;
  text?: string;
  agentName?: string;
  filePath?: string;
  command?: string;
  timestamp: number;
}

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
        "DISPATCHER_URL and WORKER_TOKEN environment variables are required",
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
      platformMetadata: config.platformMetadata as Record<string, unknown>,
    });
  }

  /**
   * Main execution workflow
   */
  async execute(): Promise<void> {
    const executeStartTime = Date.now();

    try {
      logger.info(
        `🚀 Starting OpenClaw worker for session: ${this.config.sessionKey}`,
      );
      logger.info(
        `[TIMING] Worker execute() started at: ${new Date(executeStartTime).toISOString()}`,
      );

      // Decode user prompt
      const userPrompt = Buffer.from(this.config.userPrompt, "base64").toString(
        "utf-8",
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
            this.config.sessionKey,
          );

          const { initModuleWorkspace } = await import("../modules/lifecycle");
          await initModuleWorkspace({
            workspaceDir: this.workspaceManager.getCurrentWorkingDirectory(),
            username: this.config.userId,
            sessionKey: this.config.sessionKey,
          });
        },
      );

      // Setup I/O directories for file handling
      await this.setupIODirectories();

      // Auto-clone project repository if configured
      const repoDir = await this.cloneProjectRepository();

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
            this.workspaceManager.getCurrentWorkingDirectory(),
          ),
        },
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

      // Tell the agent where the cloned repository lives
      if (repoDir) {
        customInstructions += `\n\n## Project Repository\n\nThe project repository has been cloned to \`${repoDir}\`. Use this directory when working with project source code.\n`;
      }

      // Execute AI session
      logger.info(
        `[TIMING] Starting OpenClaw session at: ${new Date().toISOString()}`,
      );
      const aiStartTime = Date.now();
      logger.info(
        `[TIMING] Total worker startup time: ${aiStartTime - executeStartTime}ms`,
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
                  `[TIMING] First OpenClaw output at: ${new Date().toISOString()} (${Date.now() - aiStartTime}ms after start)`,
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
                  update.data.state,
                );
              }
            },
          );
        },
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
        logger.info(
          "Session completed successfully - all content already streamed via WebSocket",
        );
        await this.workerTransport.signalDone();
      } else {
        const errorMsg = result.error || "Unknown error";
        const isTimeout = result.exitCode === 124;

        if (isTimeout) {
          logger.info(
            `Session timed out (exit code 124) - will be retried automatically, not showing error to user`,
          );
          throw new Error("SESSION_TIMEOUT");
        } else {
          await this.workerTransport.sendStreamDelta(
            `❌ Session failed: ${errorMsg}`,
            true,
            true,
          );
          await this.workerTransport.signalError(new Error(errorMsg));
        }
      }

      logger.info(
        `Worker completed with ${result.success ? "success" : "failure"}`,
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
    onProgress: (update: ProgressUpdate) => Promise<void>,
  ): Promise<SessionExecutionResult> {
    const rawOptions = JSON.parse(this.config.agentOptions) as Record<
      string,
      unknown
    >;

    // Fetch session context for provider config and gateway instructions
    const context = await getOpenClawSessionContext();
    const pc = context.providerConfig;
    if (pc.defaultProvider) {
      process.env.AGENT_DEFAULT_PROVIDER = pc.defaultProvider;
    }
    if (pc.defaultModel) {
      process.env.AGENT_DEFAULT_MODEL = pc.defaultModel;
    }
    const modelRef =
      typeof rawOptions.model === "string" ? rawOptions.model : "";

    const { provider: rawProvider, modelId } = resolveModelRef(modelRef);
    const provider = PROVIDER_REGISTRY_ALIASES[rawProvider] || rawProvider;

    const workspaceDir = this.getWorkingDirectory();

    // Detect provider change and reset session if needed
    const providerStateFile = path.join(
      workspaceDir,
      ".openclaw",
      "provider.json",
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
          `Provider changed from ${prevState.provider} to ${provider}, resetting session`,
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
      "utf-8",
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
            (v, i, a) => v && a.indexOf(v) === i,
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

Replace "YOUR_PROMPT_HERE" with the user's request. These agents can read/write files, install packages, and run commands in the working directory.`,
      );
    }

    instructionParts.push(`## Conversation History

You have access to GetChannelHistory to view previous messages in this thread.
Use it when the user references past discussions or you need context.`);

    const finalInstructions = instructionParts.filter(Boolean).join("\n\n");

    // Write OpenClaw config files (SOUL.md, skills, agents config)
    const pmeta = this.config.platformMetadata as Record<string, unknown> | undefined;
    const teamMembers = Array.isArray(pmeta?.teamMembers)
      ? (pmeta.teamMembers as Array<{ roleName: string; displayName: string; systemPrompt: string }>)
      : undefined;
    await writeOpenClawConfig({
      workspaceDir,
      gatewayInstructions: context.gatewayInstructions,
      customInstructions: finalInstructions,
      providerConfig: pc,
      cliBackends: pc.cliBackends,
      openclawAgentId: pmeta?.openclawAgentId as string | undefined,
      teamMembers,
    });

    // Credential injection — the real API key or OAuth token is passed via env vars.
    const gatewayUrl = process.env.DISPATCHER_URL ?? "";
    const workerToken = process.env.WORKER_TOKEN ?? "";
    const apiKeyEnvVar = getApiKeyEnvVarForProvider(provider);

    if (process.env.ANTHROPIC_API_KEY) {
      logger.info("Credential injection: ANTHROPIC_API_KEY present in env");
    } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      logger.info("Credential injection: CLAUDE_CODE_OAUTH_TOKEN present (OAuth subscription)");
    } else if (process.env[apiKeyEnvVar]) {
      process.env.ANTHROPIC_API_KEY = process.env[apiKeyEnvVar]!;
      logger.info(
        `Credential injection: copied ${apiKeyEnvVar} to ANTHROPIC_API_KEY`,
      );
    } else {
      logger.warn(
        `Credential injection: NO credential found — ${apiKeyEnvVar}, CLAUDE_CODE_OAUTH_TOKEN, and ANTHROPIC_API_KEY are all unset`,
      );
    }

    // Ensure ANTHROPIC_BASE_URL is not set to a proxy — let the SDK
    // use the default https://api.anthropic.com endpoint.
    delete process.env.ANTHROPIC_BASE_URL;

    // Set MCP server env vars so OpenClaw passes them to the peon-gateway MCP subprocess
    process.env.CHANNEL_ID = this.config.channelId;
    process.env.CONVERSATION_ID = this.config.conversationId;

    // Consume config change notifications
    const { consumePendingConfigNotifications } =
      await import("../gateway/sse-client");
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
      `Starting OpenClaw session: provider=${provider}, model=${modelId}`,
    );

    // Ensure OpenClaw gateway is running
    const openclawProcess = getOpenClawProcess();
    await openclawProcess.ensureRunning();

    // Connect to OpenClaw via WebSocket (auth.mode=none, no token needed)
    const wsUrl = openclawProcess.getWebSocketUrl();
    this.wsClient = new OpenClawWsClient({ url: wsUrl });

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

      // Ensure per-project agent exists if this message targets a project
      const meta = this.config.platformMetadata as Record<string, unknown> | undefined;
      const openclawAgentId = meta?.openclawAgentId as string | undefined;
      if (!openclawAgentId || !meta?.projectId) {
        throw new Error("openclawAgentId and projectId are required in platformMetadata");
      }
      await ensureProjectAgent(
        meta.projectId as string,
        (meta.projectName as string) ?? "Untitled",
      );

      // Send message to OpenClaw and process streaming events
      const sessionKey = `agent:${openclawAgentId}:peon:${this.config.conversationId}`;
      const events = this.wsClient.sendMessage({
        message: effectivePrompt,
        sessionKey,
        thinking: "high",
      });

      let errorMessage: string | null = null;
      let totalDeltaCharsReceived = 0;

      for await (const event of events) {
        this.processOpenClawEvent(
          event,
          (delta) => {
            totalDeltaCharsReceived += delta.length;
            pendingDelta += delta;
            scheduleDeltaFlush();
          },
          (err) => {
            errorMessage = err;
          },
        );
      }

      // Flush any remaining delta
      const pendingBeforeFlush = pendingDelta.length;
      await flushDelta();

      logger.info(
        `OpenClaw event loop finished: errorMessage=${errorMessage ?? "none"}, ` +
        `deltaCharsReceived=${totalDeltaCharsReceived}, pendingAtFlush=${pendingBeforeFlush}, ` +
        `pendingAfterFlush=${pendingDelta.length}`
      );

      if (errorMessage) {
        const errorWithHint = await this.maybeBuildAuthHintMessage(
          errorMessage,
          provider,
          modelId,
          gatewayUrl,
          workerToken,
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
        workerToken,
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
    onError: (message: string) => void,
  ): void {
    switch (event.type) {
      case "text_delta":
        onDelta(event.delta);
        break;

      case "thinking":
        logger.debug(`[openclaw:thinking] ${event.delta.substring(0, 100)}...`);
        break;

      case "tool_start": {
        const input = event.input ?? {};
        logger.info(`[openclaw:tool] Starting: ${event.name}`);
        const text = buildToolActivityText(event.name, input);
        const filePath = (input.file_path ?? input.path) as string | undefined;
        const command = input.command as string | undefined;
        this.relayToolEvent({
          type: "tool_start",
          tool: event.name,
          ...(text && { text }),
          ...(filePath && { filePath }),
          ...(command && { command }),
          timestamp: Date.now(),
        });
        break;
      }

      case "tool_end":
        logger.info(`[openclaw:tool] Completed: ${event.name}`);
        this.relayToolEvent({
          type: "tool_end",
          tool: event.name,
          timestamp: Date.now(),
        });
        break;

      case "turn_end":
        logger.info("OpenClaw turn completed");
        if (event.contentBlocks) {
          this.workerTransport.setContentBlocks(event.contentBlocks);
        }
        break;

      case "error":
        logger.error(`OpenClaw error: ${event.message}`);
        onError(event.message);
        break;
    }
  }

  /**
   * Relay tool events to the Peon gateway via HTTP so they reach SSE clients.
   * The OpenClaw WebSocket delivers assistant/lifecycle/chat events to passive
   * observers, but tool events are session-scoped and only visible to the
   * session initiator (the worker). This relay bridges that gap.
   */
  private relayToolEvent(event: AgentActivityPayload): void {
    const meta = this.config.platformMetadata as Record<string, unknown> | undefined;
    const projectId = meta?.projectId as string | undefined;
    const gatewayUrl = process.env.DISPATCHER_URL;
    if (!projectId || !gatewayUrl) return;

    fetch(`${gatewayUrl}/internal/agent-activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, events: [event] }),
    }).catch(() => {});
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
          },
        );

        if (!response.ok) {
          logger.error(
            `Failed to download file ${file.name}: ${response.statusText}`,
          );
          continue;
        }

        const destPath = path.join(inputDir, file.name);
        const fileStream = Readable.fromWeb(response.body as any);
        const writeStream = (await import("node:fs")).createWriteStream(
          destPath,
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

  private static readonly PULL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Auto-clone project repository if configured in platformMetadata.
   * Returns the absolute path to the repo directory, or null if no repo.
   */
  private async cloneProjectRepository(): Promise<string | null> {
    try {
      const pmeta = this.config.platformMetadata as Record<string, unknown> | undefined;
      const repoUrl = pmeta?.projectRepoUrl as string | undefined;

      if (!repoUrl) {
        logger.info("No repository URL configured - skipping repo clone");
        return null;
      }

      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);

      const workspaceDir = this.workspaceManager.getCurrentWorkingDirectory();
      const repoDir = path.join(workspaceDir, "repo");

      // Check if repo already exists
      try {
        await fs.stat(path.join(repoDir, ".git"));
        logger.info(`Repository already exists at ${repoDir}`);

        // Skip pull if we pulled recently
        const markerFile = path.join(repoDir, ".last-pull");
        try {
          const markerStat = await fs.stat(markerFile);
          if (Date.now() - markerStat.mtimeMs < OpenClawWorker.PULL_COOLDOWN_MS) {
            logger.info("Repository pull skipped (last pull was recent)");
            return repoDir;
          }
        } catch {
          // Marker doesn't exist yet — proceed with pull
        }

        try {
          const noProxyEnv = { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" };
          // Detect the default branch rather than hardcoding "main"
          const { stdout: headRef } = await execAsync(
            "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null",
            { cwd: repoDir, env: noProxyEnv },
          );
          const defaultBranch = headRef.trim().replace("refs/remotes/origin/", "");
          await execAsync(`git pull origin ${defaultBranch}`, { cwd: repoDir, env: noProxyEnv });
          logger.info(`Pulled latest changes from origin/${defaultBranch}`);
          await fs.writeFile(markerFile, String(Date.now()), "utf-8");
        } catch (pullError) {
          logger.warn("Could not pull latest changes:", pullError);
        }
        return repoDir;
      } catch {
        // Repo doesn't exist, proceed with clone
      }

      logger.info(`Cloning repository: ${repoUrl}`);

      const gitCommand = `git clone "${repoUrl}" repo`;
      await execAsync(gitCommand, {
        cwd: workspaceDir,
        timeout: 60000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          http_proxy: "",
          https_proxy: "",
        },
      });

      logger.info(`Successfully cloned repository to ${repoDir}`);
      // Write pull marker so we don't immediately re-pull on next message
      await fs.writeFile(path.join(repoDir, ".last-pull"), String(Date.now()), "utf-8");
      return repoDir;
    } catch (error) {
      logger.error("Failed to clone repository:", error);
      return null;
    }
  }

  private async maybeBuildAuthHintMessage(
    errorMessage: string,
    provider: string,
    modelId: string,
    gatewayUrl: string,
    workerToken: string,
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
        const data = (await resp.json()) as {
          url?: string;
          type?: string;
          message?: string;
        };
        if (data.url) {
          return `To use ${modelId}, you need to connect your ${authHint.providerName} account.\n\nOpen settings to add your API key: ${data.url}`;
        }
        if (data.type === "settings_link" || data.type === "inline_grant") {
          return `To use ${modelId}, you need to connect your ${authHint.providerName} account.\n\nA settings link has been sent to your chat.`;
        }
      }
    } catch (linkError) {
      logger.error(
        "Failed to generate settings link for missing API key",
        linkError,
      );
    }

    return errorMessage;
  }
}
