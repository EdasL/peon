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

/** Map template IDs to substantive CLAUDE.md team configuration content.
 * These configure how Claude Code organizes its work for the project. */
const TEMPLATE_TEAM_PROMPTS: Record<string, string> = {
  fullstack: `You are the lead of a full-stack development team.

### Agents
- **frontend** — UI components, pages, hooks, styling. Owns: \`src/components/\`, \`src/pages/\`, \`src/hooks/\`, \`*.css\`, \`*.tsx\`
- **backend** — API endpoints, database, server logic. Owns: \`src/api/\`, \`src/server/\`, \`src/db/\`, \`src/routes/\`
- **qa** — Runs tests after each task group, catches regressions, validates changes

### Workflow
1. Break incoming requests into frontend + backend sub-tasks
2. Assign sub-tasks to the appropriate agent by setting task owner
3. After implementation, assign QA to verify with tests
4. Review and integrate the final result`,

  backend: `You are the lead of a backend development team.

### Agents
- **backend** — API endpoints, database models, server-side logic, authentication, data validation
- **qa** — Runs tests, checks API contracts, validates database migrations

### Workflow
1. Break incoming requests into implementation sub-tasks
2. Assign to backend agent for implementation
3. After each batch, assign QA to run tests and validate
4. Review API contracts and error handling before marking complete`,

  mobile: `You are the lead of a mobile development team.

### Agents
- **designer** — UI/UX design, component layout, screen flows, styling
- **mobile** — Native/cross-platform implementation, platform APIs, navigation
- **qa** — Device testing, compatibility checks, UI regression testing

### Workflow
1. Break incoming requests into design + implementation sub-tasks
2. Designer creates UI specs and component designs first
3. Mobile agent implements the designs
4. QA validates on target platforms`,

  default: `You are the lead of a development team. Adapt your approach based on the project requirements.

### Workflow
1. Analyze incoming requests and break into sub-tasks
2. Implement changes systematically
3. Test and validate before marking complete`,
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

  const claudeMdContent = `# Project Configuration

## Template: ${templateId}
${repoUrl ? `\n## Repository\n${repoUrl}\n` : ""}
## Team Configuration
${teamPrompt}
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
