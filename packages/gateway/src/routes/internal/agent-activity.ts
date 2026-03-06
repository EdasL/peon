/**
 * Internal agent-activity route.
 *
 * Receives tool_start / tool_end / turn_end / error events from worker
 * containers and broadcasts them to SSE clients via Redis pub/sub.
 *
 * The OpenClaw WebSocket connection delivers assistant, lifecycle, and chat
 * events. Tool events are session-scoped in the protocol and not visible to
 * passive observers, so the worker relays them here instead.
 */

import { Hono } from "hono"
import { broadcastToProject } from "../../web/redis-broadcast.js"
import { createLogger } from "@lobu/core"

const logger = createLogger("agent-activity")

export type AgentActivityEventType =
  | "tool_start"
  | "tool_end"
  | "thinking"
  | "turn_end"
  | "error"

export interface AgentActivityEvent {
  type: AgentActivityEventType
  tool?: string
  text?: string
  message?: string
  agentName?: string
  filePath?: string
  command?: string
  timestamp: number
}

export function createAgentActivityRoutes(): Hono {
  const router = new Hono()

  router.post("/internal/agent-activity", async (c) => {
    const body = await c.req.json<{
      projectId: string
      events: AgentActivityEvent[]
    }>().catch(() => null)

    if (!body?.projectId || !Array.isArray(body.events)) {
      return c.json({ error: "projectId and events[] required" }, 400)
    }

    for (const event of body.events) {
      broadcastToProject(body.projectId, "agent_activity", event)
    }

    return c.json({ ok: true, relayed: body.events.length })
  })

  return router
}
