/**
 * Internal hook-events route.
 *
 * Worker containers forward Claude Code hook events here (via send_event.py).
 * The gateway maps hook event types to agent status (working/idle/error)
 * and broadcasts an `agent_status` SSE event to project subscribers.
 *
 * Authentication: Bearer worker-token (same as other /internal routes).
 */

import { createLogger, verifyWorkerToken } from "@lobu/core"
import { Hono } from "hono"
import { broadcastToProject } from "../../web/chat-routes.js"
import { getActiveProject } from "../../web/chat-routes.js"
import { handleWorkerTaskUpdate } from "../../web/task-sync.js"
import type { WorkerTask } from "../../web/task-sync.js"
import { db } from "../../db/connection.js"
import { projects, users } from "../../db/schema.js"
import { eq } from "drizzle-orm"

const logger = createLogger("internal-hook-events")

export type AgentStatus = "working" | "idle" | "error"

export interface HookEventPayload {
  eventType: string
  agentId: string
  timestamp: number
  toolName?: string
  toolUseId?: string
  toolInput?: Record<string, unknown>
  notificationType?: string
  error?: string
  projectId?: string
  // TaskCompleted hook fields
  taskId?: string
  taskSubject?: string
  taskDescription?: string
  teammateName?: string
}

export interface AgentStatusEvent {
  type: "agent_status"
  agentId: string
  status: AgentStatus
  toolName?: string
  error?: string
  timestamp: number
}

/**
 * Pure function: map a Claude Code hook event type to an agent status.
 *
 * | Hook event            | Agent status |
 * |-----------------------|-------------|
 * | PreToolUse            | working     |
 * | PostToolUse           | working     |
 * | PostToolUseFailure    | error       |
 * | Notification (idle)   | idle        |
 * | Stop                  | idle        |
 * | SessionEnd            | idle        |
 * | SubagentStart         | working     |
 * | SubagentStop          | idle        |
 */
export function mapHookEventToStatus(
  eventType: string,
  notificationType?: string
): AgentStatus | null {
  switch (eventType) {
    case "PreToolUse":
    case "PostToolUse":
    case "SubagentStart":
      return "working"

    case "PostToolUseFailure":
      return "error"

    case "Stop":
    case "SessionEnd":
    case "SubagentStop":
    case "TeammateIdle":
    case "TaskCompleted":
      return "idle"

    case "Notification":
      // Only idle_prompt notification means idle
      if (notificationType === "idle_prompt") return "idle"
      return null

    default:
      return null
  }
}

// Cache conversationId -> projectId (same pattern as tasks.ts)
const PROJECT_CACHE_MAX = 500
const projectIdCache = new Map<string, { id: string | null; expiresAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of projectIdCache) {
    if (val.expiresAt <= now) projectIdCache.delete(key)
  }
}, 5 * 60_000)

async function resolveProjectId(conversationId: string): Promise<string | null> {
  const active = getActiveProject(conversationId)
  if (active) return active

  const cached = projectIdCache.get(conversationId)
  if (cached && cached.expiresAt > Date.now()) return cached.id

  const user = await db.query.users.findFirst({
    where: eq(users.peonAgentId, conversationId),
    columns: { id: true },
  })
  if (!user) {
    projectIdCache.set(conversationId, { id: null, expiresAt: Date.now() + 60_000 })
    return null
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.userId, user.id),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
    columns: { id: true },
  })
  const id = project?.id ?? null
  if (projectIdCache.size >= PROJECT_CACHE_MAX) {
    const firstKey = projectIdCache.keys().next().value
    if (firstKey) projectIdCache.delete(firstKey)
  }
  projectIdCache.set(conversationId, { id, expiresAt: Date.now() + 60_000 })
  return id
}

export function createHookEventRoutes(): Hono {
  const router = new Hono()

  router.post("/internal/hook-events", async (c) => {
    const authHeader = c.req.header("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing authorization" }, 401)
    }

    const workerToken = authHeader.slice(7)
    const tokenData = verifyWorkerToken(workerToken)
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401)
    }

    let body: HookEventPayload
    try {
      body = await c.req.json<HookEventPayload>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    if (!body.eventType || !body.agentId) {
      return c.json({ error: "eventType and agentId are required" }, 400)
    }

    // Resolve projectId: prefer explicit from payload, fall back to token lookup
    const projectId = body.projectId || await resolveProjectId(tokenData.conversationId)
    if (!projectId) {
      logger.debug(`hook-events: no project found for conversationId=${tokenData.conversationId}`)
      return c.json({ ok: true })
    }

    // Handle task events: extract task data from tool_input when tool is TaskCreate/TaskUpdate
    const isTaskTool = body.toolName === "TaskCreate" || body.toolName === "TaskUpdate"
    if (isTaskTool && body.toolInput) {
      const ti = body.toolInput
      const taskId = (ti.taskId ?? ti.id ?? `cc-${Date.now()}`) as string
      const subject = (ti.subject ?? "") as string
      if (subject) {
        const taskStatus = (ti.status as string) ?? "pending"
        const task: WorkerTask = {
          id: taskId,
          subject,
          description: (ti.description as string) ?? "",
          status: taskStatus === "in_progress" ? "in_progress" : taskStatus === "completed" ? "completed" : "pending",
          owner: (ti.owner as string) ?? null,
          boardColumn: taskStatus === "in_progress" ? "in_progress" : taskStatus === "completed" ? "done" : "todo",
          metadata: (ti.metadata as Record<string, unknown>) ?? undefined,
          updatedAt: body.timestamp || Date.now(),
          blocks: (ti.addBlocks as string[]) ?? [],
          blockedBy: (ti.addBlockedBy as string[]) ?? [],
        }
        await handleWorkerTaskUpdate(projectId, task)
        logger.debug(`hook-events: ${body.toolName} task=${taskId} for project=${projectId}`)
      }
    }

    // Handle TaskCompleted hook event — mark the task as completed
    if (body.eventType === "TaskCompleted" && body.taskId) {
      const task: WorkerTask = {
        id: body.taskId,
        subject: body.taskSubject ?? `Task ${body.taskId}`,
        description: body.taskDescription ?? "",
        status: "completed",
        owner: body.teammateName ?? body.agentId,
        boardColumn: "done",
        updatedAt: body.timestamp || Date.now(),
        blocks: [],
        blockedBy: [],
      }
      await handleWorkerTaskUpdate(projectId, task)
      logger.debug(`hook-events: TaskCompleted task=${body.taskId} for project=${projectId}`)
    }

    const status = mapHookEventToStatus(body.eventType, body.notificationType)
    if (!status) {
      // Unknown or irrelevant event type — acknowledge but skip broadcast
      return c.json({ ok: true, status: null })
    }

    const sseEvent: AgentStatusEvent = {
      type: "agent_status",
      agentId: body.agentId,
      status,
      timestamp: body.timestamp || Date.now(),
    }

    if (body.toolName) sseEvent.toolName = body.toolName.slice(0, 100)
    if (body.error && status === "error") sseEvent.error = body.error.slice(0, 500)

    broadcastToProject(projectId, "agent_status", sseEvent)
    logger.debug(`hook-events: ${body.eventType} -> ${status} for agent=${body.agentId} project=${projectId}`)

    return c.json({ ok: true, status })
  })

  return router
}
