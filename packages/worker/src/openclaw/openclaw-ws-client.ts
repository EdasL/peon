/**
 * OpenClaw WebSocket client.
 *
 * Connects to the local OpenClaw gateway via WebSocket using protocol 3
 * (challenge → connect → hello-ok handshake), authenticates with device
 * identity, and provides an async iterable interface for streaming agent events.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createLogger } from "@lobu/core";

const logger = createLogger("openclaw-ws-client");

const EVENT_TIMEOUT_MS = 120_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------------------
// Device identity (mirrors OpenClaw's src/infra/device-identity.ts)
// ---------------------------------------------------------------------------

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
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

function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const identityPath = path.join(os.homedir(), ".openclaw", "identity", "device.json");
  try {
    if (fs.existsSync(identityPath)) {
      const parsed = JSON.parse(fs.readFileSync(identityPath, "utf8"));
      if (parsed?.version === 1 && parsed.publicKeyPem && parsed.privateKeyPem) {
        const deviceId = fingerprintPublicKey(parsed.publicKeyPem);
        return { deviceId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
      }
    }
  } catch {
    // fall through to generate
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);

  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  fs.writeFileSync(
    identityPath,
    JSON.stringify({ version: 1, deviceId, publicKeyPem, privateKeyPem, createdAtMs: Date.now() }, null, 2) + "\n",
    { mode: 0o600 },
  );
  return { deviceId, publicKeyPem, privateKeyPem };
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

function publicKeyRawBase64Url(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function buildDeviceAuthPayloadV3(params: {
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
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  const platform = (params.platform ?? "").trim().toLowerCase();
  const deviceFamily = (params.deviceFamily ?? "").trim().toLowerCase();
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join("|");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpenClawEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string }
  | { type: "turn_end"; contentBlocks?: unknown[] }
  | { type: "error"; message: string };

/** A frame received over the WebSocket (protocol 3). */
interface WsFrame {
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

interface SendMessageParams {
  message: string;
  sessionKey: string;
  thinking?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OpenClawWsClient {
  private url: string;
  private ws: WebSocket | null = null;
  private requestCounter = 0;
  private connected = false;
  private reconnecting = false;

  /** Resolvers waiting for a `res` frame keyed by request id. */
  private pendingRequests = new Map<
    string,
    { resolve: (frame: WsFrame) => void; reject: (err: Error) => void }
  >();

  /** The active event listener for streaming events (only one at a time). */
  private eventListener:
    | ((event: OpenClawEvent, done: boolean) => void)
    | null = null;

  /** Tracks length of accumulated text in chat delta events for diffing. */
  private chatAccumulatedLen = 0;

  private authToken: string | undefined;

  constructor(opts: { url: string; authToken?: string }) {
    this.url = opts.url;
    this.authToken = opts.authToken || process.env.OPENCLAW_GATEWAY_TOKEN || undefined;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.ws && this.connected) return;
    await this.openAndAuth();
  }

  /**
   * Protocol 3 handshake:
   *  1. Open WebSocket
   *  2. Wait for `connect.challenge` event from gateway
   *  3. Send `connect` request with device identity + signed nonce
   *  4. Wait for `hello-ok` response
   */
  private openAndAuth(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info(`Connecting to OpenClaw gateway at ${this.url}`);

      const ws = new WebSocket(this.url);
      this.ws = ws;

      const handshakeTimeout = setTimeout(() => {
        logger.error("Handshake timed out waiting for connect.challenge");
        cleanup();
        reject(new Error("Handshake timed out"));
      }, HANDSHAKE_TIMEOUT_MS);

      const onError = (ev: Event) => {
        const msg =
          "message" in ev && typeof (ev as any).message === "string"
            ? (ev as any).message
            : "WebSocket connection error";
        logger.error("WebSocket error during connect:", msg);
        cleanup();
        reject(new Error(msg));
      };

      const onClose = (ev: Event) => {
        const closeEv = ev as { code?: number; reason?: string };
        const reason = closeEv.reason || "unknown";
        logger.warn(
          `WebSocket closed during handshake: code=${closeEv.code} reason=${reason}`
        );
        cleanup();
        reject(
          new Error(`WebSocket closed during handshake: ${reason}`)
        );
      };

      const onMessage = (ev: MessageEvent) => {
        let frame: WsFrame;
        try {
          frame = JSON.parse(
            typeof ev.data === "string" ? ev.data : ev.data.toString()
          ) as WsFrame;
        } catch (err) {
          logger.warn("Failed to parse handshake message:", err);
          return;
        }

        // Step 2: receive connect.challenge → send connect request
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const payload = frame.payload ?? frame.data ?? {};
          const nonce = (payload.nonce as string) ?? "";
          if (!nonce) {
            logger.error("connect.challenge missing nonce");
            cleanup();
            reject(new Error("connect.challenge missing nonce"));
            return;
          }

          logger.debug("Received connect.challenge, sending connect request");
          this.sendConnectRequest(nonce);
          return;
        }

        // Step 4: receive hello-ok response
        if (frame.type === "res" && frame.id) {
          const pending = this.pendingRequests.get(frame.id);
          if (pending) {
            this.pendingRequests.delete(frame.id);
            pending.resolve(frame);
          }
        }
      };

      const cleanup = () => {
        clearTimeout(handshakeTimeout);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("message", onMessage);
      };

      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.addEventListener("message", onMessage);

      // Step 1: WebSocket opens — now just wait for the challenge
      ws.addEventListener(
        "open",
        () => {
          logger.debug("WebSocket open, waiting for connect.challenge");
        },
        { once: true }
      );

      // Set up the connect response handler
      const connectId = this.nextId();
      this.pendingRequests.set(connectId, {
        resolve: (frame) => {
          if (frame.error) {
            const errMsg =
              typeof frame.error === "string"
                ? frame.error
                : frame.error.message;
            logger.error("Connect handshake rejected:", errMsg);
            cleanup();
            reject(new Error(`Connect handshake rejected: ${errMsg}`));
            return;
          }
          logger.info("Connected to OpenClaw gateway (protocol 3)");
          this.connected = true;
          cleanup();
          this.attachHandlers();
          resolve();
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      });

      // Store the pre-allocated connect request ID so sendConnectRequest can use it
      (this as any)._pendingConnectId = connectId;
    });
  }

  private sendConnectRequest(challengeNonce: string): void {
    const connectId: string = (this as any)._pendingConnectId;

    const identity = loadOrCreateDeviceIdentity();
    const role = "operator";
    const scopes = ["operator.read", "operator.write", "operator.admin"];
    const signedAtMs = Date.now();
    const platform = "linux";
    const clientId = "gateway-client";
    const clientMode = "backend";
    const token = this.authToken || null;

    const payload = buildDeviceAuthPayloadV3({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token,
      nonce: challengeNonce,
      platform,
    });
    const signature = signDevicePayload(identity.privateKeyPem, payload);

    this.sendRaw({
      type: "req",
      id: connectId,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: clientId,
          displayName: "peon-worker",
          version: "1.0.0",
          platform,
          mode: clientMode,
        },
        auth: token ? { token } : undefined,
        role,
        scopes,
        caps: ["tool-events"],
        commands: [],
        permissions: {},
        device: {
          id: identity.deviceId,
          publicKey: publicKeyRawBase64Url(identity.publicKeyPem),
          signature,
          signedAt: signedAtMs,
          nonce: challengeNonce,
        },
      },
    });
  }

  /**
   * Attach permanent message/close/error handlers after authentication.
   */
  private attachHandlers(): void {
    if (!this.ws) return;

    this.ws.addEventListener("message", (ev: MessageEvent) => {
      this.handleMessage(ev);
    });

    this.ws.addEventListener("close", () => {
      logger.warn("WebSocket connection closed");
      this.connected = false;

      this.pendingRequests.forEach((pending) => {
        pending.reject(new Error("WebSocket closed"));
      });
      this.pendingRequests.clear();

      if (this.eventListener) {
        this.eventListener(
          { type: "error", message: "WebSocket connection lost" },
          true
        );
        this.eventListener = null;
      }
    });

    this.ws.addEventListener("error", (ev: Event) => {
      const msg =
        "message" in ev && typeof (ev as any).message === "string"
          ? (ev as any).message
          : "WebSocket error";
      logger.error("WebSocket error:", msg);
    });
  }

  private handleMessage(ev: MessageEvent): void {
    let frame: WsFrame;
    try {
      frame = JSON.parse(
        typeof ev.data === "string" ? ev.data : ev.data.toString()
      ) as WsFrame;
    } catch (err) {
      logger.warn("Failed to parse WebSocket frame:", err);
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

    if (frame.type === "event" && frame.event) {
      const events = this.parseEvent(frame);
      for (const evt of events) {
        if (!this.eventListener) break;
        const done = evt.type === "turn_end" || evt.type === "error";
        this.eventListener(evt, done);
      }
    }
  }

  private parseEvent(frame: WsFrame): OpenClawEvent[] {
    const data = frame.data ?? frame.payload ?? {};

    if (frame.event === "chat") {
      return this.parseChatEvent(data);
    }

    if (frame.event === "agent") {
      return this.parseAgentEvent(data);
    }

    logger.debug(`Unhandled event type: ${frame.event}`);
    return [];
  }

  /**
   * Parse a "chat" event (ChatEventSchema).
   * Fields: runId, sessionKey, seq, state (delta|final|aborted|error),
   * message?, errorMessage?, usage?, stopReason?
   *
   * The gateway's delta events carry the full accumulated text, not
   * incremental deltas. We track the last seen length and emit only
   * the new portion.
   */
  private extractTextDelta(data: Record<string, unknown>): OpenClawEvent | null {
    const msg = data.message as Record<string, unknown> | undefined;
    const content = msg?.content as Array<Record<string, unknown>> | undefined;
    if (!content?.length) return null;

    // Concatenate ALL text-type content blocks. After tool calls, new text
    // appears at later indices (e.g. content[3]) — reading only content[0]
    // loses all text generated between and after tool invocations.
    let fullText = "";
    for (const item of content) {
      if (item.type === "text" && typeof item.text === "string") {
        fullText += item.text;
      }
    }

    if (fullText.length > this.chatAccumulatedLen) {
      const delta = fullText.slice(this.chatAccumulatedLen);
      this.chatAccumulatedLen = fullText.length;
      return { type: "text_delta", delta };
    }
    return null;
  }

  private parseChatEvent(data: Record<string, unknown>): OpenClawEvent[] {
    const state = data.state as string | undefined;

    if (state === "delta") {
      const evt = this.extractTextDelta(data);
      return evt ? [evt] : [];
    }

    if (state === "final") {
      const events: OpenClawEvent[] = [];
      const lenBefore = this.chatAccumulatedLen;
      const trailing = this.extractTextDelta(data);
      if (trailing) events.push(trailing);

      const msg = data.message as Record<string, unknown> | undefined;
      const stopReason =
        (data.stopReason ?? data.stop_reason ?? msg?.stopReason ?? msg?.stop_reason) as string | undefined;
      const usage = (data.usage ?? msg?.usage) as Record<string, unknown> | undefined;
      logger.info(
        `Chat final: totalLen=${this.chatAccumulatedLen}, trailing=${this.chatAccumulatedLen - lenBefore}, ` +
        `stopReason=${stopReason}, usage=${JSON.stringify(usage)}`
      );
      if (stopReason === "max_tokens") {
        logger.warn("⚠️ Response truncated due to max_tokens limit!");
      }

      const rawBlocks = msg?.content as unknown[] | undefined;
      const contentBlocks = Array.isArray(rawBlocks) ? rawBlocks : undefined;

      events.push({ type: "turn_end", contentBlocks });
      return events;
    }

    if (state === "error") {
      return [{
        type: "error",
        message: (data.errorMessage as string) ?? "Agent error",
      }];
    }

    if (state === "aborted") {
      return [{ type: "turn_end" }];
    }

    logger.debug(`Unhandled chat event state: ${state}`);
    return [];
  }

  /**
   * Parse an "agent" event (AgentEventPayload).
   * Fields: runId, stream, seq, ts, data, sessionKey?
   *
   * Text streaming comes via "chat" events — the "agent" assistant stream
   * carries accumulated text so we skip it to avoid duplication.
   */
  private parseAgentEvent(payload: Record<string, unknown>): OpenClawEvent[] {
    const stream = payload.stream as string | undefined;
    const evtData = payload.data as Record<string, unknown> | undefined;

    if (stream === "tool" && evtData) {
      const phase = evtData.phase as string | undefined;
      if (phase === "start" || !phase) {
        return [{
          type: "tool_start",
          name: (evtData.name as string) ?? "unknown",
          input: (evtData.input ?? evtData.args) as Record<string, unknown> ?? {},
        }];
      }
      if (phase === "end" || phase === "result") {
        return [{
          type: "tool_end",
          name: (evtData.name as string) ?? "unknown",
          result: (evtData.result as string) ?? "",
        }];
      }
    }

    if (stream === "lifecycle" && evtData) {
      const phase = evtData.phase as string | undefined;
      if (phase === "end") {
        // Do NOT emit turn_end here — the chat "final" event is the
        // authoritative end-of-turn and may carry trailing text that
        // would be lost if we already set finished=true.
        logger.debug("Agent lifecycle end received (waiting for chat final)");
        return [];
      }
      if (phase === "error") {
        return [{
          type: "error",
          message: (evtData.error as string) ?? "Agent lifecycle error",
        }];
      }
    }

    if (stream === "error") {
      return [{
        type: "error",
        message: (evtData?.reason as string) ?? "Agent error",
      }];
    }

    logger.debug(`Unhandled agent event stream: ${stream}`);
    return [];
  }

  // -------------------------------------------------------------------------
  // Sending messages
  // -------------------------------------------------------------------------

  async *sendMessage(
    params: SendMessageParams
  ): AsyncIterable<OpenClawEvent> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected to OpenClaw gateway");
    }

    if (this.eventListener) {
      throw new Error("A message is already in flight");
    }

    this.chatAccumulatedLen = 0;
    const reqId = this.nextId();

    const reqParams: Record<string, unknown> = {
      message: params.message,
      sessionKey: params.sessionKey,
      idempotencyKey: crypto.randomUUID(),
    };
    if (params.thinking) reqParams.thinking = params.thinking;

    const queue: Array<{ event: OpenClawEvent; done: boolean }> = [];
    let queueResolve: (() => void) | null = null;
    let finished = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const resetTimeout = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (!finished) {
          finished = true;
          this.eventListener = null;
          queue.push({
            event: {
              type: "error",
              message: `No events received for ${EVENT_TIMEOUT_MS / 1000}s — timeout`,
            },
            done: true,
          });
          if (queueResolve) {
            queueResolve();
            queueResolve = null;
          }
        }
      }, EVENT_TIMEOUT_MS);
    };

    this.eventListener = (event: OpenClawEvent, done: boolean) => {
      if (finished) return;
      resetTimeout();
      if (done) {
        finished = true;
        this.eventListener = null;
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
      queue.push({ event, done });
      if (queueResolve) {
        queueResolve();
        queueResolve = null;
      }
    };

    this.sendRaw({
      type: "req",
      id: reqId,
      method: "chat.send",
      params: reqParams,
    });

    const resPromise = new Promise<WsFrame>((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject });
    });

    resetTimeout();

    let resFrame: WsFrame;
    try {
      resFrame = await resPromise;
    } catch (err) {
      finished = true;
      this.eventListener = null;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (!this.connected && !this.reconnecting) {
        logger.info("Connection lost during send, attempting reconnect...");
        const reconnected = await this.tryReconnect();
        if (reconnected) {
          yield* this.sendMessage(params);
          return;
        }
      }
      throw err;
    }

    if (resFrame.error) {
      finished = true;
      this.eventListener = null;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const errMsg =
        typeof resFrame.error === "string"
          ? resFrame.error
          : resFrame.error.message;
      throw new Error(`chat.send rejected: ${errMsg}`);
    }

    logger.debug(`chat.send accepted (req ${reqId})`);

    try {
      while (true) {
        if (queue.length > 0) {
          const item = queue.shift()!;
          yield item.event;
          if (item.done) return;
        } else if (finished) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            queueResolve = resolve;
          });
        }
      }
    } finally {
      finished = true;
      this.eventListener = null;
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  // -------------------------------------------------------------------------
  // Reconnect
  // -------------------------------------------------------------------------

  private async tryReconnect(): Promise<boolean> {
    if (this.reconnecting) return false;
    this.reconnecting = true;

    try {
      logger.info("Attempting to reconnect to OpenClaw gateway...");
      this.cleanup();
      await this.openAndAuth();
      logger.info("Reconnected successfully");
      return true;
    } catch (err) {
      logger.error("Reconnect failed:", err);
      return false;
    } finally {
      this.reconnecting = false;
    }
  }

  // -------------------------------------------------------------------------
  // Disconnect / helpers
  // -------------------------------------------------------------------------

  disconnect(): void {
    logger.info("Disconnecting from OpenClaw gateway");
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected && this.ws !== null;
  }

  private nextId(): string {
    this.requestCounter++;
    return `req-${this.requestCounter}`;
  }

  private sendRaw(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.ws.send(JSON.stringify(payload));
  }

  private cleanup(): void {
    this.connected = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.pendingRequests.forEach((pending) => {
      pending.reject(new Error("Client disconnected"));
    });
    this.pendingRequests.clear();
  }
}
