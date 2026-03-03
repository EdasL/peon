import { randomUUID } from "node:crypto"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { requireAuth, getSession } from "../auth/middleware.js"
import { db } from "../db/connection.js"
import { chatMessages, users } from "../db/schema.js"
import { eq, and, asc, isNull } from "drizzle-orm"
import { getPeonPlatform } from "../peon/platform.js"
import { broadcastToUser, subscribeUserClient } from "./redis-broadcast.js"

export { broadcastToUser }

const masterChatRouter = new Hono()
masterChatRouter.use("*", requireAuth)

// GET /api/chat/stream — SSE stream for master chat
masterChatRouter.get("/stream", async (c) => {
  const session = getSession(c)

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: string) => {
      stream.writeSSE({ event, data })
    }

    const unsubscribe = subscribeUserClient(session.userId, send)

    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: JSON.stringify({ ts: Date.now() }) })
    }, 15_000)

    let aborted = false
    stream.onAbort(() => {
      aborted = true
      clearInterval(heartbeat)
      unsubscribe()
    })

    while (!aborted) {
      await new Promise((r) => setTimeout(r, 60_000))
    }
  })
})

// GET /api/chat — master chat history
masterChatRouter.get("/", async (c) => {
  const session = getSession(c)

  const messages = await db.query.chatMessages.findMany({
    where: and(
      eq(chatMessages.userId, session.userId),
      isNull(chatMessages.projectId),
    ),
    orderBy: [asc(chatMessages.createdAt)],
  })

  return c.json({ messages })
})

// POST /api/chat — send a master chat message
masterChatRouter.post("/", async (c) => {
  const session = getSession(c)
  const { content } = await c.req.json<{ content: string }>()
  if (!content?.trim()) return c.json({ error: "Message cannot be empty" }, 400)

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  })
  const lobuAgentId = user?.lobuAgentId
  if (!lobuAgentId) {
    return c.json({ error: "Agent not ready" }, 409)
  }

  const [userMsg] = await db.insert(chatMessages).values({
    userId: session.userId,
    projectId: null,
    role: "user",
    content,
  }).returning()

  broadcastToUser(session.userId, "message", userMsg)

  // Ensure credentials are bridged
  const services = getPeonPlatform().getServices()
  try {
    const { bridgeCredentials } = await import("../peon/agent-helper.js")
    await bridgeCredentials(session.userId, lobuAgentId, services)
  } catch (err) {
    console.error("Credential bridge failed (non-blocking):", err)
  }

  const sessionManager = services.getSessionManager()
  await sessionManager.touchSession(lobuAgentId)

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
    platformMetadata: { userId: session.userId, openclawAgentId: "master" },
    agentOptions: { provider: "claude" },
  })

  return c.json({ message: userMsg }, 201)
})

export { masterChatRouter }
