import { createLogger } from "@lobu/core"
import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { apiKeys } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { encrypt } from "../../services/encryption.js"
import { ensurePeonAgent, bridgeCredentials } from "../../peon/agent-helper.js"
import { getPeonPlatform } from "../../peon/platform.js"
import { AuthProfilesManager } from "../../auth/settings/auth-profiles-manager.js"
import { recycleUserContainer } from "../../web/credential-refresh.js"

const logger = createLogger("api-keys")

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

  let oauthConnections: Array<{
    provider: string
    authType: string
    label: string
    connectedAt?: string
  }> = []

  try {
    const agentId = await ensurePeonAgent(session.userId)
    const agentSettingsStore = getPeonPlatform().getServices().getAgentSettingsStore()
    const profilesManager = new AuthProfilesManager(agentSettingsStore)
    const profile = await profilesManager.getBestProfile(agentId, "claude")

    if (profile && profile.authType === "oauth") {
      oauthConnections.push({
        provider: "anthropic",
        authType: "oauth",
        label: profile.label || "Claude subscription",
      })
    }
  } catch {
    // Platform services may not be initialized yet — return empty array
  }

  return c.json({ keys, oauthConnections })
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

  // Validate key format
  if (provider === "anthropic" && !body.key.startsWith("sk-ant-")) {
    return c.json({ error: "Invalid Anthropic API key format — must start with sk-ant-" }, 400)
  }
  if (provider === "openai" && !body.key.startsWith("sk-")) {
    return c.json({ error: "Invalid OpenAI API key format — must start with sk-" }, 400)
  }

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

  // Re-bridge credentials and recycle the container so the new key takes effect
  try {
    const peonAgentId = await ensurePeonAgent(session.userId)
    const services = getPeonPlatform().getServices()
    await bridgeCredentials(session.userId, peonAgentId, services)
    await recycleUserContainer(session.userId, peonAgentId)
  } catch (err) {
    logger.warn("Non-fatal: credential bridge/recycle failed", { error: err })
  }

  const statusCode = existing ? 200 : 201
  return c.json({ key }, statusCode)
})

// DELETE /api/keys/oauth/:provider — disconnect an OAuth provider
keysRouter.delete("/oauth/:provider", async (c) => {
  const provider = c.req.param("provider")
  if (provider !== "anthropic") {
    return c.json({ error: "Unsupported OAuth provider" }, 400)
  }

  const session = getSession(c)
  const agentId = await ensurePeonAgent(session.userId)
  const agentSettingsStore = getPeonPlatform().getServices().getAgentSettingsStore()
  const profilesManager = new AuthProfilesManager(agentSettingsStore)
  await profilesManager.deleteProviderProfiles(agentId, "claude")

  return c.json({ ok: true })
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
