/**
 * Internal delegation-complete route.
 *
 * When a delegated Claude Code team finishes (detected via sentinel file
 * or process exit), the worker plugin POSTs here so the gateway can:
 * 1. Broadcast a `delegation_complete` SSE event for immediate UI feedback
 * 2. Enqueue a system message to the orchestrator so it auto-reports results
 *
 * Authentication: Bearer worker-token (same as other /internal routes).
 */

import { randomUUID } from "node:crypto"
import { createLogger, verifyWorkerToken } from "@lobu/core"
import { Hono } from "hono"
import { broadcastToProject } from "../../web/chat-routes.js"
import { db } from "../../db/connection.js"
import { projects, users } from "../../db/schema.js"
import { eq } from "drizzle-orm"
import { getPeonPlatform } from "../../peon/platform.js"

const logger = createLogger("internal-delegation-complete")

interface DelegationCompleteBody {
  projectId: string
  result: string
  exitCode: number | null
}

export function createDelegationCompleteRoutes(): Hono {
  const router = new Hono()

  router.post("/internal/delegation-complete", async (c) => {
    const authHeader = c.req.header("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing authorization" }, 401)
    }

    const workerToken = authHeader.slice(7)
    const tokenData = verifyWorkerToken(workerToken)
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401)
    }

    let body: DelegationCompleteBody
    try {
      body = await c.req.json<DelegationCompleteBody>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    if (!body.projectId) {
      return c.json({ error: "projectId is required" }, 400)
    }

    const { projectId, result, exitCode } = body

    logger.info(`Delegation complete for project ${projectId} (exit=${exitCode})`)

    // Broadcast SSE event so frontend shows immediate feedback
    broadcastToProject(projectId, "delegation_complete", {
      projectId,
      exitCode,
      timestamp: Date.now(),
    })

    // Look up the project and user to enqueue a system message
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { id: true, name: true, userId: true, repoUrl: true },
    })

    if (!project) {
      logger.warn(`delegation-complete: project ${projectId} not found`)
      return c.json({ ok: true, enqueued: false })
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, project.userId),
      columns: { id: true, peonAgentId: true },
    })

    if (!user?.peonAgentId) {
      logger.warn(`delegation-complete: no peonAgentId for user ${project.userId}`)
      return c.json({ ok: true, enqueued: false })
    }

    const peonAgentId = user.peonAgentId
    const truncatedResult = (result || "").slice(0, 4000)
    const statusText = exitCode === 0 ? "completed successfully" : `finished with exit code ${exitCode}`

    const systemMessage = [
      `[system] The delegated coding team for project "${project.name}" has ${statusText}.`,
      "",
      "Review the results and report back to the user. Be concise — summarize what was done, what works, and flag anything incomplete.",
      "",
      truncatedResult ? `Team output:\n${truncatedResult}` : "No output captured — use GetTeamResult to check.",
    ].join("\n")

    // Enqueue to the orchestrator so it starts a new turn
    try {
      const services = getPeonPlatform().getServices()
      const queueProducer = services.getQueueProducer()
      await queueProducer.enqueueMessage({
        userId: user.id,
        conversationId: peonAgentId,
        messageId: randomUUID(),
        channelId: peonAgentId,
        teamId: "peon",
        agentId: peonAgentId,
        botId: "peon-agent",
        platform: "peon",
        messageText: systemMessage,
        platformMetadata: {
          projectId,
          userId: user.id,
          openclawAgentId: `project-${projectId}`,
          projectName: project.name,
          projectRepoUrl: project.repoUrl,
        },
        agentOptions: { provider: "claude" },
      })
      logger.info(`Enqueued delegation-complete message for project ${projectId}`)
    } catch (err) {
      logger.error(`Failed to enqueue delegation-complete message:`, err)
      return c.json({ ok: true, enqueued: false })
    }

    return c.json({ ok: true, enqueued: true })
  })

  return router
}
