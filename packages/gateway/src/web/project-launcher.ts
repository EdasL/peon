import { randomUUID } from "node:crypto"
import { db } from "../db/connection.js"
import { apiKeys, projects } from "../db/schema.js"
import { eq } from "drizzle-orm"
import { decrypt } from "../services/encryption.js"
import { ensureLobuAgent, bridgeCredentials } from "../peon/agent-helper.js"
import type { CoreServices } from "../platform.js"

/**
 * Ensures the user has a running container (idempotent).
 * On first call: generates lobuAgentId, bridges credentials, creates session,
 * enqueues bootstrap message to trigger container creation.
 * On subsequent calls: re-bridges credentials (in case key changed), returns existing agentId.
 */
export async function ensureUserContainer(
  userId: string,
  services: CoreServices
): Promise<{ lobuAgentId: string; created: boolean; error?: string }> {
  const lobuAgentId = await ensureLobuAgent(userId)

  // Bridge credentials (idempotent — checks if already bridged)
  const hasCreds = await bridgeCredentials(userId, lobuAgentId, services)
  if (!hasCreds) {
    return { lobuAgentId, created: false, error: "no-api-key" }
  }

  // Check if session already exists (container already provisioned)
  const sessionManager = services.getSessionManager()
  const existingSession = await sessionManager.getSession(lobuAgentId)
  if (existingSession) {
    return { lobuAgentId, created: false }
  }

  // First time — create session and enqueue bootstrap message
  await sessionManager.setSession({
    conversationId: lobuAgentId,
    channelId: lobuAgentId,
    userId,
    threadCreator: userId,
    lastActivity: Date.now(),
    createdAt: Date.now(),
    status: "created",
    provider: "claude",
  })

  const queueProducer = services.getQueueProducer()
  await queueProducer.enqueueMessage({
    userId,
    conversationId: lobuAgentId,
    messageId: randomUUID(),
    channelId: lobuAgentId,
    teamId: "peon",
    agentId: lobuAgentId,
    botId: "peon-agent",
    platform: "peon",
    messageText: "[system] User container initialized. Ready for project workspaces.",
    platformMetadata: { userId },
    agentOptions: { provider: "claude" },
  })

  return { lobuAgentId, created: true }
}

/** Map template IDs to Claude Code team lead system prompts */
const TEMPLATE_TEAM_PROMPTS: Record<string, string> = {
  fullstack:
    "You are leading a full-stack development team. You have teammates for frontend, backend, and QA.",
  "backend-only":
    "You are leading a backend development team. Focus on APIs, databases, and server-side logic.",
  "frontend-only":
    "You are leading a frontend development team. Focus on UI components, styling, and user experience.",
  data: "You are leading a data engineering team. Focus on data pipelines, analysis, and visualization.",
  default:
    "You are leading a development team. Adapt your approach based on the project requirements.",
}

/**
 * Initializes a project workspace inside the user's existing container.
 * Creates the workspace directory structure and sends a system message
 * so the agent knows about the new project and its team configuration.
 */
export async function initProjectWorkspace(
  userId: string,
  lobuAgentId: string,
  projectId: string,
  templateId: string,
  repoUrl: string | null,
  services: CoreServices
): Promise<void> {
  const teamPrompt =
    TEMPLATE_TEAM_PROMPTS[templateId] || TEMPLATE_TEAM_PROMPTS.default

  // Build the workspace initialization command that the agent will execute
  const workspaceDirs = [
    `/workspace/projects/${projectId}`,
    `/workspace/projects/${projectId}/.claude`,
    `/workspace/projects/${projectId}/src`,
  ]

  const claudeMdContent = `# Project: ${projectId}

## Team Configuration
${teamPrompt}

## Template
${templateId}
${repoUrl ? `\n## Repository\n${repoUrl}` : ""}
`

  const queueProducer = services.getQueueProducer()
  await queueProducer.enqueueMessage({
    userId,
    conversationId: lobuAgentId,
    messageId: randomUUID(),
    channelId: lobuAgentId,
    teamId: "peon",
    agentId: lobuAgentId,
    botId: "peon-agent",
    platform: "peon",
    messageText: `[system] Initialize project workspace for ${projectId}.

Create the following directory structure:
${workspaceDirs.map((d) => `- ${d}`).join("\n")}

Write this to /workspace/projects/${projectId}/.claude/CLAUDE.md:
\`\`\`
${claudeMdContent}
\`\`\`
${repoUrl ? `\nClone the repository: git clone ${repoUrl} /workspace/projects/${projectId}` : ""}

Template: ${templateId}. Team prompt: ${teamPrompt}

Ready for user instructions.`,
    platformMetadata: {
      projectId,
      userId,
      templateId,
      teamPrompt,
    },
    agentOptions: { provider: "claude" },
  })
}

/**
 * Polls the container status until it becomes "running" or "error", then
 * updates the DB and broadcasts a project_status SSE event.
 * Fires-and-forgets internally — the caller is not blocked.
 */
export async function waitForContainerReady(
  projectId: string,
  deploymentName: string,
  timeoutMs = 90_000,
  intervalMs = 3_000,
): Promise<void> {
  const { getContainerStatus } = await import("./container-manager.js")
  const { broadcastToProject } = await import("./chat-routes.js")
  const deadline = Date.now() + timeoutMs

  const poll = async () => {
    while (Date.now() < deadline) {
      const status = await getContainerStatus(deploymentName)
      if (status === "running") {
        await db.update(projects).set({ status: "running", updatedAt: new Date() })
          .where(eq(projects.id, projectId))
        broadcastToProject(projectId, "project_status", { status: "running" })
        return
      }
      if (status === "error") {
        await db.update(projects).set({ status: "error", updatedAt: new Date() })
          .where(eq(projects.id, projectId))
        broadcastToProject(projectId, "project_status", { status: "error" })
        return
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    // Timeout — mark as error
    await db.update(projects).set({ status: "error", updatedAt: new Date() })
      .where(eq(projects.id, projectId))
    broadcastToProject(projectId, "project_status", { status: "error" })
  }

  // Fire and forget the polling — don't block the response
  poll().catch((err) => {
    console.error(`Container readiness poll failed for ${projectId}:`, err)
  })
}

export async function getProjectApiKey(userId: string): Promise<{ provider: string; key: string } | null> {
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.userId, userId),
  })
  if (!key) return null
  return { provider: key.provider, key: decrypt(key.encryptedKey) }
}
