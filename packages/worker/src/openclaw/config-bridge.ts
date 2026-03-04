/**
 * Config bridge: translates gateway session context into OpenClaw config files.
 *
 * Maps the gateway's session-context response to the file structure
 * OpenClaw expects under ~/.openclaw/ (HOME=/workspace in Docker):
 *
 *   /workspace/
 *     SOUL.md                    <- master agent identity (matches agents.list workspace)
 *   ~/.openclaw/
 *     openclaw.json              <- updated dynamically (agents.model, agents.apiKey)
 *     workspace-master/
 *       SOUL.md                  <- safety copy (fallback if agents.list missing)
 *     agents/<id>/agent/
 *       SOUL.md                  <- project agent identity
 *     skills/
 *       gateway-skills/SKILL.md  <- skillsInstructions
 *       peon-tools/SKILL.md      <- custom tools manifest
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createLogger } from "@lobu/core";
import type { ProviderConfig } from "./session-context";

const logger = createLogger("config-bridge");

/** Resolve the OpenClaw home directory (~/.openclaw). */
function getOpenClawHome(): string {
  return path.join(os.homedir(), ".openclaw");
}

export interface TeamMemberInfo {
  roleName: string;
  displayName: string;
  systemPrompt: string;
}

export interface ConfigBridgeInput {
  /** The workspace root directory (e.g., /workspace) — used for provider state only */
  workspaceDir: string;
  /** Combined gateway instructions (agent + platform + network + skills + MCP) */
  gatewayInstructions: string;
  /** Worker-local custom instructions */
  customInstructions: string;
  /** Provider config from session context */
  providerConfig: ProviderConfig;
  /** OpenClaw agent id — "master" for orchestrator, "project-<id>" for project agents */
  openclawAgentId?: string;
  /** Configured team members for the active project */
  teamMembers?: TeamMemberInfo[];
  /** CLI backends for coding agents */
  cliBackends?: Array<{
    providerId: string;
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Write all OpenClaw config files based on the gateway session context.
 *
 * Writes to ~/.openclaw/ which OpenClaw reads at runtime.
 * The bootstrap config (openclaw.json) is written once by bootstrap-config.ts;
 * here we only update the dynamic parts (agents section, SOUL.md, skills).
 */
export async function writeOpenClawConfig(
  input: ConfigBridgeInput
): Promise<void> {
  const openclawDir = getOpenClawHome();
  const agentId = input.openclawAgentId ?? "master";

  // Master agent workspace is /workspace (matches agents.list in bootstrap config).
  // Project agents use ~/.openclaw/agents/<id>/agent/.
  const soulDir = agentId === "master"
    ? "/workspace"
    : path.join(openclawDir, "agents", agentId, "agent");

  const skillsDir = path.join(openclawDir, "skills");
  const gatewaySkillsDir = path.join(skillsDir, "gateway-skills");
  const peonToolsDir = path.join(skillsDir, "peon-tools");

  await fs.mkdir(soulDir, { recursive: true });
  await fs.mkdir(gatewaySkillsDir, { recursive: true });
  await fs.mkdir(peonToolsDir, { recursive: true });

  const writes: Promise<void>[] = [
    writeSoulMd(soulDir, input),
    writeAgentsMd(soulDir),
    writeBootstrapMd(soulDir),
    updateOpenClawAgentsConfig(openclawDir, input.providerConfig),
    writeGatewaySkill(gatewaySkillsDir, input.gatewayInstructions),
    writePeonToolsSkill(peonToolsDir),
    writeSessionContext(openclawDir),
  ];

  // Safety net: also write identity files to workspace-master/ so the agent
  // gets the Peon persona even if the agents.list is missing and OpenClaw
  // falls back to its default workspace-master directory.
  if (agentId === "master") {
    const fallbackDir = path.join(openclawDir, "workspace-master");
    writes.push(
      fs.mkdir(fallbackDir, { recursive: true }).then(async () => {
        await writeSoulMd(fallbackDir, input);
        await writeAgentsMd(fallbackDir);
        await writeBootstrapMd(fallbackDir);
      }),
    );
  }

  await Promise.all(writes);

  logger.info(`OpenClaw config written to ${openclawDir} (agent=${agentId})`);
}

/**
 * SOUL.md — the main system prompt / orchestrator personality.
 * For master: written to /workspace/SOUL.md (the agent's configured workspace).
 * For project agents: written to ~/.openclaw/agents/<id>/agent/SOUL.md.
 */
async function writeSoulMd(
  workspaceDir: string,
  input: ConfigBridgeInput
): Promise<void> {
  const parts: string[] = [];

  parts.push(`# Peon — Team Lead

You are Peon, an AI team orchestrator. Users talk to you in chat; you coordinate
a team of Claude Code agents to build and maintain their software project.

## When a user connects a new project

Walk through this flow — don't skip steps:

### Step 1: Gather requirements

**IMPORTANT: If no BACKLOG.md exists in the workspace, proactively start this step
as soon as the user sends their first message. Don't wait for them to ask.**

Greet the user — brief, direct, no fluff:
"Hey. I'm your Peon lead — I coordinate your team and make sure work gets done."

Ask exactly what you need:
- What are you building? (brief description)
- GitHub repo URL (or start fresh)
- What's the first thing the team should tackle?

No identity questions. No name/emoji/creature. Straight to work.
Keep it to 3 questions max. Don't over-interrogate.

### Step 2: Create BACKLOG.md
Once you have enough context, create \`BACKLOG.md\` in the workspace:
- Break the work into tasks (TASK 1, TASK 2, etc.)
- Each task: what, which files, acceptance criteria, test requirements
- Include a build order
- Include "what NOT to build" to keep scope tight

Show the user a summary and ask if anything needs adjusting.

### Step 3: Spawn the Claude Code team
Call DelegateToProject with:
- The full BACKLOG.md content as context
- Team members matching the project type (always include a lead + at least one coder + qa)
- The lead agent's job: read BACKLOG.md, spawn teammates, coordinate, iterate until done
- Each teammate: clear file-scope boundaries to avoid conflicts
- Definition of done: working + tests passing + manually verified — not just "code written"
- Notify when done: \`openclaw system event --text "Team done: <summary>" --mode now\`

**Before delegating, use CreateProjectTasks to add each task to the board so the user sees progress visually.**

### Step 4: Set up HEARTBEAT.md
After spawning the team, create \`HEARTBEAT.md\` in the workspace:

\`\`\`markdown
## Monitoring: Claude Code team

Session: <lead_session_id>

Every heartbeat:
1. Check session log for activity
2. If stuck (no progress in 2+ checks) → nudge via process paste
3. If errors/test failures → send targeted fix guidance
4. If done → report to user in chat, clear this file

Update user in chat only when:
- A task completes
- Something is broken and needs attention
- The whole team is done
\`\`\`

### Step 5: Report back
When the team finishes:
- Summarize what was built in chat
- List what's working and what tests pass
- Flag anything incomplete or needing the user's attention
- Clear HEARTBEAT.md

---

## How you coordinate mid-flight

- User asks "what's the team working on?" → check session log, summarize in plain language
- User says "reprioritize X" → update BACKLOG.md, message the lead session via process paste
- User says "add another agent" → spawn additional teammate via DelegateToProject with focused scope
- Agent gets stuck → detected via HEARTBEAT, nudge with specific guidance
- Tests failing → send the error + targeted fix suggestion to the relevant agent

## Key rules

- Create tasks on the board (CreateProjectTasks) before delegating so the user sees progress visually
- Always set file-scope boundaries per agent to avoid git conflicts
- Commit working code after each task — not at the end
- Never declare done without verified tests passing
- If something is ambiguous, ask the user — don't guess on scope
- Be action-oriented. Don't narrate or reflect on your tools.
- Never discuss your own architecture, tool availability, or internal processes unless explicitly asked.
- When delegating, always include the full configured team as teamMembers in the DelegateToProject call.
- Maintain context across messages — you are the persistent brain that remembers everything.

## Task Breakdown

When a user sends a coding request, break it into subtasks and use **CreateProjectTasks** to put them on the board. Each subtask should:
- Have a clear, actionable **subject** (e.g., "Add user authentication endpoint")
- Include a **description** with acceptance criteria and relevant context
- Optionally assign an **owner** role (e.g., "frontend", "backend", "qa")

Tasks created via CreateProjectTasks appear in the **Todo** column. As agents work on them:
- Agent picks up task → moves to **In Progress** (boardColumn: "in_progress", owner set)
- Agent finishes → moves to **Done** (boardColumn: "done")
`);

  if (input.teamMembers?.length) {
    parts.push(buildTeamSection(input.teamMembers));
  }

  if (input.customInstructions) {
    parts.push(input.customInstructions);
  }

  await fs.writeFile(
    path.join(workspaceDir, "SOUL.md"),
    parts.join("\n\n"),
    "utf-8"
  );
}

/**
 * AGENTS.md — Peon-specific agent behavior defaults.
 * Written alongside SOUL.md to every workspace directory.
 */
async function writeAgentsMd(workspaceDir: string): Promise<void> {
  const agentsMd = `# AGENTS.md

## Peon-specific: You are a coding team lead

When the user connects a project for the first time (no BACKLOG.md exists):
- Don't wait for them to ask — proactively start requirements gathering
- Use AskUserQuestion for structured choices
- Create BACKLOG.md before spawning any agents
- Set up HEARTBEAT.md after spawning so you stay on top of the team
`;

  await fs.writeFile(
    path.join(workspaceDir, "AGENTS.md"),
    agentsMd,
    "utf-8"
  );
}

/**
 * BOOTSTRAP.md — first-run behavior for the lead agent.
 * Written alongside SOUL.md to every workspace directory.
 */
async function writeBootstrapMd(workspaceDir: string): Promise<void> {
  const bootstrapMd = `# BOOTSTRAP.md

You are the Peon lead agent. A user has just created or opened this project.

If this is a new project (no BACKLOG.md exists):
1. Greet the user — brief, direct, no fluff
2. Ask: what are they building, what's the GitHub repo, what's the first task
3. Once they answer: analyze the repo, write BACKLOG.md, push tasks to board, spawn the team

If BACKLOG.md already exists:
1. Read it
2. Check which tasks are done vs pending
3. Tell the user the current state and ask what to tackle next

Do not ask for names, emojis, or personal details. This is a work context.
`;

  await fs.writeFile(
    path.join(workspaceDir, "BOOTSTRAP.md"),
    bootstrapMd,
    "utf-8"
  );
}

/**
 * Build the "Your Team" SOUL.md section from configured team members.
 * Constrains the orchestrator to only use these roles when delegating.
 */
function buildTeamSection(members: TeamMemberInfo[]): string {
  const lines = members.map((m) => {
    const firstLine = (m.systemPrompt.split("\n")[0] ?? "").slice(0, 120);
    return `- **${m.displayName}** (role: ${m.roleName}) — ${firstLine}`;
  });

  return `## Your Team

When delegating work via DelegateToProject, ALWAYS pass the full team below as teamMembers.
Only use the roles listed here — do not invent new roles.

${lines.join("\n")}`;
}

/**
 * Update the agents section of openclaw.json dynamically.
 *
 * The bootstrap config creates the full openclaw.json with gateway, channels,
 * skills, and tools sections. Here we only update the agents section with
 * the current provider/model from the gateway session context.
 */
async function updateOpenClawAgentsConfig(
  openclawDir: string,
  providerConfig: ProviderConfig
): Promise<void> {
  const configPath = path.join(openclawDir, "openclaw.json");

  // Read existing bootstrap config
  let config: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(raw);
  } catch {
    // No bootstrap config yet — write a minimal one
    logger.warn("No bootstrap openclaw.json found, writing minimal config");
  }

  // Update agents.defaults with current provider config
  const agents: Record<string, unknown> = (config.agents as Record<string, unknown>) || {};
  const defaults: Record<string, unknown> = (agents.defaults as Record<string, unknown>) || {};

  if (providerConfig.defaultProvider && providerConfig.defaultModel) {
    defaults.model = `${providerConfig.defaultProvider}/${providerConfig.defaultModel}`;
  } else if (providerConfig.defaultModel) {
    defaults.model = providerConfig.defaultModel;
  }

  agents.defaults = defaults;
  config.agents = agents;

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Gateway skills — the instructions passed down from the gateway
 * (agent instructions, platform instructions, MCP status, etc).
 */
async function writeGatewaySkill(
  skillDir: string,
  gatewayInstructions: string
): Promise<void> {
  if (!gatewayInstructions.trim()) return;

  const skillMd = `# Gateway Instructions

These instructions are provided by the Peon gateway and contain platform-specific
configuration, network access rules, MCP server status, and other dynamic context.

---

${gatewayInstructions}
`;

  await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
}

/**
 * Peon tools skill — describes the custom gateway integration tools
 * available to the orchestrator.
 */
async function writePeonToolsSkill(skillDir: string): Promise<void> {
  const skillMd = `# Peon Gateway Tools

These tools integrate with the Peon gateway to provide user-facing capabilities.

## Available Tools

- **UploadUserFile** — Share files (charts, reports, images) with the user
- **ScheduleReminder** — Schedule one-time or recurring tasks
- **CancelReminder** — Cancel a scheduled reminder
- **ListReminders** — List pending reminders
- **SearchExtensions** — Find installable skills and MCP servers
- **InstallExtension** — Generate install link for an extension
- **GetSettingsLink** — Generate link for user to configure settings
- **GetSettingsLinkForDomain** — Request domain access approval
- **GenerateAudio** — Text-to-speech generation
- **GetChannelHistory** — Fetch previous messages in the thread
- **AskUserQuestion** — Post a question with button options
- **CreateProjectTasks** — Create tasks on a project's kanban board (Todo column). Use this to break down a user request into trackable tasks before delegating. Pass projectId and an array of { subject, description?, owner? }.
- **UpdateTaskStatus** — Move a task between board columns. Pass taskId, status ('in_progress' | 'done' | 'blocked'), and optional owner. Updates the board in real time.
- **DelegateToProject** — Send a coding task to your team. ALWAYS include the full configured team as teamMembers (from the "Your Team" section in your instructions). The lead session spawns teammates automatically.
- **CheckTeamStatus** — Check if a Claude Code team is still working
- **GetTeamResult** — Get the result from a completed team task
`;

  await fs.writeFile(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");
}

/**
 * Write per-session context for the peon-gateway plugin.
 *
 * The plugin runs in OpenClaw's process and cannot see env vars set
 * by the worker after startup. This file bridges the gap — the worker
 * writes it before each turn and the plugin reads it on every tool call.
 */
async function writeSessionContext(openclawDir: string): Promise<void> {
  const ctx = {
    channelId: process.env.CHANNEL_ID || "",
    conversationId: process.env.CONVERSATION_ID || "",
    platform: process.env.PLATFORM || "web",
  };
  await fs.writeFile(
    path.join(openclawDir, ".peon-session.json"),
    JSON.stringify(ctx),
    "utf-8"
  );
}

/**
 * Remove stale OpenClaw session files (e.g., on provider change).
 * OpenClaw stores sessions under ~/.openclaw/ — we clear session data
 * so the next message starts fresh with the new provider.
 */
export async function clearOpenClawSession(
  _workspaceDir: string
): Promise<void> {
  const openclawDir = getOpenClawHome();
  const sessionFile = path.join(openclawDir, "session.jsonl");
  try {
    await fs.unlink(sessionFile);
    logger.info("Cleared OpenClaw session file");
  } catch {
    // File may not exist
  }
}
