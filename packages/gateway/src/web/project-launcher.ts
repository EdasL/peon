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

export interface TeamMemberConfig {
  roleName: string
  displayName: string
  systemPrompt: string
}

/**
 * Build the CLAUDE.md content for the project.
 * This file is read by the lead session and contains project-level context.
 * The actual team spawning happens via the system message prompt, not CLAUDE.md.
 */
function buildClaudeMd(
  projectId: string,
  templateId: string,
  repoUrl: string | null,
  members: TeamMemberConfig[]
): string {
  const memberList = members
    .filter((m) => m.roleName !== "lead")
    .map((m) => `- **${m.roleName}** (${m.displayName})`)
    .join("\n")

  return `# Project: ${projectId}

## Template: ${templateId}
${repoUrl ? `\n## Repository\n${repoUrl}\n` : ""}
## Agent Team

This project uses Claude Code Agent Teams. You are the team lead.
Your teammates are separate Claude Code sessions that work in parallel.

### Teammates
${memberList}

### Coordination
- Use the shared task list to assign and track work
- Message teammates directly when they need context or course corrections
- Each teammate owns their scope — do not duplicate their work
- Run QA after each task group before marking work complete
`
}

/**
 * Build the team spawn instruction that the lead session will execute.
 * This tells Claude Code to create an Agent Team and spawn each teammate
 * with their specific role prompt.
 */
function buildTeamSpawnInstruction(members: TeamMemberConfig[]): string {
  const nonLeadMembers = members.filter((m) => m.roleName !== "lead")
  if (nonLeadMembers.length === 0) return ""

  const teammateSpecs = nonLeadMembers.map((m) => {
    const firstLine = m.systemPrompt.split("\n")[0] || m.displayName
    return `- **${m.roleName}** ("${m.displayName}"): ${firstLine}`
  }).join("\n")

  const spawnBlock = nonLeadMembers.map((m) => {
    const escapedPrompt = m.systemPrompt.replace(/"/g, '\\"')
    return `  - ${m.displayName} (role: ${m.roleName}): "${escapedPrompt}"`
  }).join("\n")

  return `Create an agent team for this project. Spawn the following teammates:

${spawnBlock}

Each teammate should work independently in their own scope. Use the shared task list to coordinate. Teammates can message each other directly.

Team composition:
${teammateSpecs}
`
}

/**
 * Initializes a project workspace inside the user's existing container.
 * Creates the workspace directory structure, writes CLAUDE.md with team
 * context, and sends a system message that instructs the lead to spawn
 * Agent Team teammates.
 *
 * When teamMembers is provided, actual Claude Code Agent Team teammates
 * are spawned via the system message prompt. The lead session acts as
 * coordinator and each specialist gets their own Claude Code session.
 */
export async function initProjectWorkspace(
  userId: string,
  lobuAgentId: string,
  projectId: string,
  templateId: string,
  repoUrl: string | null,
  services: CoreServices,
  teamMembers?: TeamMemberConfig[]
): Promise<void> {
  const members = teamMembers?.length ? teamMembers : []

  const workspaceDirs = [
    `/workspace/projects/${projectId}`,
    `/workspace/projects/${projectId}/.claude`,
    `/workspace/projects/${projectId}/src`,
  ]

  const claudeMdContent = buildClaudeMd(projectId, templateId, repoUrl, members)
  const teamSpawnInstruction = members.length > 0
    ? buildTeamSpawnInstruction(members)
    : ""

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
${teamSpawnInstruction ? `\n${teamSpawnInstruction}` : ""}
Ready for user instructions.`,
    platformMetadata: {
      projectId,
      userId,
      templateId,
      teamMembers: members,
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
  timeoutMs = 120_000,
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
        broadcastToProject(projectId, "project_status", { status: "error", message: "Container reported an error during startup" })
        return
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    // Timeout — mark as error
    await db.update(projects).set({ status: "error", updatedAt: new Date() })
      .where(eq(projects.id, projectId))
    broadcastToProject(projectId, "project_status", { status: "error", message: "Container failed to start within 2 minutes" })
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
