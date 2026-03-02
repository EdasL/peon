/**
 * Peon Platform Adapter
 * Bridges peon.work's Postgres-based chat + SSE system with Lobu's
 * queue-based orchestration pipeline.
 */

import { createLogger } from "@lobu/core"
import type { CoreServices, PlatformAdapter } from "../platform.js"
import type { ResponseRenderer } from "../platform/response-renderer.js"
import { PeonResponseRenderer } from "./response-renderer.js"

const logger = createLogger("peon-platform")

export class PeonPlatform implements PlatformAdapter {
  readonly name = "peon"

  private responseRenderer?: PeonResponseRenderer
  private services?: CoreServices

  async initialize(services: CoreServices): Promise<void> {
    this.services = services
    this.responseRenderer = new PeonResponseRenderer()
    logger.info("Peon platform initialized")
  }

  async start(): Promise<void> {
    logger.info("Peon platform started")
  }

  async stop(): Promise<void> {
    logger.info("Peon platform stopped")
  }

  isHealthy(): boolean {
    return true
  }

  buildDeploymentMetadata(
    conversationId: string,
    _channelId: string,
    platformMetadata: Record<string, any>
  ): Record<string, string> {
    return {
      projectId: (platformMetadata.projectId as string) || conversationId,
      source: "peon-chat",
    }
  }

  getResponseRenderer(): ResponseRenderer | undefined {
    return this.responseRenderer
  }

  /**
   * Expose core services so the chat route can access
   * queueProducer and sessionManager.
   */
  getServices(): CoreServices {
    if (!this.services) {
      throw new Error("PeonPlatform not initialized")
    }
    return this.services
  }
}

// Module-level singleton so chat-routes can access after gateway registers it
let peonPlatformInstance: PeonPlatform | null = null

export function setPeonPlatform(platform: PeonPlatform): void {
  peonPlatformInstance = platform
}

export function getPeonPlatform(): PeonPlatform {
  if (!peonPlatformInstance) {
    throw new Error("PeonPlatform not registered yet")
  }
  return peonPlatformInstance
}
