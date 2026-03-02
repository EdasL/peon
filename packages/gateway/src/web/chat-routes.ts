import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { requireAuth, getSession } from "../auth/middleware.js"
import { db } from "../db/connection.js"
import { chatMessages, projects } from "../db/schema.js"
import { eq, and, asc } from "drizzle-orm"

// In-memory SSE clients per project (production: use Redis pub/sub)
const sseClients = new Map<string, Set<(event: string, data: string) => void>>()

export function broadcastToProject(projectId: string, event: string, data: unknown) {
  const clients = sseClients.get(projectId)
  if (!clients) return
  const json = JSON.stringify(data)
  for (const send of clients) {
    send(event, json)
  }
}

const chatRouter = new Hono()
chatRouter.use("*", requireAuth)

// GET /api/projects/:id/chat/stream — SSE stream for real-time chat
chatRouter.get("/:id/chat/stream", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: string) => {
      stream.writeSSE({ event, data })
    }

    // Register client
    if (!sseClients.has(projectId)) sseClients.set(projectId, new Set())
    sseClients.get(projectId)!.add(send)

    // Send heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" })
    }, 30_000)

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat)
      sseClients.get(projectId)?.delete(send)
    })

    // Keep alive
    while (true) {
      await new Promise((r) => setTimeout(r, 60_000))
    }
  })
})

// GET /api/projects/:id/chat — get chat history
chatRouter.get("/:id/chat", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.projectId, projectId),
    orderBy: [asc(chatMessages.createdAt)],
  })

  return c.json({ messages })
})

// POST /api/projects/:id/chat — send a message
chatRouter.post("/:id/chat", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")
  const { content } = await c.req.json<{ content: string }>()

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  // Store user message
  const [userMsg] = await db.insert(chatMessages).values({
    projectId,
    role: "user",
    content,
  }).returning()

  // Broadcast user message to SSE clients
  broadcastToProject(projectId, "message", userMsg)

  // TODO: Route message to worker container via Lobu's job router
  // This will be wired in Task 8 (Container Launch & Agent Routing)
  // For now, echo back a placeholder
  const [assistantMsg] = await db.insert(chatMessages).values({
    projectId,
    role: "assistant",
    content: `[Team Lead] Received: "${content}". Agent routing will be connected in Task 8.`,
  }).returning()

  broadcastToProject(projectId, "message", assistantMsg)

  return c.json({ message: userMsg }, 201)
})

export { chatRouter }
