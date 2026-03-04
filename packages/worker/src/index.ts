#!/usr/bin/env bun

import { createLogger, initTracing, moduleRegistry } from "@lobu/core";

const logger = createLogger("worker");

import { setupWorkspaceEnv } from "./core/workspace";
import { GatewayClient } from "./gateway/sse-client";
import { startWorkerHttpServer, stopWorkerHttpServer } from "./server";

/**
 * Report boot progress to the gateway so the frontend can show real startup steps.
 * Fire-and-forget — errors are logged but don't block startup.
 */
async function reportBootProgress(
  dispatcherUrl: string,
  workerToken: string,
  step: string,
  label: string
): Promise<void> {
  try {
    await fetch(`${dispatcherUrl}/internal/boot-progress`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ step, label }),
      signal: AbortSignal.timeout(5_000),
    });
    logger.info(`Boot progress reported: ${step} — ${label}`);
  } catch (err) {
    logger.warn(`Failed to report boot progress (${step}):`, err);
  }
}

/**
 * Main entry point for gateway-based persistent worker
 */
async function main() {
  logger.info("Starting worker...");

  // Initialize OpenTelemetry tracing for distributed tracing
  // Worker traces are sent to Tempo via gateway proxy
  const tempoEndpoint = process.env.TEMPO_ENDPOINT;
  logger.debug(`TEMPO_ENDPOINT: ${tempoEndpoint}`);
  if (tempoEndpoint) {
    initTracing({
      serviceName: "peon-worker",
      tempoEndpoint,
    });
    logger.info(`Tracing initialized: peon-worker -> ${tempoEndpoint}`);
  }

  // Discover and register available modules
  await moduleRegistry.registerAvailableModules();

  // Initialize all registered modules
  await moduleRegistry.initAll();
  logger.info("✅ Modules initialized");

  logger.info("🔄 Starting in gateway mode (SSE/HTTP-based persistent worker)");

  // Get user ID from environment
  const userId = process.env.USER_ID;

  if (!userId) {
    logger.error(
      "❌ USER_ID environment variable is required for gateway mode"
    );
    process.exit(1);
  }

  try {
    // Get required environment variables
    const deploymentName = process.env.DEPLOYMENT_NAME;
    const dispatcherUrl = process.env.DISPATCHER_URL;
    const workerToken = process.env.WORKER_TOKEN;

    if (!deploymentName) {
      logger.error("❌ DEPLOYMENT_NAME environment variable is required");
      process.exit(1);
    }
    if (!dispatcherUrl) {
      logger.error("❌ DISPATCHER_URL environment variable is required");
      process.exit(1);
    }
    if (!workerToken) {
      logger.error("❌ WORKER_TOKEN environment variable is required");
      process.exit(1);
    }

    setupWorkspaceEnv(deploymentName);

    // Report boot progress: starting AI engine
    reportBootProgress(dispatcherUrl, workerToken, "engine", "Starting AI engine");

    // Start HTTP server before connecting to gateway
    const httpPort = await startWorkerHttpServer();
    logger.info(`Worker HTTP server started on port ${httpPort}`);

    // Initialize gateway client directly
    logger.info(`🚀 Starting Gateway-based Persistent Worker`);
    logger.info(`- User ID: ${userId}`);
    logger.info(`- Deployment: ${deploymentName}`);
    logger.info(`- Dispatcher URL: ${dispatcherUrl}`);

    const gatewayClient = new GatewayClient(
      dispatcherUrl,
      workerToken,
      userId,
      deploymentName,
      httpPort
    );

    logger.info("🔌 Connecting to dispatcher...");
    gatewayClient.onFirstConnect(() => {
      reportBootProgress(dispatcherUrl, workerToken, "ready", "Ready");
    });
    await gatewayClient.start();
    logger.info("✅ Gateway worker started successfully");

    // Keep the process running for persistent gateway connection
    process.on("SIGTERM", async () => {
      logger.info("Received SIGTERM, shutting down gateway worker...");
      await gatewayClient.stop();
      await stopWorkerHttpServer();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("Received SIGINT, shutting down gateway worker...");
      await gatewayClient.stop();
      await stopWorkerHttpServer();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {
      // Keep process running indefinitely so we can listen messages from the queue
    }); // Wait forever
  } catch (error) {
    logger.error("❌ Gateway worker failed:", error);
    process.exit(1);
  }
}

export type { WorkerConfig } from "./core/types";

main();
