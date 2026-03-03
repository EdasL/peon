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

  await fs.writeFile(
    path.join(agentDir, "SOUL.md"),
    `# ${projectName}\n\nYou are working on the "${projectName}" project. Use your tools to write code, run commands, and complete tasks in this workspace.\n`,
    "utf-8",
  );

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
