import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { apiKeys } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { encrypt } from "../../services/encryption.js"
import { ensureLobuAgent, bridgeCredentials } from "../../peon/agent-helper.js"
import { getPeonPlatform } from "../../peon/platform.js"

const ALLOWED_PROVIDERS = ["anthropic", "openai"] as const
type AllowedProvider = typeof ALLOWED_PROVIDERS[number]

const keysRouter = new Hono()
keysRouter.use("*", requireAuth)

// GET /api/keys — list user's API keys (provider name only, never expose raw key)
keysRouter.get("/", async (c) => {
  const session = getSession(c)
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, session.userId),
    columns: { id: true, provider: true, label: true, createdAt: true },
  })
  return c.json({ keys })
})

// POST /api/keys — add or update an API key (one per provider per user)
keysRouter.post("/", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{
    provider: string
    key: string
    label?: string
  }>()

  // Validate provider
  if (!ALLOWED_PROVIDERS.includes(body.provider as AllowedProvider)) {
    return c.json(
      { error: `Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(", ")}` },
      400
    )
  }

  const provider = body.provider as AllowedProvider

  // Check if a key already exists for this provider
  const existing = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.userId, session.userId),
      eq(apiKeys.provider, provider)
    ),
  })

  let key: { id: string; provider: string; label: string | null; createdAt: Date }

  if (existing) {
    // Update the existing key (upsert semantics — no duplicates)
    const [updated] = await db
      .update(apiKeys)
      .set({
        encryptedKey: encrypt(body.key),
        label: body.label ?? existing.label ?? `${provider} key`,
      })
      .where(eq(apiKeys.id, existing.id))
      .returning({
        id: apiKeys.id,
        provider: apiKeys.provider,
        label: apiKeys.label,
        createdAt: apiKeys.createdAt,
      })

    if (!updated) return c.json({ error: "Failed to update key" }, 500)
    key = updated
  } else {
    // Insert new key
    const [inserted] = await db
      .insert(apiKeys)
      .values({
        userId: session.userId,
        provider,
        encryptedKey: encrypt(body.key),
        label: body.label ?? `${provider} key`,
      })
      .returning({
        id: apiKeys.id,
        provider: apiKeys.provider,
        label: apiKeys.label,
        createdAt: apiKeys.createdAt,
      })

    if (!inserted) return c.json({ error: "Failed to create key" }, 500)
    key = inserted
  }

  // Re-bridge credentials to Lobu agent after adding/updating a key
  try {
    const lobuAgentId = await ensureLobuAgent(session.userId)
    const services = getPeonPlatform().getServices()
    await bridgeCredentials(session.userId, lobuAgentId, services)
  } catch {
    // Non-fatal: key is saved, credential sync can be retried
  }

  const statusCode = existing ? 200 : 201
  return c.json({ key }, statusCode)
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
