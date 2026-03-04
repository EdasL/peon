/**
 * OpenClaw subprocess lifecycle manager.
 *
 * Starts `openclaw gateway` as a child process, waits for it to be ready,
 * restarts on crash, and tears down on SIGTERM.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "@lobu/core";

const logger = createLogger("openclaw-process");

const DEFAULT_PORT = 18789;
const HEALTH_CHECK_INTERVAL_MS = 1000;
const HEALTH_CHECK_MAX_RETRIES = 30;
const RESTART_DELAY_MS = 2000;

export class OpenClawProcess {
  private process: ChildProcess | null = null;
  private port: number;
  private shutdownRequested = false;
  private restartCount = 0;
  private maxRestarts = 5;

  constructor(port?: number) {
    this.port = port || Number(process.env.OPENCLAW_PORT) || DEFAULT_PORT;
  }

  private externalProcess = false;

  /**
   * Ensure the OpenClaw gateway is running and accepting connections.
   * If an external process (e.g. started by the container entrypoint) is
   * already listening on the port, adopt it instead of spawning a duplicate.
   */
  async ensureRunning(): Promise<void> {
    // Check if something is already healthy on the port (entrypoint, prior run, etc.)
    const alreadyUp = await this.healthCheck();
    if (alreadyUp) {
      if (!this.externalProcess) {
        logger.info(
          `OpenClaw gateway already running on port ${this.port} (external process), adopting`
        );
        this.externalProcess = true;
      }
      return;
    }

    if (this.process && !this.process.killed) {
      logger.warn("OpenClaw process exists but is not healthy, restarting...");
      this.kill();
    }

    this.externalProcess = false;
    await this.start();
    await this.waitForReady();
  }

  /**
   * Start the OpenClaw gateway subprocess.
   */
  private async start(): Promise<void> {
    if (this.shutdownRequested) return;

    logger.info(
      `Starting OpenClaw gateway on port ${this.port} (restart #${this.restartCount})`
    );

    this.process = spawn(
      "openclaw",
      ["gateway", "--port", String(this.port), "--bind", "lan"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      }
    );

    this.process.stdout?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) logger.debug(`[openclaw] ${line}`);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) logger.warn(`[openclaw:err] ${line}`);
    });

    this.process.on("exit", (code, signal) => {
      logger.warn(
        `OpenClaw gateway exited: code=${code}, signal=${signal}`
      );
      this.process = null;

      if (!this.shutdownRequested && this.restartCount < this.maxRestarts) {
        this.restartCount++;
        logger.info(
          `Scheduling restart in ${RESTART_DELAY_MS}ms (attempt ${this.restartCount}/${this.maxRestarts})`
        );
        setTimeout(() => {
          this.start()
            .then(() => this.waitForReady())
            .catch((err) =>
              logger.error("Failed to restart OpenClaw gateway:", err)
            );
        }, RESTART_DELAY_MS);
      }
    });

    this.process.on("error", (err) => {
      logger.error("Failed to spawn OpenClaw gateway:", err);
      this.process = null;
    });
  }

  /**
   * Wait for the gateway to accept connections.
   */
  private async waitForReady(): Promise<void> {
    for (let i = 0; i < HEALTH_CHECK_MAX_RETRIES; i++) {
      const healthy = await this.healthCheck();
      if (healthy) {
        logger.info(`OpenClaw gateway is ready on port ${this.port}`);
        return;
      }
      await sleep(HEALTH_CHECK_INTERVAL_MS);
    }
    throw new Error(
      `OpenClaw gateway did not become ready after ${HEALTH_CHECK_MAX_RETRIES}s`
    );
  }

  /**
   * Check if the gateway is accepting connections via HTTP health endpoint.
   */
  private async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(
        `http://127.0.0.1:${this.port}/health`,
        { signal: AbortSignal.timeout(2000) }
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the WebSocket URL for the OpenClaw gateway.
   */
  getWebSocketUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  /**
   * Get the HTTP base URL for the OpenClaw gateway.
   */
  getHttpUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Get the port the gateway is running on.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Kill the subprocess immediately.
   */
  private kill(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  /**
   * Gracefully shut down the OpenClaw gateway.
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    if (!this.process || this.process.killed) {
      return;
    }

    logger.info("Shutting down OpenClaw gateway...");
    this.process.kill("SIGTERM");

    // Wait for process to exit with timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          logger.warn("OpenClaw gateway did not exit gracefully, killing...");
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      if (this.process) {
        this.process.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this.process = null;
    logger.info("OpenClaw gateway stopped");
  }

  /**
   * Check if the gateway process is currently running (spawned or external).
   */
  isRunning(): boolean {
    return this.externalProcess || (this.process !== null && !this.process.killed);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Singleton instance — shared across the worker */
let instance: OpenClawProcess | null = null;

export function getOpenClawProcess(): OpenClawProcess {
  if (!instance) {
    instance = new OpenClawProcess();
  }
  return instance;
}
