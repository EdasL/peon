import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { apiKeys } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { encrypt } from "../../services/encryption.js"
import { ensureLobuAgent, bridgeCredentials } from "../../peon/agent-helper.js"
import { getPeonPlatform } from "../../peon/platform.js"

const keysRouter = new Hono()
keysRouter.use("*", requireAuth)

// GET /api/keys — list user's API keys (masked)
keysRouter.get("/", async (c) => {
  const session = getSession(c)
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, session.userId),
    columns: { id: true, provider: true, label: true, createdAt: true },
  })
  return c.json({ keys })
})

// POST /api/keys — add a new API key
keysRouter.post("/", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{
    provider: "anthropic" | "openai"
    key: string
    label?: string
  }>()

  const [key] = await db.insert(apiKeys).values({
    userId: session.userId,
    provider: body.provider,
    encryptedKey: encrypt(body.key),
    label: body.label ?? `${body.provider} key`,
  }).returning({ id: apiKeys.id, provider: apiKeys.provider, label: apiKeys.label, createdAt: apiKeys.createdAt })

  // Re-bridge credentials to Lobu agent after adding a key
  try {
    const lobuAgentId = await ensureLobuAgent(session.userId)
    const services = getPeonPlatform().getServices()
    await bridgeCredentials(session.userId, lobuAgentId, services)
  } catch {
    // Non-fatal: key is saved, credential sync can be retried
  }

  return c.json({ key }, 201)
})

// DELETE /api/keys/:id
keysRouter.delete("/:id", async (c) => {
  const session = getSession(c)
  const [deleted] = await db.delete(apiKeys)
    .where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.userId, session.userId)))
    .returning({ id: apiKeys.id })
  if (!deleted) return c.json({ error: "Not found" }, 404)
  return c.json({ ok: true })
})

export { keysRouter }
