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
import { broadcastToProject } from "../../web/chat-routes.js"
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

export interface AgentActivityEvent {
  type: AgentActivityEventType
  /** Tool name for tool_start / tool_end */
  tool?: string
  /** Thinking text snippet (may be truncated) */
  text?: string
  /** Error message */
  message?: string
  timestamp: number
}

/**
 * Look up which project to broadcast to from the conversationId carried in
 * the worker token.  The conversationId is the lobuAgentId stored on users.
 * We return the *most recently updated* project for that user so activity
 * lands on the project the user is actively working on.
 */
async function resolveProjectId(
  conversationId: string
): Promise<string | null> {
  // conversationId == lobuAgentId == users.lobu_agent_id
  const user = await db.query.users.findFirst({
    where: eq(users.lobuAgentId, conversationId),
    columns: { id: true },
  })
  if (!user) return null

  const project = await db.query.projects.findFirst({
    where: eq(projects.userId, user.id),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
    columns: { id: true },
  })
  return project?.id ?? null
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

    if (!body.type) {
      return c.json({ error: "Missing event type" }, 400)
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
      ...(body.tool && { tool: body.tool }),
      ...(body.text && { text: body.text.slice(0, 200) }), // cap thinking snippets
      ...(body.message && { message: body.message }),
    }

    broadcastToProject(projectId, "agent_activity", event)
    logger.debug(
      `agent_activity: type=${event.type} project=${projectId}`
    )

    return c.json({ ok: true })
  })

  return router
}
