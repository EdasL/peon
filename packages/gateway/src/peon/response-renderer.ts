/**
 * Peon Response Renderer
 * Receives worker responses from the thread_response queue and delivers
 * them to the frontend via SSE using broadcastToProject().
 */

import { createLogger } from "@lobu/core"
import type { ThreadResponsePayload } from "../infrastructure/queue/types.js"
import type { ResponseRenderer } from "../platform/response-renderer.js"
import { broadcastToProject } from "../web/chat-routes.js"
import { and, eq } from "drizzle-orm"
import { db } from "../db/connection.js"
import { chatMessages, projects } from "../db/schema.js"

const logger = createLogger("peon-response-renderer")

/** Per-message streaming accumulation buffers keyed by messageId */
const streamBuffers = new Map<string, { content: string; createdAt: number }>()

// Clean up stale buffers every 2 minutes (orphaned if handleCompletion never fires)
const BUFFER_TTL = 5 * 60_000
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of streamBuffers) {
    if (now - val.createdAt > BUFFER_TTL) streamBuffers.delete(key)
  }
}, 2 * 60_000)

/**
 * Extract projectId from the response payload's platformMetadata.
 * Returns null if not present.
 */
function getProjectId(payload: ThreadResponsePayload): string | null {
  return (payload.platformMetadata?.projectId as string) ?? null
}

/**
 * Response renderer for the Peon (project chat) platform.
 * Broadcasts worker responses to SSE clients connected to a project,
 * and persists assistant messages to Postgres.
 */
export class PeonResponseRenderer implements ResponseRenderer {
  /**
   * Handle streaming delta content.
   * Accumulates text in a per-message buffer and broadcasts each delta
   * so the frontend can render live typing.
   */
  async handleDelta(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<string | null> {
    const projectId = getProjectId(payload)
    if (!projectId) {
      logger.warn("No projectId in platformMetadata for delta broadcast")
      return null
    }

    const { messageId, delta } = payload
    if (!delta) return null

    // Accumulate into the buffer
    const buf = streamBuffers.get(messageId)
    const accumulated = (buf?.content ?? "") + delta
    streamBuffers.set(messageId, { content: accumulated, createdAt: buf?.createdAt ?? Date.now() })

    broadcastToProject(projectId, "chat_delta", {
      delta,
      messageId,
      accumulated,
    })

    logger.debug(
      `Broadcast delta to project ${projectId}: ${delta.length} chars (accumulated ${accumulated.length})`
    )

    return messageId
  }

  /**
   * Handle completion of response processing.
   * Takes the fully accumulated text, persists the assistant message
   * to Postgres, broadcasts the final message, and clears the buffer.
   */
  async handleCompletion(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const projectId = getProjectId(payload)
    if (!projectId) {
      logger.warn("No projectId in platformMetadata for completion broadcast")
      return
    }

    const { messageId } = payload

    // Use accumulated buffer content, fall back to payload.content
    const content =
      streamBuffers.get(messageId)?.content ?? payload.content ?? ""

    // Persist assistant message to Postgres
    const [assistantMsg] = await db
      .insert(chatMessages)
      .values({
        projectId,
        role: "assistant" as const,
        content,
      })
      .returning()

    // Flip project status to "running" on first agent response
    const [updatedProject] = await db
      .update(projects)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.status, "creating")))
      .returning()

    if (updatedProject) {
      broadcastToProject(projectId, "project_status", { status: "running" })
    }

    // Broadcast the final persisted message to SSE clients
    broadcastToProject(projectId, "message", assistantMsg)

    // Clear the accumulation buffer
    streamBuffers.delete(messageId)

    logger.info(
      `Completion for project ${projectId}: persisted ${content.length} chars`
    )
  }

  /**
   * Handle error response.
   * Persists an error message as an assistant message and broadcasts it.
   */
  async handleError(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const projectId = getProjectId(payload)
    if (!projectId) {
      logger.warn("No projectId in platformMetadata for error broadcast")
      return
    }

    const errorContent = payload.error ?? "An unknown error occurred."

    // Persist error as assistant message
    const [assistantMsg] = await db
      .insert(chatMessages)
      .values({
        projectId,
        role: "assistant" as const,
        content: errorContent,
      })
      .returning()

    // Flip project status to "error" if still in "creating"
    const [updatedProject] = await db
      .update(projects)
      .set({ status: "error", updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.status, "creating")))
      .returning()

    if (updatedProject) {
      broadcastToProject(projectId, "project_status", { status: "error" })
    }

    // Broadcast to SSE clients
    broadcastToProject(projectId, "message", assistantMsg)

    // Clear any partial buffer for this message
    streamBuffers.delete(payload.messageId)

    logger.error(
      `Error for project ${projectId}: ${errorContent}`
    )
  }

  /**
   * Handle status updates (e.g. "thinking..." indicators).
   * Broadcasts status to SSE clients for UI progress display.
   */
  async handleStatusUpdate(payload: ThreadResponsePayload): Promise<void> {
    const projectId = getProjectId(payload)
    if (!projectId) return

    const { statusUpdate } = payload
    if (!statusUpdate) return

    broadcastToProject(projectId, "chat_status", {
      state: statusUpdate.state,
      elapsedSeconds: statusUpdate.elapsedSeconds,
    })
  }
}
