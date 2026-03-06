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

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { readFile, stat, writeFile, mkdir, unlink, copyFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
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
// CreateProjectTasks — orchestrator tool to pre-create tasks on the board
// before delegating to the team.
// ---------------------------------------------------------------------------

interface TaskInput {
  subject: string;
  description?: string;
  owner?: string;
}

async function createProjectTasks(
  _id: string,
  params: { projectId: string; tasks: TaskInput[] },
): Promise<ToolResult> {
  const g = gw();
  if (!g.gatewayUrl || !g.workerToken) {
    return text("Error: gateway not configured");
  }
  if (!params.tasks?.length) {
    return text("Error: at least one task is required");
  }

  const created: string[] = [];
  const errors: string[] = [];

  for (const t of params.tasks) {
    const id = crypto.randomUUID();
    const body = {
      id,
      subject: t.subject,
      description: t.description ?? "",
      status: "pending",
      owner: t.owner ?? null,
      boardColumn: "todo",
      updatedAt: Date.now(),
    };

    try {
      const res = await fetch(`${g.gatewayUrl}/internal/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${g.workerToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        created.push(id);
      } else {
        errors.push(`${t.subject}: ${res.statusText}`);
      }
    } catch (err) {
      errors.push(`${t.subject}: ${String(err)}`);
    }
  }

  const lines = [`Created ${created.length}/${params.tasks.length} tasks on the board.`];
  if (created.length > 0) {
    lines.push("Task IDs: " + created.join(", "));
  }
  if (errors.length > 0) {
    lines.push("Errors: " + errors.join("; "));
  }
  return text(lines.join("\n"));
}

async function updateTaskStatus(
  _id: string,
  params: { taskId: string; status: string; owner?: string },
): Promise<ToolResult> {
  const g = gw();
  if (!g.gatewayUrl || !g.workerToken) {
    return text("Error: gateway not configured");
  }
  if (!params.taskId) {
    return text("Error: taskId is required");
  }

  const statusMap: Record<string, { status: string; boardColumn: string }> = {
    in_progress: { status: "in_progress", boardColumn: "in_progress" },
    done: { status: "completed", boardColumn: "done" },
    blocked: { status: "pending", boardColumn: "todo" },
    todo: { status: "pending", boardColumn: "todo" },
  };

  const fallback = { status: "pending", boardColumn: "todo" };
  const mapped = statusMap[params.status] ?? fallback;

  const body: Record<string, unknown> = {
    id: params.taskId,
    subject: `Task ${params.taskId}`, // Preserved on upsert — gateway keeps existing subject
    description: "",
    status: mapped.status,
    boardColumn: mapped.boardColumn,
    updatedAt: Date.now(),
  };
  if (params.owner) body.owner = params.owner;

  try {
    const res = await fetch(`${g.gatewayUrl}/internal/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${g.workerToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return text(`Error updating task ${params.taskId}: ${res.statusText}`);
    }
    return text(`Task ${params.taskId} updated to "${params.status}".`);
  } catch (err) {
    return text(`Error updating task ${params.taskId}: ${String(err)}`);
  }
}

async function listProjectTasks(
  _id: string,
  _params: Record<string, never>,
): Promise<ToolResult> {
  const g = gw();
  if (!g.gatewayUrl || !g.workerToken) {
    return text("Error: gateway not configured");
  }

  try {
    const res = await fetch(`${g.gatewayUrl}/internal/tasks`, {
      method: "GET",
      headers: { Authorization: `Bearer ${g.workerToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return text(`Error fetching tasks: ${res.statusText}`);
    }
    const { tasks } = (await res.json()) as { tasks: Array<{ id: string; subject: string; status: string; boardColumn: string; owner: string | null }> };
    if (!tasks.length) {
      return text("No tasks on the board.");
    }
    const lines = [`Board tasks (${tasks.length}):`];
    for (const t of tasks) {
      const owner = t.owner ? ` | owner: ${t.owner}` : "";
      lines.push(`- [${t.id}] "${t.subject}" | status: ${t.status} | column: ${t.boardColumn}${owner}`);
    }
    return text(lines.join("\n"));
  } catch (err) {
    return text(`Error fetching tasks: ${String(err)}`);
  }
}

async function deleteTask(
  _id: string,
  params: { taskId: string },
): Promise<ToolResult> {
  const g = gw();
  if (!g.gatewayUrl || !g.workerToken) {
    return text("Error: gateway not configured");
  }
  if (!params.taskId) {
    return text("Error: taskId is required");
  }

  try {
    const res = await fetch(`${g.gatewayUrl}/internal/tasks/${encodeURIComponent(params.taskId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${g.workerToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return text(`Error deleting task ${params.taskId}: ${res.statusText}`);
    }
    return text(`Task ${params.taskId} deleted.`);
  } catch (err) {
    return text(`Error deleting task ${params.taskId}: ${String(err)}`);
  }
}

// Inline fallback for send_event.py in case the source file can't be copied
const SEND_EVENT_SCRIPT = `#!/usr/bin/env python3
import argparse, json, os, sys, urllib.request, urllib.error

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--event-type", required=True)
    p.add_argument("--source-app", required=True)
    p.add_argument("--gateway-url", default=None)
    p.add_argument("--worker-token", default=None)
    p.add_argument("--project-id", default=None)
    a = p.parse_args()
    ctx = {}
    try:
        raw = sys.stdin.read()
        if raw.strip(): ctx = json.loads(raw)
    except: pass
    payload = {"eventType": a.event_type, "agentId": a.source_app, "timestamp": int(__import__("time").time()*1000)}
    if "tool_name" in ctx: payload["toolName"] = ctx["tool_name"]
    if "tool_use_id" in ctx: payload["toolUseId"] = ctx["tool_use_id"]
    if "tool_input" in ctx and isinstance(ctx["tool_input"], dict): payload["toolInput"] = ctx["tool_input"]
    if "notification_type" in ctx: payload["notificationType"] = ctx["notification_type"]
    if "error" in ctx: payload["error"] = str(ctx["error"])[:500]
    if "task_id" in ctx: payload["taskId"] = ctx["task_id"]
    if "task_subject" in ctx: payload["taskSubject"] = ctx["task_subject"]
    if "task_description" in ctx: payload["taskDescription"] = ctx["task_description"]
    if "teammate_name" in ctx: payload["teammateName"] = ctx["teammate_name"]
    if a.project_id: payload["projectId"] = a.project_id
    gw = a.gateway_url or os.environ.get("GATEWAY_URL","http://localhost:8080")
    tk = a.worker_token or os.environ.get("WORKER_TOKEN","")
    data = json.dumps(payload).encode()
    req = urllib.request.Request(f"{gw}/internal/hook-events", data=data,
        headers={"Content-Type":"application/json","Authorization":f"Bearer {tk}"}, method="POST")
    try: urllib.request.urlopen(req, timeout=5)
    except: pass
    if a.event_type in ("Stop", "SessionEnd") and a.project_id:
        try:
            with open(f"/tmp/peon-team-done-{a.project_id}", "w") as f:
                f.write(str(int(__import__("time").time()*1000)))
        except: pass

if __name__ == "__main__": main()
`;

// ---------------------------------------------------------------------------
// DelegateToProject (Claude Code Agent Teams management)
// ---------------------------------------------------------------------------

interface TeamMember {
  roleName: string;
  displayName: string;
  systemPrompt: string;
}

interface TeamProcess {
  sessionName: string;
  projectId: string;
  startedAt: number;
  output: string;
  completed: boolean;
  exitCode: number | null;
  completionPromise: Promise<void>;
  resolveCompletion: () => void;
}

const activeTeams = new Map<string, TeamProcess>();

function sentinelPath(projectId: string): string {
  return `/tmp/peon-team-done-${projectId}`;
}

export function signalTeamCompletion(projectId: string): void {
  const team = activeTeams.get(projectId);
  if (team && !team.completed) {
    team.completed = true;
    team.exitCode = 0;
    team.resolveCompletion();
  }
}

function getProjectWorkspace(projectId: string): string {
  return join(homedir(), "projects", projectId);
}

/**
 * Build a prompt prefix that tells Claude Code to create an Agent Team
 * and spawn teammates with their specific role prompts.
 */
function buildTeamSpawnPrompt(members: TeamMember[]): string {
  const nonLead = members.filter((m) => m.roleName !== "lead");
  if (nonLead.length === 0) return "";

  const spawnLines = nonLead.map((m) => {
    const escapedPrompt = m.systemPrompt.replace(/"/g, '\\"');
    return `  - ${m.displayName} (role: ${m.roleName}): "${escapedPrompt}"`;
  }).join("\n");

  return `You are the team lead. Create an agent team and spawn the following teammates:

${spawnLines}

Each teammate is an independent Claude Code session. They coordinate through the shared task list and can message each other directly. You assign tasks and review results.

`;
}

async function delegateToProject(
  _id: string,
  params: {
    projectId: string;
    task: string;
    allowedTools?: string;
    role?: string;
    teamMembers?: TeamMember[];
    repoUrl?: string;
    claudeMd?: string;
  }
): Promise<ToolResult> {
  const projectDir = getProjectWorkspace(params.projectId);
  await mkdir(projectDir, { recursive: true });

  const claudeDir = join(projectDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  // Clone repo if provided and workspace isn't already a git repo
  if (params.repoUrl) {
    const hasGit = await stat(join(projectDir, ".git")).then(() => true, () => false);
    if (!hasGit) {
      const cloneResult = spawnSync("git", ["clone", params.repoUrl, "."], {
        cwd: projectDir,
        stdio: "pipe",
        timeout: 120000,
        env: { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "" } as Record<string, string>,
      });
      if (cloneResult.status !== 0) {
        const stderr = cloneResult.stderr?.toString() || "unknown error";
        return text(`Error: git clone failed for ${params.repoUrl}: ${stderr}`);
      }
    }
  }

  // Write CLAUDE.md — team-lead preamble + explicit content or init/placeholder
  const claudeMdRoot = join(projectDir, "CLAUDE.md");
  const claudeMdDot = join(claudeDir, "CLAUDE.md");

  const teamLeadPreamble = `# Team Lead Instructions

You are the lead agent. Before writing any code, you MUST spawn teammates using agent teams. Do not implement anything yourself except coordination and task breakdown. Spawn at minimum: backend, frontend, and qa teammates. Only start working once the team is active.

## Task Board (mandatory)

Every piece of work MUST be tracked on the board. Follow this protocol strictly:

1. Before delegation: call TaskCreate for each task with a clear subject and owner
2. When a teammate starts a task: call TaskUpdate with status "in_progress"
3. When a teammate finishes a task: call TaskUpdate with status "completed"
4. Use TodoWrite to track sub-steps within larger tasks

Never skip task status updates — the user watches the board to track progress.

`;

  if (params.claudeMd) {
    await writeFile(claudeMdDot, teamLeadPreamble + params.claudeMd, "utf-8");
  } else {
    const hasCLAUDEmd =
      await stat(claudeMdRoot).then(() => true, () => false) ||
      await stat(claudeMdDot).then(() => true, () => false);

    if (!hasCLAUDEmd) {
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
        const stderr = initResult.stderr?.toString() || "";
        console.error(`[DelegateToProject] claude init failed for ${params.projectId} (exit=${initResult.status}): ${stderr}`);
      }
      // Always write team-lead preamble into .claude/CLAUDE.md
      const existing = await readFile(claudeMdDot, "utf-8").catch(() => "");
      if (!existing.includes("Team Lead Instructions")) {
        await writeFile(claudeMdDot, teamLeadPreamble + existing, "utf-8");
      }
    } else {
      // CLAUDE.md exists — prepend team-lead preamble if not already there
      const target = await stat(claudeMdDot).then(() => claudeMdDot, () => claudeMdRoot);
      const existing = await readFile(target, "utf-8").catch(() => "");
      if (!existing.includes("Team Lead Instructions")) {
        await writeFile(claudeMdDot, teamLeadPreamble + existing, "utf-8");
      }
    }
  }

  // Deploy Claude Code hooks into the project workspace so every tool
  // call / status change fires back to /internal/hook-events via SSE.
  {
    const hooksDir = join(claudeDir, "hooks");
    await mkdir(hooksDir, { recursive: true });

    // Copy send_event.py from the worker's hooks directory.
    // __dirname is dist/openclaw/plugins/peon-gateway/ at runtime,
    // so we go up 5 levels to reach packages/worker/.claude/hooks/
    const workerRoot = join(__dirname, "..", "..", "..", "..");
    const workerHookSrc = join(workerRoot, ".claude", "hooks", "send_event.py");
    const destHook = join(hooksDir, "send_event.py");
    try {
      await copyFile(workerHookSrc, destHook);
    } catch {
      // Fallback: write a minimal send_event.py inline if source not found
      const script = SEND_EVENT_SCRIPT;
      await writeFile(destHook, script, { mode: 0o755 });
    }

    // Build the hook command with inline args (env vars aren't available in project workspaces)
    const gatewayUrl = process.env.DISPATCHER_URL || "http://localhost:8080";
    const workerToken = process.env.WORKER_TOKEN || "";
    const hookCmd = `python3 ${destHook} --gateway-url ${gatewayUrl} --worker-token ${workerToken} --project-id ${params.projectId}`;

    const hookEntry = (eventType: string) => ({
      matcher: "",
      hooks: [{ type: "command", command: `${hookCmd} --event-type ${eventType} --source-app \${AGENT_ID:-default}` }],
    });

    // Valid Claude Code hook events — NOT tool names
    const allEvents = [
      "PreToolUse", "PostToolUse", "PostToolUseFailure",
      "Notification", "Stop", "SessionEnd",
      "SubagentStart", "SubagentStop",
      "TaskCompleted", "TeammateIdle",
    ];

    const settings: Record<string, unknown> = {
      hooks: Object.fromEntries(allEvents.map((e) => [e, [hookEntry(e)]])),
    };

    await writeFile(join(projectDir, ".claude", "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
  }

  const existing = activeTeams.get(params.projectId);
  if (existing && !existing.completed) {
    return text(`Error: A team is already running for "${params.projectId}". Use CheckTeamStatus.`);
  }

  const sessionName = `peon-${params.projectId}`;
  const allowedTools = params.allowedTools || "Read,Edit,Write,Bash,Grep,Glob";
  const hasTeam = !!(params.teamMembers?.length && params.teamMembers.length > 0);

  const teamLeadPrefix = "You are a team lead. Your first action must be to create an agent team. Do not write a single line of code before your team is spawned and assigned tasks.\n\n";
  const teamSpawnPrompt = hasTeam
    ? buildTeamSpawnPrompt(params.teamMembers!)
    : "";
  const fullTask = teamLeadPrefix + teamSpawnPrompt + params.task;

  let resolveCompletion!: () => void;
  const completionPromise = new Promise<void>((r) => { resolveCompletion = r; });

  const team: TeamProcess = {
    sessionName,
    projectId: params.projectId,
    startedAt: Date.now(),
    output: "",
    completed: false,
    exitCode: null,
    completionPromise,
    resolveCompletion,
  };
  activeTeams.set(params.projectId, team);

  // Clean up any stale sentinel file from a previous run
  try { unlinkSync(sentinelPath(params.projectId)); } catch { /* ignore */ }

  // Background health check: polls tmux session and sentinel file to
  // resolve completionPromise when the team finishes or the session dies.
  const healthCheckInterval = setInterval(async () => {
    if (team.completed) { clearInterval(healthCheckInterval); return; }
    try {
      if (existsSync(sentinelPath(params.projectId))) {
        try { unlinkSync(sentinelPath(params.projectId)); } catch { /* ignore */ }
        if (!team.completed) {
          team.completed = true;
          team.exitCode = 0;
          team.resolveCompletion();
        }
        clearInterval(healthCheckInterval);
        return;
      }
      if (!await hasSession(sessionName)) {
        if (!team.completed) {
          team.completed = true;
          team.exitCode = 0;
          team.resolveCompletion();
        }
        clearInterval(healthCheckInterval);
      }
    } catch { /* ignore health-check errors */ }
  }, 2000);

  try {
    await createSession(sessionName, projectDir);

    if (hasTeam) {
      // --- Interactive mode for Agent Teams ---
      const claudeCmd = [
        "claude",
        "--dangerously-skip-permissions",
        "--teammate-mode", "in-process",
        "--allowedTools", allowedTools,
      ].join(" ");

      await sendKeys(sessionName, claudeCmd);

      // Wait for Claude's interactive input prompt (not a theme/onboarding prompt).
      const readyTimeout = 60_000;
      const readyStart = Date.now();
      let ready = false;
      while (Date.now() - readyStart < readyTimeout) {
        const pane = await capturePane(sessionName).catch(() => "");
        // #region agent log
        fetch('http://127.0.0.1:7528/ingest/3b5868df-547b-40a4-99d5-868316344423',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1162a6'},body:JSON.stringify({sessionId:'1162a6',location:'peon-gateway/index.ts:ready-check',message:'Pane capture during ready check',data:{pane:pane.slice(-500),elapsed:Date.now()-readyStart},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        const isThemePrompt = pane.includes("theme") || pane.includes("Theme") || pane.includes("onboarding");
        if (isThemePrompt) {
          console.error(`[DelegateToProject] Detected theme/onboarding prompt for ${params.projectId}, sending Enter to dismiss`);
          // #region agent log
          fetch('http://127.0.0.1:7528/ingest/3b5868df-547b-40a4-99d5-868316344423',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1162a6'},body:JSON.stringify({sessionId:'1162a6',location:'peon-gateway/index.ts:theme-detected',message:'Theme/onboarding prompt detected, sending Enter',data:{pane:pane.slice(-500)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          await sendKeys(sessionName, "");
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (pane.includes("Type your") || pane.includes("> ")) {
          ready = true;
          break;
        }
        if (!await hasSession(sessionName)) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!ready) {
        const finalPane = await capturePane(sessionName).catch(() => "");
        console.error(`[DelegateToProject] Claude did not become ready within ${readyTimeout}ms for ${params.projectId}`);
        // #region agent log
        fetch('http://127.0.0.1:7528/ingest/3b5868df-547b-40a4-99d5-868316344423',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1162a6'},body:JSON.stringify({sessionId:'1162a6',location:'peon-gateway/index.ts:ready-timeout',message:'Claude not ready - timeout',data:{pane:finalPane.slice(-800),projectId:params.projectId},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        team.completed = true;
        team.exitCode = 1;
        team.output += "\nError: Claude Code did not start within timeout";
        team.resolveCompletion();
        await killSession(sessionName).catch(() => {});
        clearInterval(healthCheckInterval);
        activeTeams.delete(params.projectId);
        const elapsed = Math.floor((Date.now() - team.startedAt) / 1000);
        return text(`Team for "${params.projectId}" failed after ${elapsed}s: Claude Code did not start within timeout.`);
      }

      // #region agent log
      fetch('http://127.0.0.1:7528/ingest/3b5868df-547b-40a4-99d5-868316344423',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1162a6'},body:JSON.stringify({sessionId:'1162a6',location:'peon-gateway/index.ts:task-send',message:'Sending task to Claude',data:{taskLength:fullTask.length,projectId:params.projectId,readyElapsed:Date.now()-readyStart},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await sendKeys(sessionName, fullTask);
    } else {
      // --- Print mode for solo tasks (no team) ---
      const claudeCmd = [
        "claude",
        "--dangerously-skip-permissions",
        "--output-format", "stream-json",
        "--allowedTools", allowedTools,
        "-p", fullTask,
      ].join(" ");

      await sendKeys(sessionName, claudeCmd);
    }
  } catch (err) {
    team.completed = true;
    team.exitCode = 1;
    const errMsg = err instanceof Error ? err.message : String(err);
    team.output += `\nError: ${errMsg}`;
    console.error(`[DelegateToProject] Error for ${params.projectId}:`, errMsg);
    team.resolveCompletion();
    clearInterval(healthCheckInterval);
    activeTeams.delete(params.projectId);
    return text(`Error starting team for "${params.projectId}": ${errMsg}`);
  }

  // Background cleanup: wait for the team to finish, then clean up resources.
  // This runs detached so DelegateToProject returns immediately.
  const maxWaitMs = hasTeam ? 30 * 60 * 1000 : 10 * 60 * 1000;
  void (async () => {
    try {
      const timeoutPromise = new Promise<void>((r) => setTimeout(r, maxWaitMs));
      await Promise.race([team.completionPromise, timeoutPromise]);

      if (!team.completed) {
        team.completed = true;
        team.exitCode = 1;
        team.output += `\nError: Timed out after ${hasTeam ? "30" : "10"} minutes`;
        console.error(`[DelegateToProject] Timed out for ${params.projectId} (mode=${hasTeam ? "team" : "solo"})`);
      }

      const finalPane = await capturePane(sessionName).catch(() => "");
      if (finalPane && !team.output.includes(finalPane.slice(-200))) {
        team.output += finalPane;
      }
    } catch (err) {
      if (!team.completed) {
        team.completed = true;
        team.exitCode = 1;
        team.output += `\nError: ${err instanceof Error ? err.message : String(err)}`;
      }
    } finally {
      clearInterval(healthCheckInterval);
      await killSession(sessionName).catch(() => {});
      try { unlinkSync(sentinelPath(params.projectId)); } catch { /* ignore */ }
    }
  })();

  return text(
    `Team launched for "${params.projectId}" (mode: ${hasTeam ? "agent-team" : "solo"}).` +
    `\nSession: ${sessionName}` +
    `\nWorkspace: ${projectDir}` +
    `\n\nThe team is running in the background. Use CheckTeamStatus to monitor progress and GetTeamResult when complete.`
  );
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

function extractTeamResult(team: TeamProcess): string {
  let resultText = "";
  for (const line of team.output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed);
      if (ev.type === "result" && typeof ev.result === "string") resultText = ev.result;
    } catch { /* not JSON — expected for interactive mode output */ }
  }

  if (!resultText && team.output.length > 0) {
    const maxLen = 4000;
    const t = team.output.length > maxLen
      ? "...(truncated)\n" + team.output.slice(-maxLen)
      : team.output;
    resultText = `[Terminal output]\n${t}`;
  }

  return resultText || `Team completed with exit code ${team.exitCode}. No output captured.`;
}

async function getTeamResult(
  _id: string,
  params: { projectId: string }
): Promise<ToolResult> {
  const team = activeTeams.get(params.projectId);
  if (!team) return text(`No team found for "${params.projectId}".`);
  if (!team.completed) return text(`Team still running. Use CheckTeamStatus.`);

  const resultText = extractTeamResult(team);
  activeTeams.delete(params.projectId);
  return text(resultText);
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
    name: "CreateProjectTasks",
    description: "Create tasks on a project's kanban board before delegating work. Use this to break down a user request into well-defined tasks that appear in the Todo column.",
    parameters: { type: "object", properties: { projectId: { type: "string", description: "Project identifier" }, tasks: { type: "array", description: "Tasks to create on the board", items: { type: "object", properties: { subject: { type: "string", description: "Short task title" }, description: { type: "string", description: "Detailed description of what needs to be done" }, owner: { type: "string", description: "Team member role to assign (e.g. 'frontend', 'backend')" } }, required: ["subject"] } } }, required: ["projectId", "tasks"] },
    execute: createProjectTasks,
  });

  api.registerTool({
    name: "UpdateTaskStatus",
    description: "Move a task between board columns. Updates the board in real time.",
    parameters: { type: "object", properties: { taskId: { type: "string", description: "Task ID to update" }, status: { type: "string", description: "New status: 'in_progress', 'done', 'blocked', or 'todo'" }, owner: { type: "string", description: "Optional agent role that owns this task" } }, required: ["taskId", "status"] },
    execute: updateTaskStatus,
  });

  api.registerTool({
    name: "ListProjectTasks",
    description: "List all tasks on the current project's board with their IDs, subjects, statuses, and owners. Use this to find task IDs for updating or deleting.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: listProjectTasks,
  });

  api.registerTool({
    name: "DeleteTask",
    description: "Remove a task from the project board permanently.",
    parameters: { type: "object", properties: { taskId: { type: "string", description: "Task ID to delete" } }, required: ["taskId"] },
    execute: deleteTask,
  });

  api.registerTool({
    name: "DelegateToProject",
    description: "Send a coding task to a project's Claude Code Agent Team. Handles workspace setup: clones repo (if repoUrl provided), writes CLAUDE.md (if claudeMd provided), then launches Claude Code. The lead session spawns teammates if teamMembers are provided.",
    parameters: { type: "object", properties: { projectId: { type: "string", description: "Project identifier (maps to ~/projects/{id})" }, task: { type: "string", description: "Coding task (natural language)" }, allowedTools: { type: "string", description: 'Comma-separated tools (default: "Read,Edit,Write,Bash,Grep,Glob")' }, role: { type: "string", description: "Team role performing this task (e.g. 'backend', 'frontend', 'qa')" }, repoUrl: { type: "string", description: "Git repository URL to clone into the project workspace (skipped if already cloned)" }, claudeMd: { type: "string", description: "Content for .claude/CLAUDE.md project context file" }, teamMembers: { type: "array", description: "Team members to spawn as Agent Team teammates. Each has roleName, displayName, systemPrompt.", items: { type: "object", properties: { roleName: { type: "string" }, displayName: { type: "string" }, systemPrompt: { type: "string" } }, required: ["roleName", "displayName", "systemPrompt"] } } }, required: ["projectId", "task"] },
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
