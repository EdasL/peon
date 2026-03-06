/**
 * OpenClaw Gateway protocol v3 client.
 *
 * Provides device identity management, challenge-response handshake, raw event
 * subscription, and JSON-RPC for communicating with an OpenClaw gateway over
 * WebSocket. Used by both the worker (for chat) and the Peon gateway (for
 * event streaming and dashboard proxy).
 *
 * Adapted from worker/openclaw-ws-client.ts and Nerve's device-identity.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createLogger } from "../logger.js";

const logger = createLogger("openclaw-protocol");

const PROTOCOL_VERSION = 3;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const RPC_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Device identity (Ed25519 keypair for gateway authentication)
// ---------------------------------------------------------------------------

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyB64url: string;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  const buf = Buffer.from(spki);
  if (
    buf.length === ED25519_SPKI_PREFIX.length + 32 &&
    buf.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return buf.subarray(ED25519_SPKI_PREFIX.length);
  }
  return buf;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Load or create a persistent Ed25519 device identity.
 * Stored at `~/.openclaw/identity/device.json` (same location as OpenClaw CLI).
 */
export function loadOrCreateDeviceIdentity(identityDir?: string): DeviceIdentity {
  const dir = identityDir ?? path.join(os.homedir(), ".openclaw", "identity");
  const identityPath = path.join(dir, "device.json");

  try {
    if (fs.existsSync(identityPath)) {
      const parsed = JSON.parse(fs.readFileSync(identityPath, "utf8"));
      if (parsed?.version === 1 && parsed.publicKeyPem && parsed.privateKeyPem) {
        const deviceId = fingerprintPublicKey(parsed.publicKeyPem);
        const publicKeyB64url = base64UrlEncode(derivePublicKeyRaw(parsed.publicKeyPem));
        return { deviceId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem, publicKeyB64url };
      }
    }
  } catch {
    // Fall through to generate
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  const publicKeyB64url = base64UrlEncode(derivePublicKeyRaw(publicKeyPem));

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    identityPath,
    JSON.stringify({ version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() }, null, 2) + "\n",
    { mode: 0o600 },
  );
  logger.info(`Generated new device identity: ${deviceId.substring(0, 12)}...`);
  return { deviceId, publicKeyPem, privateKeyPem, publicKeyB64url };
}

function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

function buildAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform?: string;
  deviceFamily?: string;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    (params.platform ?? "").trim().toLowerCase(),
    (params.deviceFamily ?? "").trim().toLowerCase(),
  ].join("|");
}

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

export interface WsFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  event?: string;
  ok?: boolean;
  params?: Record<string, unknown>;
  result?: unknown;
  payload?: Record<string, unknown>;
  error?: { message: string; details?: Record<string, unknown> } | string;
  data?: Record<string, unknown>;
}

export type RawEventHandler = (event: string, data: Record<string, unknown>) => void;

export interface ProtocolClientOptions {
  clientId?: string;
  clientDisplayName?: string;
  role?: "operator" | "node";
  scopes?: string[];
  identityDir?: string;
  autoReconnect?: boolean;
  /** Gateway auth token (for token-based auth mode). */
  token?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OpenClawProtocolClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private requestCounter = 0;
  private pendingRequests = new Map<string, { resolve: (f: WsFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private eventHandler: RawEventHandler | null = null;
  private options: Required<ProtocolClientOptions>;
  private url: string = "";
  private identity: DeviceIdentity;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private shutdownRequested = false;

  constructor(opts?: ProtocolClientOptions) {
    this.options = {
      clientId: opts?.clientId ?? "gateway-client",
      clientDisplayName: opts?.clientDisplayName ?? "peon-gateway",
      role: opts?.role ?? "operator",
      scopes: opts?.scopes ?? ["operator.read", "operator.write", "operator.admin"],
      identityDir: opts?.identityDir ?? undefined!,
      autoReconnect: opts?.autoReconnect ?? true,
      token: opts?.token ?? undefined!,
    };
    this.identity = loadOrCreateDeviceIdentity(opts?.identityDir);
  }

  /**
   * Connect to an OpenClaw gateway at the given WebSocket URL.
   * Performs the protocol v3 challenge-response handshake.
   */
  async connect(url: string): Promise<void> {
    this.url = url;
    this.shutdownRequested = false;
    if (this.ws && this.connected) return;
    await this.openAndAuth();
    this.startPing();
  }

  /** Subscribe to raw gateway events. Only one handler at a time. */
  onEvent(handler: RawEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  async rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected to OpenClaw gateway");
    }
    const id = this.nextId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, RPC_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: (frame) => {
          clearTimeout(timer);
          if (frame.error) {
            const msg = typeof frame.error === "string" ? frame.error : frame.error.message;
            reject(new Error(`RPC error (${method}): ${msg}`));
          } else {
            resolve(frame.result);
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
      this.sendRaw({ type: "req", id, method, params });
    });
  }

  disconnect(): void {
    this.shutdownRequested = true;
    this.clearReconnectTimer();
    this.stopPing();
    this.cleanup();
    logger.info(`Disconnected from OpenClaw gateway at ${this.url}`);
  }

  isConnected(): boolean {
    return this.connected && this.ws !== null;
  }

  getUrl(): string {
    return this.url;
  }

  // -------------------------------------------------------------------------
  // Handshake
  // -------------------------------------------------------------------------

  private openAndAuth(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info(`Connecting to OpenClaw gateway at ${this.url}`);

      const ws = new WebSocket(this.url);
      this.ws = ws;

      const handshakeTimeout = setTimeout(() => {
        logger.error("Handshake timed out");
        done();
        reject(new Error("Handshake timed out"));
      }, HANDSHAKE_TIMEOUT_MS);

      const onError = (ev: Event) => {
        const msg = "message" in ev && typeof (ev as any).message === "string" ? (ev as any).message : "WebSocket error";
        done();
        reject(new Error(msg));
      };

      const onClose = () => {
        done();
        reject(new Error("WebSocket closed during handshake"));
      };

      const connectId = this.nextId();

      const onMessage = (ev: MessageEvent) => {
        let frame: WsFrame;
        try {
          frame = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()) as WsFrame;
        } catch {
          return;
        }

        if (frame.type === "event" && frame.event === "connect.challenge") {
          const payload = frame.payload ?? frame.data ?? {};
          const nonce = (payload.nonce as string) ?? "";
          if (!nonce) {
            done();
            reject(new Error("connect.challenge missing nonce"));
            return;
          }
          this.sendConnectRequest(connectId, nonce);
          return;
        }

        if (frame.type === "res" && frame.id === connectId) {
          if (frame.error) {
            const errMsg = typeof frame.error === "string" ? frame.error : frame.error.message;
            done();
            reject(new Error(`Connect rejected: ${errMsg}`));
            return;
          }
          this.connected = true;
          this.reconnectAttempt = 0;
          done();
          this.attachHandlers();
          logger.info(`Connected to OpenClaw gateway (protocol ${PROTOCOL_VERSION})`);
          resolve();
        }
      };

      const done = () => {
        clearTimeout(handshakeTimeout);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("message", onMessage);
      };

      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.addEventListener("message", onMessage);
    });
  }

  private sendConnectRequest(connectId: string, nonce: string): void {
    const signedAtMs = Date.now();
    const token = this.options.token || null;
    const payload = buildAuthPayloadV3({
      deviceId: this.identity.deviceId,
      clientId: this.options.clientId,
      clientMode: "backend",
      role: this.options.role,
      scopes: this.options.scopes,
      signedAtMs,
      token,
      nonce,
      platform: "linux",
    });
    const signature = signPayload(this.identity.privateKeyPem, payload);

    this.sendRaw({
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: this.options.clientId,
          displayName: this.options.clientDisplayName,
          version: "1.0.0",
          platform: "linux",
          mode: "backend",
        },
        auth: token ? { token } : undefined,
        role: this.options.role,
        scopes: this.options.scopes,
        caps: ["tool-events"],
        commands: [],
        permissions: {},
        device: {
          id: this.identity.deviceId,
          publicKey: this.identity.publicKeyB64url,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private attachHandlers(): void {
    if (!this.ws) return;

    this.ws.addEventListener("message", (ev: MessageEvent) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()) as WsFrame;
      } catch {
        return;
      }

      if (frame.type === "res" && frame.id) {
        const pending = this.pendingRequests.get(frame.id);
        if (pending) {
          this.pendingRequests.delete(frame.id);
          pending.resolve(frame);
        }
        return;
      }

      if (frame.type === "event" && frame.event && this.eventHandler) {
        const data = frame.data ?? frame.payload ?? {};
        this.eventHandler(frame.event, data);
      }
    });

    this.ws.addEventListener("close", () => {
      logger.warn(`WebSocket closed (${this.url})`);
      this.connected = false;
      this.rejectAllPending(new Error("WebSocket closed"));
      this.stopPing();

      if (!this.shutdownRequested && this.options.autoReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener("error", (ev: Event) => {
      const msg = "message" in ev && typeof (ev as any).message === "string" ? (ev as any).message : "WebSocket error";
      logger.error(`WebSocket error: ${msg}`);
    });
  }

  // -------------------------------------------------------------------------
  // Reconnection
  // -------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.shutdownRequested || this.reconnecting) return;
    this.reconnectAttempt++;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1), RECONNECT_MAX_MS);
    const jitter = Math.random() * 500;
    logger.info(`Reconnecting in ${Math.round(delay + jitter)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.doReconnect(), delay + jitter);
  }

  private async doReconnect(): Promise<void> {
    if (this.shutdownRequested || this.reconnecting) return;
    this.reconnecting = true;
    try {
      this.cleanup();
      await this.openAndAuth();
      this.startPing();
      logger.info("Reconnected successfully");
    } catch (err) {
      logger.warn(`Reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
    } finally {
      this.reconnecting = false;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Keepalive
  // -------------------------------------------------------------------------

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.connected) {
        try {
          // Use WebSocket protocol-level ping when available (ws library / Node).
          // Bun's browser-compat WebSocket doesn't expose .ping(), but handles
          // keepalive internally; the close event will fire for dead connections.
          const raw = this.ws as unknown as { ping?: () => void };
          if (typeof raw.ping === "function") {
            raw.ping();
          }
        } catch {
          // Ping failure will trigger close -> reconnect
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private nextId(): string {
    return `req-${++this.requestCounter}`;
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.ws.send(JSON.stringify(payload));
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  private cleanup(): void {
    this.connected = false;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.rejectAllPending(new Error("Client disconnected"));
  }
}
