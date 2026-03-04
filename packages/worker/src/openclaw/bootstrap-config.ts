/**
 * Bootstrap config generator for OpenClaw.
 *
 * Writes the initial ~/.openclaw/openclaw.json that OpenClaw needs BEFORE
 * the gateway process starts. Also writes a minimal SOUL.md placeholder.
 *
 * This is separate from config-bridge.ts which writes per-session config
 * AFTER the gateway is running and a session context is fetched.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_PORT = 18789;
const SKILLS_DIR = "/app/packages/worker/src/openclaw/skills";
const PLUGIN_DIR = "/app/packages/worker/src/openclaw/plugins/peon-gateway";

interface BootstrapOptions {
  port?: number;
}

interface BootstrapResult {
  authToken: string;
}

export function getConfigDir(): string {
  return path.join(os.homedir(), ".openclaw");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "openclaw.json");
}

/**
 * Generate and write the bootstrap OpenClaw config before the gateway starts.
 *
 * Creates:
 *   ~/.openclaw/openclaw.json   — gateway, agents, channels, skills, tools config
 *   ~/.openclaw/workspace/SOUL.md — minimal placeholder soul
 */
export async function writeBootstrapConfig(
  options?: BootstrapOptions
): Promise<BootstrapResult> {
  const port = options?.port ?? (Number(process.env.OPENCLAW_PORT) || DEFAULT_PORT);

  const configDir = getConfigDir();
  const workspaceDir = path.join(configDir, "workspace");

  // Ensure directories exist
  await fs.mkdir(workspaceDir, { recursive: true });

  // OpenClaw v2026.2.26+ refuses bind=lan without auth. Use a token
  // passed via OPENCLAW_GATEWAY_TOKEN env var (set by docker-deployment.ts),
  // or generate a random one if not provided.
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN
    || crypto.randomBytes(32).toString("hex");

  const config = {
    gateway: {
      mode: "local",
      port,
      // Bind to LAN so the Peon gateway can connect from outside the container
      // via Docker networking. Security is maintained by token auth plus Docker
      // network isolation (peon-internal).
      bind: "lan",
      auth: { mode: "token", token: gatewayToken },
      controlUi: {
        allowedOrigins: ["*"],
      },
    },
    agents: {
      defaults: {
        model: "anthropic/claude-sonnet-4-20250514",
      },
      list: [
        {
          id: "master",
          default: true,
          workspace: "/workspace",
          name: "Orchestrator",
        },
      ],
    },
    channels: {},
    skills: {
      load: {
        extraDirs: [SKILLS_DIR],
      },
    },
    plugins: {
      load: {
        paths: [PLUGIN_DIR],
      },
    },
    tools: {
      agentToAgent: { enabled: true, allow: ["*"] },
    },
  };

  // Write config and SOUL.md in parallel
  await Promise.all([
    fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8"),
    fs.writeFile(
      path.join(workspaceDir, "SOUL.md"),
      "# Peon\n\nBootstrap placeholder — replaced at session start.\n",
      "utf-8"
    ),
  ]);

  // Use stderr directly — this function is invoked via `bun -e` where
  // stdout is a signaling channel (the entrypoint checks the exit code).
  console.error(`[bootstrap-config] Bootstrap config written to ${getConfigPath()} (port=${port})`);
  return { authToken: gatewayToken };
}

/**
 * Read the auth token from the OPENCLAW_GATEWAY_TOKEN env var.
 */
export function getBootstrapAuthToken(): string | null {
  return process.env.OPENCLAW_GATEWAY_TOKEN ?? null;
}
