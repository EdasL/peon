/**
 * OpenClaw plugin: Peon Gateway Tools.
 *
 * Self-contained plugin loaded in-process by the OpenClaw gateway.
 * Uses only fetch() — no external dependencies — so module resolution
 * cannot break across the worker / gateway process boundary.
 *
 * Per-session context (channelId, conversationId, platform) is read from
 * ~/.openclaw/.peon-session.json which the worker writes before each turn.
 * Static credentials come from inherited env vars.
 */

import { readFileSync } from "node:fs";
import { readFile, stat, writeFile, mkdir, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { buildToolActivityText } from "../../tool-activity.js";
import {
  createSession,
  sendKeys,
  capturePane,
  killSession,
  hasSession,
} from "../../tmux-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionContext {
  channelId: string;
  conversationId: string;
  platform: string;
}

interface GatewayParams {
  gatewayUrl: string;
  workerToken: string;
  channelId: string;
  conversationId: string;
  platform: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_FILE = join(homedir(), ".openclaw", ".peon-session.json");

function readSessionContext(): SessionContext {
  try {
    const raw = readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(raw) as SessionContext;
  } catch {
    return { channelId: "", conversationId: "", platform: "web" };
  }
}

function gw(): GatewayParams {
  const ctx = readSessionContext();
  return {
    gatewayUrl: process.env.DISPATCHER_URL || "",
    workerToken: process.env.WORKER_TOKEN || "",
    channelId: ctx.channelId,
    conversationId: ctx.conversationId,
    platform: ctx.platform,
  };
}

function text(t: string): ToolResult {
  return { content: [{ type: "text", text: t }] };
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

async function gatewayFetch<T>(
  g: GatewayParams,
  path: string,
  opts: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ data?: T; error?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${g.workerToken}`,
    ...opts.headers,
  };
  if (opts.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${g.gatewayUrl}${path}`, {
    method: opts.method,
    headers,
    body: opts.body,
  });

  if (!res.ok) {
    const msg = await parseErrorBody(res);
    return { error: msg };
  }
  return { data: (await res.json()) as T };
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
  ".csv": "text/csv", ".json": "application/json", ".html": "text/html",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
  ".txt": "text/plain", ".md": "text/markdown", ".py": "text/x-python",
  ".js": "text/javascript", ".ts": "text/typescript",
  ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function contentType(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] || "application/octet-stream";
}

/**
 * Build a multipart/form-data body manually so we don't depend on the
 * `form-data` npm package (which lives in the worker's node_modules,
 * not OpenClaw's).
 */
function buildMultipart(
  fields: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>
): { body: Buffer; contentType: string } {
  const boundary = `----PeonBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += "\r\n";
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += "\r\n";
    parts.push(Buffer.from(header));
    parts.push(typeof f.value === "string" ? Buffer.from(f.value) : f.value);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function uploadUserFile(
  _id: string,
  params: { file_path: string; description?: string }
): Promise<ToolResult> {
  const g = gw();
  const filePath = isAbsolute(params.file_path) ? params.file_path : join(process.cwd(), params.file_path);

  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) return text(`Error: File not found: ${params.file_path}`);
  if (st.size === 0) return text(`Error: File is empty: ${params.file_path}`);

  const fileName = basename(filePath);
  const fileBuffer = await readFile(filePath);

  const fields: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }> = [
    { name: "file", value: fileBuffer, filename: fileName, contentType: contentType(fileName) },
    { name: "filename", value: fileName },
  ];
  if (params.description) fields.push({ name: "comment", value: params.description });

  const mp = buildMultipart(fields);

  const res = await fetch(`${g.gatewayUrl}/internal/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${g.workerToken}`,
      "X-Channel-Id": g.channelId,
      "X-Conversation-Id": g.conversationId,
      "Content-Type": mp.contentType,
      "Content-Length": String(mp.body.length),
    },
    body: mp.body,
  });

  if (!res.ok) {
    const err = await res.text();
    return text(`Error: Failed to show file: ${res.status} - ${err}`);
  }

  return text(`Successfully showed ${fileName} to the user`);
}

async function askUserQuestion(
  _id: string,
  params: { question: string; options: string[] }
): Promise<ToolResult> {
  const g = gw();
  const { error } = await gatewayFetch(g, "/internal/interactions/create", {
    method: "POST",
    body: JSON.stringify({ interactionType: "question", question: params.question, options: params.options }),
  });
  if (error) return text(`Error: ${error}`);
  return text("Question posted with buttons. Your session will end now. The user's answer will arrive as your next message.");
}

async function scheduleReminder(
  _id: string,
  params: { task: string; delayMinutes?: number; cron?: string; maxIterations?: number }
): Promise<ToolResult> {
  const g = gw();
  const { data, error } = await gatewayFetch<{
    scheduleId: string; scheduledFor: string; isRecurring: boolean; cron?: string; maxIterations: number;
  }>(g, "/internal/schedule", {
    method: "POST",
    body: JSON.stringify({ task: params.task, delayMinutes: params.delayMinutes, cron: params.cron, maxIterations: params.maxIterations }),
  });
  if (error) return text(`Error: ${error}`);
  const r = data!;
  const rec = r.isRecurring ? `\nRecurring: ${r.cron} (max ${r.maxIterations} iterations)` : "";
  return text(`Reminder scheduled!\n\nSchedule ID: ${r.scheduleId}\nFirst trigger: ${new Date(r.scheduledFor).toLocaleString()}${rec}\n\nCancel with CancelReminder if needed.`);
}

async function cancelReminder(
  _id: string,
  params: { scheduleId: string }
): Promise<ToolResult> {
  const g = gw();
  const { data, error } = await gatewayFetch<{ success: boolean; message: string }>(
    g, `/internal/schedule/${encodeURIComponent(params.scheduleId)}`, { method: "DELETE" }
  );
  if (error) return text(`Error: ${error}`);
  return text(data!.success ? "Reminder cancelled." : `Could not cancel: ${data!.message}`);
}

async function listReminders(_id: string): Promise<ToolResult> {
  const g = gw();
  const { data, error } = await gatewayFetch<{
    reminders: Array<{
      scheduleId: string; task: string; scheduledFor: string;
      minutesRemaining: number; isRecurring: boolean; cron?: string;
      iteration: number; maxIterations: number;
    }>;
  }>(g, "/internal/schedule", {});
  if (error) return text(`Error: ${error}`);
  const { reminders } = data!;
  if (!reminders.length) return text("No pending reminders.");
  const fmt = reminders.map((r, i) => {
    const t = r.minutesRemaining < 60 ? `${r.minutesRemaining}m` : `${Math.round(r.minutesRemaining / 60)}h`;
    const rec = r.isRecurring ? `\n   Recurring: ${r.cron} (${r.iteration}/${r.maxIterations})` : "";
    return `${i + 1}. [${r.scheduleId}]\n   Task: ${r.task}\n   Next: ${t} (${new Date(r.scheduledFor).toLocaleString()})${rec}`;
  }).join("\n\n");
  return text(`Pending reminders (${reminders.length}):\n\n${fmt}`);
}

async function searchExtensions(
  _id: string,
  params: { query: string; type?: "skill" | "mcp"; limit?: number }
): Promise<ToolResult> {
  const g = gw();
  const limit = Math.min(params.limit || 5, 10);

  const results: Array<{ id: string; name: string; description: string; type: string; source: string }> = [];

  if (params.type !== "mcp") {
    const res = await fetch(
      `${g.gatewayUrl}/internal/integrations/search?q=${encodeURIComponent(params.query)}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${g.workerToken}` } }
    ).catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as { skills: Array<{ id: string; name: string; source: string }> };
      for (const s of d.skills || []) results.push({ id: s.id, name: s.name, description: "", type: "skill", source: s.source || "clawhub" });
    }
  }

  if (!results.length) return text(`No extensions found for "${params.query}". Try a broader query.`);
  const fmt = results.map((r, i) => `${i + 1}. [${r.type.toUpperCase()}] ${r.name} (${r.id})\n   ${r.description || "No description"}\n   source: ${r.source}`).join("\n\n");
  return text(`Found ${results.length} extension(s):\n\n${fmt}\n\nAsk the user which one they want, then call InstallExtension with the selected id and type.`);
}

async function installExtension(
  _id: string,
  params: { id: string; type: "skill" | "mcp"; reason?: string; envVars?: string[]; nixPackages?: string[] }
): Promise<ToolResult> {
  const g = gw();
  const reason = params.reason || `Install ${params.type} "${params.id}"`;
  const body: Record<string, unknown> = { reason, label: `Install ${params.type}` };

  if (params.type === "skill") {
    body.prefillSkills = [{ repo: params.id }];
  }
  if (params.envVars?.length) body.prefillEnvVars = params.envVars;
  if (params.nixPackages?.length) body.prefillNixPackages = params.nixPackages;

  const { data, error } = await gatewayFetch<{ url?: string; type?: string }>(
    g, "/internal/settings-link", { method: "POST", body: JSON.stringify(body) }
  );
  if (error) return text(`Error: ${error}`);
  if (data?.type === "settings_link") return text(`An install button has been sent to the user. Do not include any URL. Ask them to tap the button.`);
  return text(`Install link: ${data?.url}\n\nAsk the user to open the link and confirm installation.`);
}

async function getSettingsLink(
  _id: string,
  params: {
    reason: string; message?: string;
    prefillEnvVars?: string[]; prefillGrants?: string[];
    prefillSkills?: Array<{ repo: string }>; prefillMcpServers?: Array<Record<string, unknown>>;
  }
): Promise<ToolResult> {
  const g = gw();
  const { data, error } = await gatewayFetch<{ url?: string; expiresAt?: string; type?: string }>(
    g, "/internal/settings-link", { method: "POST", body: JSON.stringify(params) }
  );
  if (error) return text(`Error: ${error}`);
  if (data?.type === "inline_grant") return text("Approval buttons sent. Stop and wait for the user's response.");
  if (data?.type === "settings_link") return text("A settings button has been sent. Do not include any URL. Ask the user to tap the button.");
  const exp = data?.expiresAt ? `Expires: ${new Date(data.expiresAt).toLocaleString()}` : "";
  return text(`Settings link: ${data?.url}\n${exp}\n\nShare this link with the user.`);
}

async function getSettingsLinkForDomain(
  _id: string,
  params: { reason: string; prefillGrants: string[] }
): Promise<ToolResult> {
  return getSettingsLink(_id, { reason: params.reason, prefillGrants: params.prefillGrants });
}

async function generateAudio(
  _id: string,
  params: { text: string; voice?: string; speed?: number }
): Promise<ToolResult> {
  const g = gw();
  const capRes = await fetch(`${g.gatewayUrl}/internal/audio/capabilities`, {
    headers: { Authorization: `Bearer ${g.workerToken}` },
  }).catch(() => null);
  if (capRes?.ok) {
    const cap = (await capRes.json()) as { available: boolean };
    if (!cap.available) return text("Audio not configured. Use GetSettingsLink to help the user add a TTS API key.");
  }

  const res = await fetch(`${g.gatewayUrl}/internal/audio/synthesize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${g.workerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: params.text, voice: params.voice, speed: params.speed }),
  });
  if (!res.ok) {
    const err = await parseErrorBody(res);
    return text(`Error generating audio: ${err}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("Content-Type") || "audio/mpeg";
  const ext = mime.includes("opus") ? "opus" : mime.includes("ogg") ? "ogg" : "mp3";
  const tempPath = `/tmp/audio_${Date.now()}.${ext}`;

  try {
    await writeFile(tempPath, audioBuffer);
    const mp = buildMultipart([
      { name: "file", value: audioBuffer, filename: `voice_response.${ext}`, contentType: mime },
      { name: "filename", value: `voice_response.${ext}` },
      { name: "comment", value: "Voice response" },
    ]);
    const upRes = await fetch(`${g.gatewayUrl}/internal/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${g.workerToken}`,
        "X-Channel-Id": g.channelId, "X-Conversation-Id": g.conversationId,
        "X-Voice-Message": "true",
        "Content-Type": mp.contentType, "Content-Length": String(mp.body.length),
      },
      body: mp.body,
    });
    if (!upRes.ok) return text(`Generated audio but failed to send: ${await upRes.text()}`);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return text("Voice message sent successfully.");
}

async function getChannelHistory(
  _id: string,
  params: { limit?: number; before?: string }
): Promise<ToolResult> {
  const g = gw();
  const limit = Math.min(Math.max(params.limit || 50, 1), 100);
  const qs = new URLSearchParams({
    platform: g.platform, channelId: g.channelId, conversationId: g.conversationId, limit: String(limit),
  });
  if (params.before) qs.set("before", params.before);

  const { data, error } = await gatewayFetch<{
    messages: Array<{ timestamp: string; user: string; text: string; isBot?: boolean }>;
    nextCursor: string | null; hasMore: boolean; note?: string;
  }>(g, `/internal/history?${qs}`, {});
  if (error) return text(`Error: ${error}`);
  if (data!.note) return text(data!.note);
  const msgs = data!.messages;
  if (!msgs.length) return text("No messages found.");
  const fmt = msgs.map((m) => {
    const t = new Date(m.timestamp).toLocaleString();
    const s = m.isBot ? `[Bot] ${m.user}` : m.user;
    return `[${t}] ${s}: ${m.text}`;
  }).join("\n\n");
  let result = `Found ${msgs.length} messages:\n\n${fmt}`;
  if (data!.hasMore && data!.nextCursor) result += `\n\n---\nMore available. Use before="${data!.nextCursor}" for older messages.`;
  return text(result);
}

// ---------------------------------------------------------------------------
// Task sync helpers — forward Claude Code's TaskCreate/TaskUpdate/TaskList
// tool calls to the gateway's internal task API so they appear in the board.
// ---------------------------------------------------------------------------

const TASK_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate", "TaskList"]);

// Map Claude Code task status to our status enum
function normalizeStatus(s?: string): "pending" | "in_progress" | "completed" {
  if (s === "in_progress") return "in_progress";
  if (s === "completed") return "completed";
  return "pending";
}

// Map Claude Code activeForm / status fields to a boardColumn
function deriveBoardColumn(status?: string): string {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "done";
  return "backlog";
}

async function syncTaskToGateway(toolName: string, input: Record<string, unknown>): Promise<void> {
  if (toolName === "TaskList") return; // read-only, nothing to sync

  const g = gw();
  if (!g.gatewayUrl || !g.workerToken) return;

  // TaskCreate: { subject, description, activeForm, metadata }
  // TaskUpdate: { taskId, status, subject, description, owner, metadata, addBlocks, addBlockedBy }
  // Both need to be upserted. We derive a stable id from the taskId field or generate one.
  const taskId = (input.taskId ?? input.id) as string | undefined;
  if (!taskId && toolName !== "TaskCreate") return;

  const subject = (input.subject ?? "") as string;
  if (!subject && toolName === "TaskCreate") return;

  const status = normalizeStatus((input.status as string) ?? undefined);
  const boardColumn = deriveBoardColumn((input.status as string) ?? undefined);
  const owner = (input.owner as string | null) ?? null;

  // Use taskId for updates, generate a deterministic id for creates
  // Claude Code assigns a numeric/string id — we store it as-is
  const id = taskId ?? `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const body = {
    id,
    subject: subject || `Task ${id}`,
    description: (input.description as string) ?? "",
    status,
    owner,
    boardColumn,
    metadata: (input.metadata as Record<string, unknown>) ?? undefined,
    updatedAt: Date.now(),
    blocks: (input.addBlocks as string[]) ?? [],
    blockedBy: (input.addBlockedBy as string[]) ?? [],
  };

  try {
    await fetch(`${g.gatewayUrl}/internal/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${g.workerToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Fire-and-forget — never block the team
  }
}

// ---------------------------------------------------------------------------
// Subagent activity posting — forwards tool_use/tool_result events from
// the Claude Code subprocess to /internal/agent-activity so the activity
// feed shows what delegated agents are doing in real time.
// ---------------------------------------------------------------------------

// Tools we never want to surface as activity (too noisy / internal)
const SILENT_TOOLS = new Set(["TodoRead", "TodoWrite"]);

async function postSubagentActivity(
  agentName: string,
  type: "tool_start" | "tool_end" | "turn_end",
  tool?: string,
  text?: string
): Promise<void> {
  const g = gw();
  if (!g.gatewayUrl || !g.workerToken) return;

  const body: Record<string, unknown> = {
    type,
    agentName,
    timestamp: Date.now(),
    ...(tool && { tool }),
    ...(text && { text }),
  };

  try {
    await fetch(`${g.gatewayUrl}/internal/agent-activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${g.workerToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Fire-and-forget
  }
}

// ---------------------------------------------------------------------------
// DelegateToProject (Claude Code team management)
// ---------------------------------------------------------------------------

interface TeamProcess {
  sessionName: string;
  projectId: string;
  startedAt: number;
  output: string;
  completed: boolean;
  exitCode: number | null;
}

const activeTeams = new Map<string, TeamProcess>();

function getProjectWorkspace(projectId: string): string {
  return join(homedir(), "projects", projectId);
}

async function delegateToProject(
  _id: string,
  params: { projectId: string; task: string; allowedTools?: string }
): Promise<ToolResult> {
  const projectDir = getProjectWorkspace(params.projectId);
  await mkdir(projectDir, { recursive: true });

  const claudeDir = join(projectDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  // Check if CLAUDE.md exists at either conventional location
  const claudeMdRoot = join(projectDir, "CLAUDE.md");
  const claudeMdDot = join(claudeDir, "CLAUDE.md");
  const hasCLAUDEmd =
    await stat(claudeMdRoot).then(() => true, () => false) ||
    await stat(claudeMdDot).then(() => true, () => false);

  if (!hasCLAUDEmd) {
    // Try claude init --yes for a richer bootstrap; fall back to minimal file
    const initResult = spawnSync("claude", ["init", "--yes"], {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env } as Record<string, string>,
    });
    const initSucceeded =
      initResult.status === 0 &&
      (await stat(claudeMdRoot).then(() => true, () => false) ||
       await stat(claudeMdDot).then(() => true, () => false));

    if (!initSucceeded) {
      await writeFile(claudeMdDot, `# Project: ${params.projectId}\n\nManaged project workspace.\n`, "utf-8");
    }
  }

  const existing = activeTeams.get(params.projectId);
  if (existing && !existing.completed) {
    return text(`Error: A team is already running for "${params.projectId}". Use CheckTeamStatus.`);
  }

  const sessionName = `peon-${params.projectId}`;
  const subagentName = `delegate:${params.projectId}`;
  const allowedTools = params.allowedTools || "Read,Edit,Write,Bash,Grep,Glob";

  const team: TeamProcess = {
    sessionName,
    projectId: params.projectId,
    startedAt: Date.now(),
    output: "",
    completed: false,
    exitCode: null,
  };
  activeTeams.set(params.projectId, team);

  // Run tmux-based Claude Code launch in a non-blocking async task
  // so we can return status to the caller while the agent runs
  (async () => {
    try {
      await createSession(sessionName, projectDir);

      // Build the claude command with --dangerously-skip-permissions and stream-json output
      const claudeCmd = [
        "claude",
        "--dangerously-skip-permissions",
        "--output-format", "stream-json",
        "--allowedTools", allowedTools,
        "-p", params.task,
      ].join(" ");

      await sendKeys(sessionName, claudeCmd);

      // Poll pane output for completion, parsing stream-json lines
      let lastPaneLength = 0;
      const pollInterval = 200;
      const maxWaitMs = 10 * 60 * 1000; // 10 minutes
      const start = Date.now();

      while (Date.now() - start < maxWaitMs) {
        if (!await hasSession(sessionName)) {
          team.completed = true;
          team.exitCode = 0;
          break;
        }

        const pane = await capturePane(sessionName).catch(() => "");
        if (pane.length > lastPaneLength) {
          const newText = pane.slice(lastPaneLength);
          lastPaneLength = pane.length;
          team.output += newText;

          // Parse stream-json events from new output
          for (const line of newText.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const ev = JSON.parse(trimmed) as Record<string, unknown>;

              if (ev.type === "tool_use" && typeof ev.name === "string") {
                const toolName = ev.name;
                const toolInput = (ev.input && typeof ev.input === "object")
                  ? ev.input as Record<string, unknown>
                  : {};
                if (TASK_TOOL_NAMES.has(toolName)) {
                  syncTaskToGateway(toolName, toolInput).catch(() => {});
                }
                if (!SILENT_TOOLS.has(toolName)) {
                  const activityText = buildToolActivityText(toolName, toolInput);
                  postSubagentActivity(subagentName, "tool_start", toolName, activityText).catch(() => {});
                }
              } else if (ev.type === "tool_result") {
                const toolId = (ev.tool_use_id as string | undefined) ?? "";
                if (toolId) {
                  postSubagentActivity(subagentName, "tool_end").catch(() => {});
                }
              } else if (ev.type === "message" && (ev as Record<string, unknown>).stop_reason === "end_turn") {
                postSubagentActivity(subagentName, "turn_end").catch(() => {});
                // Claude finished — session will exit on its own
                team.completed = true;
                team.exitCode = 0;
              } else if (ev.type === "result") {
                team.completed = true;
                team.exitCode = 0;
              }
            } catch { /* not JSON — terminal output, ignore */ }
          }
        }

        if (team.completed) break;
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      if (!team.completed) {
        // Timed out
        team.completed = true;
        team.exitCode = 1;
      }
    } catch (err) {
      team.completed = true;
      team.exitCode = 1;
      team.output += `\nError: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await killSession(sessionName).catch(() => {});
    }
  })();

  return text(`Delegated task to project "${params.projectId}" (tmux session: ${sessionName}). Use CheckTeamStatus to poll and GetTeamResult when done.`);
}

async function checkTeamStatus(
  _id: string,
  params: { projectId: string }
): Promise<ToolResult> {
  const team = activeTeams.get(params.projectId);
  if (!team) return text(`No team found for "${params.projectId}".`);
  const elapsed = Math.floor((Date.now() - team.startedAt) / 1000);
  if (team.completed) return text(`Team for "${params.projectId}" completed (exit ${team.exitCode}) after ${elapsed}s.`);
  return text(`Team for "${params.projectId}" is still running (${elapsed}s elapsed).`);
}

async function getTeamResult(
  _id: string,
  params: { projectId: string }
): Promise<ToolResult> {
  const team = activeTeams.get(params.projectId);
  if (!team) return text(`No team found for "${params.projectId}".`);
  if (!team.completed) return text(`Team still running. Use CheckTeamStatus.`);
  let resultText = "";
  for (const line of team.output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed);
      if (ev.type === "result" && typeof ev.result === "string") resultText = ev.result;
    } catch { /* not JSON */ }
  }
  activeTeams.delete(params.projectId);
  return text(resultText || `Team completed with exit code ${team.exitCode}. No text result captured.`);
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default function register(api: any): void {
  api.registerTool({
    name: "UploadUserFile",
    description: "Share files with the user (visualizations, charts, documents, etc.)",
    parameters: { type: "object", properties: { file_path: { type: "string", description: "Path to the file" }, description: { type: "string", description: "Optional description" } }, required: ["file_path"] },
    execute: uploadUserFile,
  });

  api.registerTool({
    name: "ScheduleReminder",
    description: "Schedule a task for later. Use delayMinutes for one-time or cron for recurring.",
    parameters: { type: "object", properties: { task: { type: "string" }, delayMinutes: { type: "number" }, cron: { type: "string" }, maxIterations: { type: "number" } }, required: ["task"] },
    execute: scheduleReminder,
  });

  api.registerTool({
    name: "CancelReminder",
    description: "Cancel a previously scheduled reminder.",
    parameters: { type: "object", properties: { scheduleId: { type: "string" } }, required: ["scheduleId"] },
    execute: cancelReminder,
  });

  api.registerTool({
    name: "ListReminders",
    description: "List all pending reminders.",
    parameters: { type: "object", properties: {} },
    execute: listReminders,
  });

  api.registerTool({
    name: "SearchExtensions",
    description: "Search for installable extensions (skills, MCP servers).",
    parameters: { type: "object", properties: { query: { type: "string" }, type: { type: "string", description: '"skill" or "mcp"' }, limit: { type: "number" } }, required: ["query"] },
    execute: searchExtensions,
  });

  api.registerTool({
    name: "InstallExtension",
    description: "Generate an install link for an extension.",
    parameters: { type: "object", properties: { id: { type: "string" }, type: { type: "string", description: '"skill" or "mcp"' }, reason: { type: "string" }, envVars: { type: "array", items: { type: "string" } }, nixPackages: { type: "array", items: { type: "string" } } }, required: ["id", "type"] },
    execute: installExtension,
  });

  api.registerTool({
    name: "GetSettingsLink",
    description: "Generate a settings link for the user to configure their agent.",
    parameters: { type: "object", properties: { reason: { type: "string" }, message: { type: "string" }, prefillEnvVars: { type: "array", items: { type: "string" } }, prefillGrants: { type: "array", items: { type: "string" } } }, required: ["reason"] },
    execute: getSettingsLink,
  });

  api.registerTool({
    name: "GetSettingsLinkForDomain",
    description: "Generate a settings link with domains pre-filled for access approval.",
    parameters: { type: "object", properties: { reason: { type: "string" }, prefillGrants: { type: "array", items: { type: "string" } } }, required: ["reason", "prefillGrants"] },
    execute: getSettingsLinkForDomain,
  });

  api.registerTool({
    name: "GenerateAudio",
    description: "Generate audio from text (text-to-speech).",
    parameters: { type: "object", properties: { text: { type: "string" }, voice: { type: "string" }, speed: { type: "number" } }, required: ["text"] },
    execute: generateAudio,
  });

  api.registerTool({
    name: "GetChannelHistory",
    description: "Fetch previous messages from this conversation thread.",
    parameters: { type: "object", properties: { limit: { type: "number", description: "Messages to fetch (max 100)" }, before: { type: "string", description: "ISO timestamp cursor" } } },
    execute: getChannelHistory,
  });

  api.registerTool({
    name: "AskUserQuestion",
    description: "Post a question with button options. Session ends after posting.",
    parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question", "options"] },
    execute: askUserQuestion,
  });

  api.registerTool({
    name: "DelegateToProject",
    description: "Send a coding task to a project's Claude Code team. Returns the result when done.",
    parameters: { type: "object", properties: { projectId: { type: "string", description: "Project identifier (maps to ~/projects/{id})" }, task: { type: "string", description: "Coding task (natural language)" }, allowedTools: { type: "string", description: 'Comma-separated tools (default: "Read,Edit,Write,Bash,Grep,Glob")' } }, required: ["projectId", "task"] },
    execute: delegateToProject,
  });

  api.registerTool({
    name: "CheckTeamStatus",
    description: "Check if a project's Claude Code team is still working.",
    parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    execute: checkTeamStatus,
  });

  api.registerTool({
    name: "GetTeamResult",
    description: "Get the result from a completed Claude Code team task.",
    parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
    execute: getTeamResult,
  });
}
