/**
 * Dynamic agent registry for OpenClaw multi-agent setup.
 *
 * Manages per-project agent entries in ~/.openclaw/openclaw.json.
 * Each project gets its own isolated OpenClaw agent with a dedicated
 * workspace, session store, and identity files.
 *
 * On first creation, writes static files (AGENTS.md, BOOTSTRAP.md,
 * peon-tools/SKILL.md) that don't change at runtime. Dynamic files
 * (SOUL.md, gateway-skills) are written per-message by config-bridge.ts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "@lobu/core";
import { getConfigDir, getConfigPath } from "./bootstrap-config.js";
import { writeAgentsMd, writeBootstrapMd, writePeonToolsSkill } from "./config-bridge.js";

const logger = createLogger("agent-registry");

/** Shared auth-profiles.json path (written by worker-entrypoint.sh at startup). */
const SHARED_AUTH_PROFILES = path.join(getConfigDir(), "auth-profiles.json");

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
 * Idempotent — skips config/static-file writes if the agent already exists.
 *
 * Always propagates auth-profiles.json from the shared location so tokens
 * stay in sync after container restarts.
 */
export async function ensureProjectAgent(
  projectId: string,
  projectName: string,
): Promise<string> {
  const agentId = projectAgentId(projectId);
  const config = await readConfig();

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  const agentDir = path.join(getConfigDir(), "agents", agentId, "agent");

  const existing = config.agents.list.find((a) => a.id === agentId);
  if (existing) {
    await propagateAuthProfiles(agentDir);
    return agentId;
  }

  const workspace = `/workspace/projects/${projectId}`;
  const isFirst = config.agents.list.length === 0;
  config.agents.list.push({
    id: agentId,
    workspace,
    name: projectName,
    ...(isFirst && { default: true }),
  });
  await writeConfig(config);

  await fs.mkdir(agentDir, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });

  const skillsDir = path.join(getConfigDir(), "skills", "peon-tools");
  await fs.mkdir(skillsDir, { recursive: true });

  const initialSoulMd = `# Peon — Code Orchestrator for ${projectName}\n\nBootstrap placeholder — replaced with full context on first message.\n`;

  await Promise.all([
    fs.writeFile(path.join(agentDir, "SOUL.md"), initialSoulMd, "utf-8"),
    writeAgentsMd(agentDir),
    writeBootstrapMd(agentDir),
    writePeonToolsSkill(skillsDir),
    propagateAuthProfiles(agentDir),
  ]);

  logger.info({ agentId, workspace }, "Registered project agent");
  return agentId;
}

/**
 * Copy the shared auth-profiles.json to a project agent directory.
 * The shared file is written by worker-entrypoint.sh at container startup
 * from CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
 */
async function propagateAuthProfiles(targetAgentDir: string): Promise<void> {
  const targetPath = path.join(targetAgentDir, "auth-profiles.json");

  try {
    await fs.mkdir(targetAgentDir, { recursive: true });
    await fs.copyFile(SHARED_AUTH_PROFILES, targetPath);
    await fs.chmod(targetPath, 0o600);
  } catch (err) {
    logger.warn({ err, targetAgentDir }, "Failed to propagate auth-profiles to project agent");
  }
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
