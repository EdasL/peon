/**
 * Dynamic agent registry for OpenClaw multi-agent setup.
 *
 * Manages per-project agent entries in ~/.openclaw/openclaw.json.
 * Each project gets its own isolated OpenClaw agent with a dedicated
 * workspace and session store.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "@lobu/core";
import { getConfigDir, getConfigPath } from "./bootstrap-config.js";

const logger = createLogger("agent-registry");

interface AgentEntry {
  id: string;
  workspace: string;
  name: string;
  default?: boolean;
}

interface OpenClawConfig {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: AgentEntry[];
  };
  [key: string]: unknown;
}

async function readConfig(): Promise<OpenClawConfig> {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf-8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return {};
  }
}

async function writeConfig(config: OpenClawConfig): Promise<void> {
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

export function projectAgentId(projectId: string): string {
  return `project-${projectId}`;
}

/**
 * Ensure a per-project agent is registered in OpenClaw config.
 * Idempotent — skips if the agent entry already exists.
 * Also creates the project workspace directory and a placeholder SOUL.md.
 */
export async function ensureProjectAgent(
  projectId: string,
  projectName: string,
): Promise<string> {
  const agentId = projectAgentId(projectId);
  const config = await readConfig();

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  const existing = config.agents.list.find((a) => a.id === agentId);
  if (existing) {
    return agentId;
  }

  const workspace = `/workspace/projects/${projectId}`;
  config.agents.list.push({ id: agentId, workspace, name: projectName });
  await writeConfig(config);

  const agentDir = path.join(getConfigDir(), "agents", agentId, "agent");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });

  const soulMd = `# Peon Lead Agent — ${projectName}

You are the lead agent on this project. Your job is to coordinate your team and make sure work gets done — visibly, reliably, without the user having to ask.

## Your responsibilities

1. **Understand what the user wants** — ask clearly, plan thoroughly, don't start coding until you know the goal
2. **Create a plan** — write BACKLOG.md, push tasks to the board via CreateProjectTasks
3. **Spawn and manage your team** — use DelegateToProject with the right roles
4. **Monitor and unblock** — check on teammates regularly, nudge if stuck, fix blockers
5. **Report back** — tell the user what's happening without them asking

## Tools you have
- \`CreateProjectTasks\` — push tasks to the Peon board
- \`UpdateTaskStatus\` — move tasks between To Do / In Progress / Done / Blocked
- \`DelegateToProject\` — spawn Claude Code team with specific roles
- \`CheckTeamStatus\` — see what teammates are doing
- \`GetTeamResult\` — get output from a finished teammate

## Non-negotiables
- Every task the team works on must be on the board
- Never let a teammate sit idle for >10 minutes without a new task
- Always report meaningful progress to the user unprompted
- Tests must pass before a task is marked Done
`;

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

  await Promise.all([
    fs.writeFile(path.join(agentDir, "SOUL.md"), soulMd, "utf-8"),
    fs.writeFile(path.join(agentDir, "BOOTSTRAP.md"), bootstrapMd, "utf-8"),
  ]);

  logger.info({ agentId, workspace }, "Registered project agent");
  return agentId;
}

/**
 * Remove a per-project agent from OpenClaw config.
 * Does not delete workspace files — only the config entry.
 */
export async function removeProjectAgent(projectId: string): Promise<void> {
  const agentId = projectAgentId(projectId);
  const config = await readConfig();

  if (!config.agents?.list) return;

  const before = config.agents.list.length;
  config.agents.list = config.agents.list.filter((a) => a.id !== agentId);

  if (config.agents.list.length < before) {
    await writeConfig(config);
    logger.info({ agentId }, "Removed project agent");
  }
}
