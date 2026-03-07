/**
 * Peon Response Renderer
 * Receives worker responses from the thread_response queue and delivers
 * them to the frontend via SSE, routed to the project's broadcast channel.
 */

import { randomUUID } from "node:crypto"
import { createLogger } from "@lobu/core"
import type { ThreadResponsePayload } from "../infrastructure/queue/types.js"
import type { ResponseRenderer } from "../platform/response-renderer.js"
import { broadcastToProject } from "../web/chat-routes.js"
import { and, eq, or } from "drizzle-orm"
import { db } from "../db/connection.js"
import { chatMessages, projects, users } from "../db/schema.js"
import { getPeonPlatform } from "./platform.js"

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

function isSystemMessage(payload: ThreadResponsePayload): boolean {
  return payload.platformMetadata?.isSystemMessage === true
}

export class PeonResponseRenderer implements ResponseRenderer {
  async handleDelta(
    payload: ThreadResponsePayload,
    _sessionKey: string
  ): Promise<string | null> {
    const projectId = getProjectId(payload)
    if (!projectId) {
      logger.warn("No projectId in platformMetadata for delta broadcast")
      return null
    }

    if (isSystemMessage(payload)) {
      const { messageId, delta } = payload
      if (!delta) return null
      const buf = streamBuffers.get(messageId)
      const accumulated = (buf?.content ?? "") + delta
      streamBuffers.set(messageId, { content: accumulated, createdAt: buf?.createdAt ?? Date.now() })
      logger.debug(`System message delta (suppressed): ${delta.length} chars`)
      return messageId
    }

    const { messageId, delta } = payload
    if (!delta) return null

    const buf = streamBuffers.get(messageId)
    const accumulated = (buf?.content ?? "") + delta
    streamBuffers.set(messageId, { content: accumulated, createdAt: buf?.createdAt ?? Date.now() })

    broadcastToProject(projectId, "chat_delta", { delta, messageId, accumulated })

    logger.debug(
      `Broadcast delta to project ${projectId}: ${delta.length} chars (accumulated ${accumulated.length})`
    )

    return messageId
  }

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

    if (isSystemMessage(payload)) {
      const [updatedProject] = await db
        .update(projects)
        .set({ status: "running", updatedAt: new Date() })
        .where(and(
          eq(projects.id, projectId),
          or(eq(projects.status, "creating"), eq(projects.status, "initializing"))
        ))
        .returning()

      if (updatedProject) {
        broadcastToProject(projectId, "project_status", { status: "running" })

        // Auto-trigger the orchestrator to greet the user now that setup is done.
        // This fires a non-system message so the response is visible in chat.
        this.enqueueGreeting(projectId, payload).catch((err) => {
          logger.error(`Failed to enqueue greeting for project ${projectId}:`, err)
        })
      }
      streamBuffers.delete(messageId)
      logger.info(`System message completion (suppressed from chat): project ${projectId}`)
      return
    }

    const bufferContent = streamBuffers.get(messageId)?.content ?? ""
    const payloadContent = payload.content ?? ""

    if (bufferContent && payloadContent && bufferContent !== payloadContent) {
      logger.warn(
        `Content mismatch for message ${messageId}: buffer=${bufferContent.length} chars, payload=${payloadContent.length} chars`
      )
    }

    const content =
      bufferContent.length >= payloadContent.length
        ? bufferContent
        : payloadContent

    const [assistantMsg] = await db
      .insert(chatMessages)
      .values({
        projectId,
        role: "assistant" as const,
        content,
        contentBlocks: payload.contentBlocks ?? undefined,
      })
      .returning()

    const [updatedProject] = await db
      .update(projects)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(
        eq(projects.id, projectId),
        or(eq(projects.status, "creating"), eq(projects.status, "initializing"))
      ))
      .returning()

    if (updatedProject) {
      broadcastToProject(projectId, "project_status", { status: "running" })
    }

    broadcastToProject(projectId, "message", assistantMsg)
    streamBuffers.delete(messageId)

    logger.info(`Completion for project ${projectId}: persisted ${content.length} chars`)
  }

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

    if (isSystemMessage(payload)) {
      const [updatedProject] = await db
        .update(projects)
        .set({ status: "error", updatedAt: new Date() })
        .where(and(
          eq(projects.id, projectId),
          or(eq(projects.status, "creating"), eq(projects.status, "initializing"))
        ))
        .returning()

      if (updatedProject) {
        broadcastToProject(projectId, "project_status", { status: "error", message: errorContent })
      }
      streamBuffers.delete(payload.messageId)
      logger.error(`System message error (suppressed from chat): ${errorContent}`)
      return
    }

    const [assistantMsg] = await db
      .insert(chatMessages)
      .values({
        projectId,
        role: "assistant" as const,
        content: errorContent,
      })
      .returning()

    const [updatedProject] = await db
      .update(projects)
      .set({ status: "error", updatedAt: new Date() })
      .where(and(
        eq(projects.id, projectId),
        or(eq(projects.status, "creating"), eq(projects.status, "initializing"))
      ))
      .returning()

    if (updatedProject) {
      broadcastToProject(projectId, "project_status", { status: "error", message: errorContent })
    }

    broadcastToProject(projectId, "message", assistantMsg)
    streamBuffers.delete(payload.messageId)

    logger.error(`Error for project ${projectId}: ${errorContent}`)
  }

  async handleStatusUpdate(payload: ThreadResponsePayload): Promise<void> {
    if (isSystemMessage(payload)) return

    const projectId = getProjectId(payload)
    if (!projectId) return

    const { statusUpdate } = payload
    if (!statusUpdate) return

    broadcastToProject(projectId, "chat_status", {
      state: statusUpdate.state,
      elapsedSeconds: statusUpdate.elapsedSeconds,
    })
  }

  /**
   * After a system message completes (project setup), enqueue a non-system
   * message so the orchestrator greets the user in the visible chat.
   */
  private async enqueueGreeting(
    projectId: string,
    payload: ThreadResponsePayload
  ): Promise<void> {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { id: true, name: true, userId: true, repoUrl: true },
    })
    if (!project) return

    const user = await db.query.users.findFirst({
      where: eq(users.id, project.userId),
      columns: { id: true, peonAgentId: true },
    })
    if (!user?.peonAgentId) return

    const peonAgentId = user.peonAgentId

    const services = getPeonPlatform().getServices()
    const queueProducer = services.getQueueProducer()
    await queueProducer.enqueueMessage({
      userId: user.id,
      conversationId: peonAgentId,
      messageId: randomUUID(),
      channelId: peonAgentId,
      teamId: "peon",
      agentId: peonAgentId,
      botId: "peon-agent",
      platform: "peon",
      messageText: `[system] Project "${project.name}" environment is starting. The user is connected. First, verify the workspace: check if the repo is cloned, list the project files, and confirm the environment is ready. Then introduce yourself briefly with an honest status report — if setup is still in progress, say so. Finally ask what the user wants to build or work on. Be concise and action-oriented.`,
      platformMetadata: {
        projectId,
        userId: user.id,
        openclawAgentId: `project-${projectId}`,
        projectName: project.name,
        projectRepoUrl: project.repoUrl,
      },
      agentOptions: { provider: "claude" },
    })
    logger.info(`Enqueued greeting message for project ${projectId}`)
  }
}
