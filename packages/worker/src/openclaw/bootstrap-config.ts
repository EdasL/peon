/**
 * Bootstrap config generator for OpenClaw.
 *
 * Writes the initial ~/.openclaw/openclaw.json that OpenClaw needs BEFORE
 * the gateway process starts.
 *
 * This is separate from config-bridge.ts which writes per-session config
 * AFTER the gateway is running and a session context is fetched.
 *
 * Project agents are added dynamically by agent-registry.ts when the first
 * message for a project arrives.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_PORT = 18789;
const SKILLS_DIR = "/app/packages/worker/src/openclaw/skills";
const PLUGIN_DIR = process.env.OPENCLAW_PLUGIN_DIR
  || "/app/packages/worker/src/openclaw/plugins/peon-gateway";

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
 *   ~/.openclaw/openclaw.json — gateway, agents, channels, skills, tools config
 */
export async function writeBootstrapConfig(
  options?: BootstrapOptions
): Promise<BootstrapResult> {
  const port = options?.port ?? (Number(process.env.OPENCLAW_PORT) || DEFAULT_PORT);

  const configDir = getConfigDir();

  await fs.mkdir(configDir, { recursive: true });

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
        heartbeat: {
          every: "10m",
          lightContext: true,
        },
      },
      list: [] as Array<{ id: string; workspace: string; name: string }>,
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

  // Pre-pair the Peon gateway's device so it can connect for activity streaming.
  const devicesDir = path.join(configDir, "devices");
  await fs.mkdir(devicesDir, { recursive: true });

  const gwDeviceId = process.env.PEON_GATEWAY_DEVICE_ID;
  const gwDeviceKey = process.env.PEON_GATEWAY_DEVICE_PUBLIC_KEY;
  const pairedDevices: Record<string, unknown> = {};
  if (gwDeviceId && gwDeviceKey) {
    pairedDevices[gwDeviceId] = {
      deviceId: gwDeviceId,
      publicKey: gwDeviceKey,
      displayName: "Peon Gateway",
      platform: "linux",
      clientId: "gateway-client",
      role: "operator",
      roles: ["operator"],
      scopes: ["operator.read", "operator.write", "operator.admin"],
      pairedAt: Date.now(),
    };
  }

  await Promise.all([
    fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8"),
    fs.writeFile(
      path.join(devicesDir, "paired.json"),
      JSON.stringify(pairedDevices, null, 2),
      "utf-8"
    ),
  ]);

  console.error(`[bootstrap-config] Bootstrap config written to ${getConfigPath()} (port=${port})${gwDeviceId ? `, pre-paired gateway device ${gwDeviceId.substring(0, 12)}` : ""}`);
  return { authToken: gatewayToken };
}

/**
 * Read the auth token from the OPENCLAW_GATEWAY_TOKEN env var.
 */
export function getBootstrapAuthToken(): string | null {
  return process.env.OPENCLAW_GATEWAY_TOKEN ?? null;
}
