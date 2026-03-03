/**
 * Internal agent-activity route.
 *
 * Worker containers POST real-time agent events here (tool_start, tool_end,
 * thinking, turn_end) and the gateway fans them out to SSE clients watching
 * the relevant project via broadcastToProject().
 *
 * Authentication: same Bearer worker-token pattern as all other /internal routes.
 * The token carries conversationId (= lobuAgentId = projectId lookup key).
 */

import { createLogger, verifyWorkerToken } from "@lobu/core"
import { Hono } from "hono"
import { broadcastToProject, getActiveProject } from "../../web/chat-routes.js"
import { db } from "../../db/connection.js"
import { projects, users } from "../../db/schema.js"
import { eq } from "drizzle-orm"

const logger = createLogger("internal-agent-activity")

export type AgentActivityEventType =
  | "tool_start"
  | "tool_end"
  | "thinking"
  | "turn_end"
  | "error"

const ALLOWED_TYPES = new Set<string>([
  "tool_start", "tool_end", "thinking", "turn_end", "error",
])

// Cache conversationId → projectId for 60s to avoid DB hits on every event
const PROJECT_CACHE_MAX = 500
const projectIdCache = new Map<string, { id: string | null; expiresAt: number }>()

// Evict expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of projectIdCache) {
    if (val.expiresAt <= now) projectIdCache.delete(key)
  }
}, 5 * 60_000)

export interface AgentActivityEvent {
  type: AgentActivityEventType
  /** Tool name for tool_start / tool_end */
  tool?: string
  /** Thinking text snippet (may be truncated) */
  text?: string
  /** Error message */
  message?: string
  /** Agent identity (e.g., "lead", "frontend", "backend") */
  agentName?: string
  /** File path associated with the tool call (Read, Write, Edit, Grep, Glob) */
  filePath?: string
  /** Shell command (Bash tool) */
  command?: string
  timestamp: number
}

/**
 * Look up which project to broadcast to from the conversationId carried in
 * the worker token.  The conversationId is the lobuAgentId stored on users.
 *
 * Priority:
 * 1. Explicit active project (set when user sends a chat message)
 * 2. Cached DB lookup
 * 3. Most recently updated project (fallback)
 */
async function resolveProjectId(
  conversationId: string
): Promise<string | null> {
  // Check explicit active project first (set by chat-routes on message send)
  const active = getActiveProject(conversationId)
  if (active) return active

  const cached = projectIdCache.get(conversationId)
  if (cached && cached.expiresAt > Date.now()) return cached.id

  // conversationId == lobuAgentId == users.lobu_agent_id
  const user = await db.query.users.findFirst({
    where: eq(users.lobuAgentId, conversationId),
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
  // Evict oldest if at capacity
  if (projectIdCache.size >= PROJECT_CACHE_MAX) {
    const firstKey = projectIdCache.keys().next().value
    if (firstKey) projectIdCache.delete(firstKey)
  }
  projectIdCache.set(conversationId, { id, expiresAt: Date.now() + 60_000 })
  return id
}

export function createAgentActivityRoutes(): Hono {
  const router = new Hono()

  // POST /internal/agent-activity
  router.post("/internal/agent-activity", async (c) => {
    const authHeader = c.req.header("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing authorization" }, 401)
    }

    const workerToken = authHeader.slice(7)
    const tokenData = verifyWorkerToken(workerToken)
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401)
    }

    let body: AgentActivityEvent
    try {
      body = await c.req.json<AgentActivityEvent>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    if (!body.type || !ALLOWED_TYPES.has(body.type)) {
      return c.json({ error: "Invalid event type" }, 400)
    }

    const { conversationId } = tokenData
    const projectId = await resolveProjectId(conversationId)
    if (!projectId) {
      // No project found — not an error, just no one to broadcast to
      return c.json({ ok: true })
    }

    const event: AgentActivityEvent = {
      type: body.type,
      timestamp: body.timestamp ?? Date.now(),
      ...(body.tool && { tool: body.tool.slice(0, 100) }),
      ...(body.text && { text: body.text.slice(0, 200) }),
      ...(body.message && { message: body.message.slice(0, 500) }),
      ...(body.agentName && { agentName: body.agentName.slice(0, 50) }),
      ...(body.filePath && { filePath: String(body.filePath).slice(0, 300) }),
      ...(body.command && { command: String(body.command).slice(0, 300) }),
    }

    broadcastToProject(projectId, "agent_activity", event)
    logger.debug(
      `agent_activity: type=${event.type} project=${projectId}`
    )

    return c.json({ ok: true })
  })

  return router
}
