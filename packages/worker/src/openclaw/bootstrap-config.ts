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
import { createLogger } from "@lobu/core";

const logger = createLogger("bootstrap-config");

const DEFAULT_PORT = 18789;
const SKILLS_DIR = "/app/packages/worker/src/openclaw/skills";
const PLUGIN_DIR = "/app/packages/worker/src/openclaw/plugins/peon-gateway";

interface BootstrapOptions {
  port?: number;
}

interface BootstrapResult {
  authToken: string;
}

function getConfigDir(): string {
  return path.join(os.homedir(), ".openclaw");
}

function getConfigPath(): string {
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
  const authToken = crypto.randomUUID();

  const configDir = getConfigDir();
  const workspaceDir = path.join(configDir, "workspace");

  // Ensure directories exist
  await fs.mkdir(workspaceDir, { recursive: true });

  const config = {
    gateway: {
      mode: "local",
      port,
      bind: "loopback",
      auth: {
        mode: "token",
        token: authToken,
      },
    },
    agents: {
      defaults: {
        model: "anthropic/claude-sonnet-4-20250514",
      },
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
    tools: {},
  };

  // Write config and SOUL.md in parallel
  await Promise.all([
    fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8"),
    fs.writeFile(
      path.join(workspaceDir, "SOUL.md"),
      "# OpenClaw Agent\n\nBootstrap placeholder — replaced at session start.\n",
      "utf-8"
    ),
  ]);

  logger.info(`Bootstrap config written to ${getConfigPath()} (port=${port})`);
  return { authToken };
}

/**
 * Read the auth token from an existing bootstrap config file.
 * Returns null if the file doesn't exist or the token can't be parsed.
 */
export function getBootstrapAuthToken(): string | null {
  try {
    const raw = require("node:fs").readFileSync(getConfigPath(), "utf-8");
    const config = JSON.parse(raw);
    return config?.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}
