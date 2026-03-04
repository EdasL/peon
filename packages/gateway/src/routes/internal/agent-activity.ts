/**
 * Internal agent-activity route.
 *
 * DEPRECATED: Agent activity events now flow via the OpenClaw WebSocket
 * connection managed by connection-manager.ts. This route is kept as a
 * no-op stub for backward compatibility with older worker images.
 */

import { Hono } from "hono"

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

  // No-op stub — events now arrive via OpenClaw WS -> connection-manager -> SSE
  router.post("/internal/agent-activity", async (c) => {
    return c.json({ ok: true })
  })

  return router
}
