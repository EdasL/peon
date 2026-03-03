import { randomUUID } from "node:crypto"
import { createLogger } from "@lobu/core"
import { db } from "../db/connection.js"
import { users, apiKeys } from "../db/schema.js"
import { eq } from "drizzle-orm"
import { decrypt } from "../services/encryption.js"
import type { CoreServices } from "../platform.js"

const logger = createLogger("peon-agent-helper")

/**
 * Ensures a user has a lobuAgentId, creating one if needed.
 * Returns the lobuAgentId.
 */
export async function ensureLobuAgent(
  userId: string
): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })
  if (!user) {
    throw new Error(`User ${userId} not found`)
  }

  if (user.lobuAgentId) {
    return user.lobuAgentId
  }

  const lobuAgentId = randomUUID()
  await db
    .update(users)
    .set({ lobuAgentId, updatedAt: new Date() })
    .where(eq(users.id, userId))

  logger.info({ userId, lobuAgentId }, "Created lobuAgentId for user")
  return lobuAgentId
}

/**
 * Bridges the user's API keys from Postgres into Lobu's AgentSettingsStore
 * so the orchestrator can inject them into workers via the proxy pattern.
 *
 * Checks three credential sources (in order):
 * 1. API keys in Postgres `apiKeys` table (manual keys from settings)
 * 2. OAuth profiles already stored in Redis (e.g. Claude Code login)
 * 3. System-level env vars (ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN)
 *
 * Returns true if at least one credential source is available.
 */
export async function bridgeCredentials(
  userId: string,
  lobuAgentId: string,
  services: CoreServices
): Promise<boolean> {
  const agentSettingsStore = services.getAgentSettingsStore()

  const { AuthProfilesManager } = await import(
    "../auth/settings/auth-profiles-manager.js"
  )
  const profilesManager = new AuthProfilesManager(agentSettingsStore)

  const { ProviderCatalogService } = await import(
    "../auth/provider-catalog.js"
  )
  const catalogService = new ProviderCatalogService(
    agentSettingsStore,
    profilesManager
  )

  // Fetch all API keys for this user from Postgres
  const userKeys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, userId),
  })

  logger.info(
    { userId, lobuAgentId, keyCount: userKeys.length, providers: userKeys.map(k => k.provider) },
    "bridgeCredentials: fetched user API keys from DB"
  )

  let bridgedCount = 0

  for (const key of userKeys) {
    const decryptedKey = decrypt(key.encryptedKey)
    const keyPreview = decryptedKey.length > 8
      ? `${decryptedKey.slice(0, 7)}...${decryptedKey.slice(-4)}`
      : "***"

    if (key.provider === "anthropic") {
      logger.info(
        { userId, lobuAgentId, keyPreview, label: key.label },
        "bridgeCredentials: upserting Anthropic key into Redis"
      )
      await catalogService.installProvider(lobuAgentId, "claude")
      await profilesManager.upsertProfile({
        agentId: lobuAgentId,
        provider: "claude",
        credential: decryptedKey,
        authType: "api-key",
        label: `Peon bridge (${key.label || "default"})`,
        makePrimary: true,
      })
      logger.info(
        { userId, lobuAgentId },
        "Bridged Anthropic credential to Lobu agent"
      )
      bridgedCount++
    } else if (key.provider === "openai") {
      await catalogService.installProvider(lobuAgentId, "openai")
      await profilesManager.upsertProfile({
        agentId: lobuAgentId,
        provider: "openai",
        credential: decryptedKey,
        authType: "api-key",
        label: `Peon bridge (${key.label || "default"})`,
        makePrimary: true,
      })
      logger.info(
        { userId, lobuAgentId },
        "Bridged OpenAI credential to Lobu agent"
      )
      bridgedCount++
    }
  }

  if (bridgedCount > 0) {
    return true
  }

  // No keys in Postgres — check if OAuth profiles already exist in Redis
  // (e.g. user authenticated via Claude Code OAuth login)
  const hasClaudeProfile = await profilesManager.hasProviderProfiles(lobuAgentId, "claude")
  const hasOpenAiProfile = await profilesManager.hasProviderProfiles(lobuAgentId, "openai")

  if (hasClaudeProfile || hasOpenAiProfile) {
    logger.info(
      { userId, lobuAgentId, hasClaudeProfile, hasOpenAiProfile },
      "bridgeCredentials: found existing OAuth profiles in Redis"
    )
    return true
  }

  // Last resort — check for system-level env var keys
  const hasSystemKey = !!(
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY
  )

  if (hasSystemKey) {
    logger.info(
      { userId, lobuAgentId },
      "bridgeCredentials: using system-level credentials"
    )
    return true
  }

  logger.warn({ userId, lobuAgentId }, "No credentials found (DB, OAuth profiles, or system env)")
  return false
}
