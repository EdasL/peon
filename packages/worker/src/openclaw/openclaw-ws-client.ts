/**
 * OpenClaw WebSocket client.
 *
 * Connects to the local OpenClaw gateway via WebSocket, authenticates,
 * and provides an async iterable interface for streaming agent events.
 */

import { createLogger } from "@lobu/core";

const logger = createLogger("openclaw-ws-client");

const EVENT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpenClawEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string }
  | { type: "turn_end" }
  | { type: "error"; message: string };

/** A frame received over the WebSocket. */
interface WsFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  event?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string } | string;
  data?: Record<string, unknown>;
}

interface SendMessageParams {
  message: string;
  sessionKey: string;
  thinking?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OpenClawWsClient {
  private url: string;
  private authToken: string;
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

  constructor(opts: { url: string; authToken: string }) {
    this.url = opts.url;
    this.authToken = opts.authToken;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  /**
   * Open the WebSocket and authenticate. Resolves once the auth handshake
   * completes successfully.
   */
  async connect(): Promise<void> {
    if (this.ws && this.connected) return;
    await this.openAndAuth();
  }

  private openAndAuth(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info(`Connecting to OpenClaw gateway at ${this.url}`);

      const ws = new WebSocket(this.url);
      this.ws = ws;

      const onError = (ev: Event) => {
        const msg =
          "message" in ev && typeof (ev as any).message === "string"
            ? (ev as any).message
            : "WebSocket connection error";
        logger.error("WebSocket error during connect:", msg);
        cleanup();
        reject(new Error(msg));
      };

      const onClose = () => {
        logger.warn("WebSocket closed before authentication completed");
        cleanup();
        reject(new Error("WebSocket closed before authentication completed"));
      };

      const onOpen = () => {
        logger.debug("WebSocket open, sending auth.connect");
        const authId = this.nextId();
        this.sendRaw({
          type: "req",
          id: authId,
          method: "auth.connect",
          params: { token: this.authToken, role: "operator" },
        });

        // Wait for the auth response
        this.pendingRequests.set(authId, {
          resolve: (frame) => {
            if (frame.error) {
              const errMsg =
                typeof frame.error === "string"
                  ? frame.error
                  : frame.error.message;
              logger.error("Authentication failed:", errMsg);
              cleanup();
              reject(new Error(`Authentication failed: ${errMsg}`));
              return;
            }
            logger.info("Authenticated with OpenClaw gateway");
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
      };

      // Temporary message handler for auth phase
      const onMessage = (ev: MessageEvent) => {
        try {
          const frame = JSON.parse(
            typeof ev.data === "string" ? ev.data : ev.data.toString()
          ) as WsFrame;
          if (frame.type === "res" && frame.id) {
            const pending = this.pendingRequests.get(frame.id);
            if (pending) {
              this.pendingRequests.delete(frame.id);
              pending.resolve(frame);
            }
          }
        } catch (err) {
          logger.warn("Failed to parse auth-phase message:", err);
        }
      };

      const cleanup = () => {
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("message", onMessage);
      };

      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.addEventListener("open", onOpen);
      ws.addEventListener("message", onMessage);
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

      // Reject any pending requests
      this.pendingRequests.forEach((pending) => {
        pending.reject(new Error("WebSocket closed"));
      });
      this.pendingRequests.clear();

      // Notify active event listener of the disconnect
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
      const parsed = this.parseEvent(frame);
      if (parsed && this.eventListener) {
        const done =
          parsed.type === "turn_end" || parsed.type === "error";
        this.eventListener(parsed, done);
      }
    }
  }

  private parseEvent(frame: WsFrame): OpenClawEvent | null {
    const data = frame.data ?? {};
    switch (frame.event) {
      case "agent.text_delta":
        return {
          type: "text_delta",
          delta: (data.delta as string) ?? "",
        };
      case "agent.thinking":
        return {
          type: "thinking",
          delta: (data.delta as string) ?? "",
        };
      case "agent.tool_start":
        return {
          type: "tool_start",
          name: (data.name as string) ?? "unknown",
          input: (data.input as Record<string, unknown>) ?? {},
        };
      case "agent.tool_end":
        return {
          type: "tool_end",
          name: (data.name as string) ?? "unknown",
          result: (data.result as string) ?? "",
        };
      case "agent.turn_end":
        return { type: "turn_end" };
      case "agent.error":
        return {
          type: "error",
          message: (data.message as string) ?? "Unknown agent error",
        };
      default:
        logger.debug(`Unhandled event type: ${frame.event}`);
        return null;
    }
  }

  // -------------------------------------------------------------------------
  // Sending messages
  // -------------------------------------------------------------------------

  /**
   * Send a message to the agent and yield streaming events as an async
   * iterable. Only one message can be in-flight at a time.
   */
  async *sendMessage(
    params: SendMessageParams
  ): AsyncIterable<OpenClawEvent> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected to OpenClaw gateway");
    }

    if (this.eventListener) {
      throw new Error("A message is already in flight");
    }

    const reqId = this.nextId();

    // Build the request payload
    const reqParams: Record<string, unknown> = {
      message: params.message,
      sessionKey: params.sessionKey,
    };
    if (params.thinking) reqParams.thinking = params.thinking;
    if (params.model) reqParams.model = params.model;

    // Set up the event queue that the async generator will drain
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

    // Send the request
    this.sendRaw({
      type: "req",
      id: reqId,
      method: "agent.message",
      params: reqParams,
    });

    // Wait for acknowledgement (res frame)
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

      // Attempt reconnect if connection dropped
      if (!this.connected && !this.reconnecting) {
        logger.info("Connection lost during send, attempting reconnect...");
        const reconnected = await this.tryReconnect();
        if (reconnected) {
          // Retry the message on the new connection
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
      throw new Error(`agent.message rejected: ${errMsg}`);
    }

    logger.debug(`agent.message accepted (req ${reqId})`);

    // Drain the event queue
    try {
      while (true) {
        if (queue.length > 0) {
          const item = queue.shift()!;
          yield item.event;
          if (item.done) return;
        } else if (finished) {
          return;
        } else {
          // Wait for next event
          await new Promise<void>((resolve) => {
            queueResolve = resolve;
          });
        }
      }
    } finally {
      // Cleanup in case consumer breaks out early
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
    // Reject pending requests
    this.pendingRequests.forEach((pending) => {
      pending.reject(new Error("Client disconnected"));
    });
    this.pendingRequests.clear();
  }
}
