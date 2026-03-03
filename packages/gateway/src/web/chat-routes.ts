import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { requireAuth, getSession } from "../auth/middleware.js"
import { db } from "../db/connection.js"
import { chatMessages, projects, users } from "../db/schema.js"
import { eq, and, asc } from "drizzle-orm"
import { getPeonPlatform } from "../peon/platform.js"

// In-memory SSE clients per project (production: use Redis pub/sub)
const sseClients = new Map<string, Set<(event: string, data: string) => void>>()

// Active project mapping: conversationId (lobuAgentId) → projectId
// Updated every time a user sends a chat message, so agent activity events
// route to the correct project instead of "most recently updated".
const activeProjectMap = new Map<string, string>()

export function setActiveProject(conversationId: string, projectId: string) {
  activeProjectMap.set(conversationId, projectId)
}

export function getActiveProject(conversationId: string): string | undefined {
  return activeProjectMap.get(conversationId)
}

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
    let aborted = false
    stream.onAbort(() => {
      aborted = true
      clearInterval(heartbeat)
      sseClients.get(projectId)?.delete(send)
    })

    // Keep alive until client disconnects
    while (!aborted) {
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

// POST /api/projects/:id/chat — send a message (enqueued via Lobu pipeline)
chatRouter.post("/:id/chat", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")
  const { content } = await c.req.json<{ content: string }>()

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  // Agent lives on the user, not the project
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  })
  const lobuAgentId = user?.lobuAgentId
  if (!lobuAgentId) {
    return c.json({ error: "Agent not ready" }, 409)
  }

  // Record which project this user's agent is actively working on
  setActiveProject(lobuAgentId, projectId)

  // Store user message in Postgres
  const [userMsg] = await db.insert(chatMessages).values({
    projectId,
    role: "user",
    content,
  }).returning()

  // Broadcast user message to SSE clients immediately
  broadcastToProject(projectId, "message", userMsg)

  // Ensure credentials are bridged (idempotent — installs provider in catalog if missing)
  const services = getPeonPlatform().getServices()
  try {
    const { bridgeCredentials } = await import("../peon/agent-helper.js")
    await bridgeCredentials(session.userId, lobuAgentId, services)
  } catch (err) {
    console.error("Credential bridge failed (non-blocking):", err)
  }

  // Keep session alive
  const sessionManager = services.getSessionManager()
  await sessionManager.touchSession(lobuAgentId)

  // Enqueue message to existing agent
  const queueProducer = services.getQueueProducer()
  await queueProducer.enqueueMessage({
    userId: session.userId,
    conversationId: lobuAgentId,
    messageId: randomUUID(),
    channelId: lobuAgentId,
    teamId: "peon",
    agentId: lobuAgentId,
    botId: "peon-agent",
    platform: "peon",
    messageText: content,
    platformMetadata: { projectId, userId: session.userId },
    agentOptions: { provider: "claude" },
  })

  // Return immediately — response comes async via SSE
  return c.json({ message: userMsg }, 201)
})

// GET /api/projects/:id/tasks — get current Kanban tasks
chatRouter.get("/:id/tasks", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const { getProjectTasks } = await import("./task-sync.js")
  const tasks = await getProjectTasks(projectId)
  return c.json({ tasks })
})

// POST /api/projects/:id/tasks — create a task
chatRouter.post("/:id/tasks", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")
  const { subject, description } = await c.req.json<{ subject: string; description?: string }>()

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const { handleWorkerTaskUpdate, getProjectTasks } = await import("./task-sync.js")
  const id = crypto.randomUUID()
  await handleWorkerTaskUpdate(projectId, {
    id,
    subject,
    description: description ?? "",
    status: "pending",
    owner: null,
    boardColumn: "backlog",
    updatedAt: Date.now(),
  })
  const tasks = await getProjectTasks(projectId)
  const task = tasks.find((t) => t.id === id)
  return c.json({ task }, 201)
})

// PATCH /api/projects/:id/tasks/:taskId — update a task
chatRouter.patch("/:id/tasks/:taskId", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")
  const taskId = c.req.param("taskId")
  const updates = await c.req.json<{ status?: string; owner?: string }>()

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const { getProjectTasks, handleWorkerTaskUpdate } = await import("./task-sync.js")
  const tasks = await getProjectTasks(projectId)
  const existing = tasks.find((t) => t.id === taskId)
  if (!existing) return c.json({ error: "Task not found" }, 404)

  await handleWorkerTaskUpdate(projectId, {
    ...existing,
    ...(updates.status && { status: updates.status as "pending" | "in_progress" | "completed" }),
    ...(updates.owner !== undefined && { owner: updates.owner || null }),
    updatedAt: Date.now(),
  })

  const updated = (await getProjectTasks(projectId)).find((t) => t.id === taskId)
  return c.json({ task: updated })
})

// DELETE /api/projects/:id/tasks/:taskId — delete a task
chatRouter.delete("/:id/tasks/:taskId", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")
  const taskId = c.req.param("taskId")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const { deleteProjectTask } = await import("./task-sync.js")
  await deleteProjectTask(projectId, taskId)
  return c.json({ ok: true })
})

export { chatRouter }
