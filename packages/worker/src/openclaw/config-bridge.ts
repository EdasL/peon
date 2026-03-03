/**
 * Config bridge: translates gateway session context into OpenClaw config files.
 *
 * Maps the gateway's session-context response to the file structure
 * OpenClaw expects under ~/.openclaw/ (HOME=/workspace in Docker):
 *
 *   ~/.openclaw/
 *     openclaw.json              <- updated dynamically (agents.model, agents.apiKey)
 *     workspace/
 *       SOUL.md                  <- agentInstructions + customInstructions
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

export interface ConfigBridgeInput {
  /** The workspace root directory (e.g., /workspace) — used for provider state only */
  workspaceDir: string;
  /** Combined gateway instructions (agent + platform + network + skills + MCP) */
  gatewayInstructions: string;
  /** Worker-local custom instructions */
  customInstructions: string;
  /** Provider config from session context */
  providerConfig: ProviderConfig;
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
  const workspaceDir = path.join(openclawDir, "workspace");
  const skillsDir = path.join(openclawDir, "skills");
  const gatewaySkillsDir = path.join(skillsDir, "gateway-skills");
  const peonToolsDir = path.join(skillsDir, "peon-tools");

  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(gatewaySkillsDir, { recursive: true });
  await fs.mkdir(peonToolsDir, { recursive: true });

  // Write all config files in parallel
  await Promise.all([
    writeSoulMd(workspaceDir, input),
    updateOpenClawAgentsConfig(openclawDir, input.providerConfig),
    writeGatewaySkill(gatewaySkillsDir, input.gatewayInstructions),
    writePeonToolsSkill(peonToolsDir),
    writeSessionContext(openclawDir),
  ]);

  logger.info(`OpenClaw config written to ${openclawDir}`);
}

/**
 * SOUL.md — the main system prompt / orchestrator personality.
 * Written to ~/.openclaw/workspace/SOUL.md (where OpenClaw reads it).
 */
async function writeSoulMd(
  workspaceDir: string,
  input: ConfigBridgeInput
): Promise<void> {
  const parts: string[] = [];

  parts.push(`# Peon Agent

You are a helpful AI coding assistant. You help users with software projects — writing code, answering questions, debugging, and managing tasks.

## How You Work

- **Direct work**: Use your built-in tools (Read, Edit, Write, Bash, Grep, Glob) to accomplish coding tasks directly in the workspace.
- **Project delegation**: When a project has been set up via DelegateToProject, you can send coding tasks to a dedicated Claude Code team that works in the project's directory. Use this for larger tasks in established projects.
- **Conversation**: For questions, planning, and discussion, respond directly.

## Key Rules

- Be action-oriented. When the user asks you to do something, do it. Do not narrate what you would do or reflect on your own tools — just execute.
- Never discuss your own architecture, tool availability, or internal processes unless the user explicitly asks.
- If a task can be done directly with your tools, do it directly. Only use DelegateToProject when there is an established project that benefits from a dedicated Claude Code team.
- Maintain context across messages — you are the persistent brain.
`);

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
- **DelegateToProject** — Send a coding task to a project's Claude Code team (use when a project directory exists)
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
