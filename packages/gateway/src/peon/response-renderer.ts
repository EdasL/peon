/**
 * Peon Response Renderer
 * Receives worker responses from the thread_response queue and delivers
 * them to the frontend via SSE. Routes to either project channels or
 * the user's master chat channel based on platformMetadata.
 */

import { createLogger } from "@lobu/core"
import type { ThreadResponsePayload } from "../infrastructure/queue/types.js"
import type { ResponseRenderer } from "../platform/response-renderer.js"
import { broadcastToProject } from "../web/chat-routes.js"
import { broadcastToUser } from "../web/redis-broadcast.js"
import { and, eq } from "drizzle-orm"
import { db } from "../db/connection.js"
import { chatMessages, projects } from "../db/schema.js"

const logger = createLogger("peon-response-renderer")

/** Per-message streaming accumulation buffers keyed by messageId */
const streamBuffers = new Map<string, { content: string; createdAt: number }>()

const BUFFER_TTL = 5 * 60_000
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of streamBuffers) {
    if (now - val.createdAt > BUFFER_TTL) streamBuffers.delete(key)
  }
}, 2 * 60_000)

function getProjectId(payload: ThreadResponsePayload): string | null {
  return (payload.platformMetadata?.projectId as string) ?? null
}

function getUserId(payload: ThreadResponsePayload): string | null {
  return (payload.platformMetadata?.userId as string) ?? null
}

function broadcast(payload: ThreadResponsePayload, event: string, data: unknown): void {
  const projectId = getProjectId(payload)
  if (projectId) {
    broadcastToProject(projectId, event, data)
    return
  }
  const userId = getUserId(payload)
  if (userId) {
    broadcastToUser(userId, event, data)
  }
}

export class PeonResponseRenderer implements ResponseRenderer {
  async handleDelta(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<string | null> {
    const projectId = getProjectId(payload)
    const userId = getUserId(payload)
    if (!projectId && !userId) {
      logger.warn("No projectId or userId in platformMetadata for delta broadcast")
      return null
    }

    const { messageId, delta } = payload
    if (!delta) return null

    const buf = streamBuffers.get(messageId)
    const accumulated = (buf?.content ?? "") + delta
    streamBuffers.set(messageId, { content: accumulated, createdAt: buf?.createdAt ?? Date.now() })

    broadcast(payload, "chat_delta", { delta, messageId, accumulated })

    logger.debug(
      `Broadcast delta to ${projectId ? `project ${projectId}` : `user ${userId}`}: ${delta.length} chars (accumulated ${accumulated.length})`
    )

    return messageId
  }

  async handleCompletion(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const projectId = getProjectId(payload)
    const userId = getUserId(payload)
    if (!projectId && !userId) {
      logger.warn("No projectId or userId in platformMetadata for completion broadcast")
      return
    }

    const { messageId } = payload

    const bufferContent = streamBuffers.get(messageId)?.content ?? ""
    const payloadContent = payload.content ?? ""

    if (bufferContent && payloadContent && bufferContent !== payloadContent) {
      logger.warn(
        `Content mismatch for message ${messageId}: buffer=${bufferContent.length} chars, payload=${payloadContent.length} chars`
      )
    }

    // Prefer the longer source to guard against partial accumulation on either side
    const content =
      bufferContent.length >= payloadContent.length
        ? bufferContent
        : payloadContent

    const [assistantMsg] = await db
      .insert(chatMessages)
      .values({
        projectId: projectId ?? undefined,
        userId: userId ?? undefined,
        role: "assistant" as const,
        content,
      })
      .returning()

    if (projectId) {
      const [updatedProject] = await db
        .update(projects)
        .set({ status: "running", updatedAt: new Date() })
        .where(and(eq(projects.id, projectId), eq(projects.status, "creating")))
        .returning()

      if (updatedProject) {
        broadcastToProject(projectId, "project_status", { status: "running" })
      }
    }

    broadcast(payload, "message", assistantMsg)
    streamBuffers.delete(messageId)

    logger.info(
      `Completion for ${projectId ? `project ${projectId}` : `master chat (user ${userId})`}: persisted ${content.length} chars`
    )
  }

  async handleError(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<void> {
    const projectId = getProjectId(payload)
    const userId = getUserId(payload)
    if (!projectId && !userId) {
      logger.warn("No projectId or userId in platformMetadata for error broadcast")
      return
    }

    const errorContent = payload.error ?? "An unknown error occurred."

    const [assistantMsg] = await db
      .insert(chatMessages)
      .values({
        projectId: projectId ?? undefined,
        userId: userId ?? undefined,
        role: "assistant" as const,
        content: errorContent,
      })
      .returning()

    if (projectId) {
      const [updatedProject] = await db
        .update(projects)
        .set({ status: "error", updatedAt: new Date() })
        .where(and(eq(projects.id, projectId), eq(projects.status, "creating")))
        .returning()

      if (updatedProject) {
        broadcastToProject(projectId, "project_status", { status: "error", message: errorContent })
      }
    }

    broadcast(payload, "message", assistantMsg)
    streamBuffers.delete(payload.messageId)

    logger.error(
      `Error for ${projectId ? `project ${projectId}` : `master chat (user ${userId})`}: ${errorContent}`
    )
  }

  async handleStatusUpdate(payload: ThreadResponsePayload): Promise<void> {
    const projectId = getProjectId(payload)
    const userId = getUserId(payload)
    if (!projectId && !userId) return

    const { statusUpdate } = payload
    if (!statusUpdate) return

    broadcast(payload, "chat_status", {
      state: statusUpdate.state,
      elapsedSeconds: statusUpdate.elapsedSeconds,
    })
  }
}
