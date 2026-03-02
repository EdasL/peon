import { randomUUID } from "node:crypto"
import { createLogger } from "@lobu/core"
import { db } from "../db/connection.js"
import { users, apiKeys } from "../db/schema.js"
import { eq, and } from "drizzle-orm"
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
 * Bridges the user's Anthropic API key from Postgres into Lobu's
 * AgentSettingsStore so the orchestrator can inject it into workers.
 *
 * Returns true if a credential was bridged, false if no key found.
 */
export async function bridgeCredentials(
  userId: string,
  lobuAgentId: string,
  services: CoreServices
): Promise<boolean> {
  const agentSettingsStore = services.getAgentSettingsStore()

  // Check if profile already exists
  const { AuthProfilesManager } = await import(
    "../auth/settings/auth-profiles-manager.js"
  )
  const profilesManager = new AuthProfilesManager(agentSettingsStore)
  // Always ensure provider is installed in catalog (idempotent)
  const { ProviderCatalogService } = await import(
    "../auth/provider-catalog.js"
  )
  const catalogService = new ProviderCatalogService(
    agentSettingsStore,
    profilesManager
  )
  // "anthropic" in apiKeys table maps to "claude" in the module registry
  await catalogService.installProvider(lobuAgentId, "claude")

  const hasProfile = await profilesManager.hasProviderProfiles(
    lobuAgentId,
    "claude"
  )
  if (hasProfile) {
    return true
  }

  // Read user's Anthropic API key from Postgres
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.userId, userId), eq(apiKeys.provider, "anthropic")),
  })
  if (!key) {
    logger.warn({ userId, lobuAgentId }, "No Anthropic API key found for user")
    return false
  }

  const decryptedKey = decrypt(key.encryptedKey)

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
  return true
}
