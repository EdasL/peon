/**
 * Internal boot-progress route.
 *
 * Worker containers POST boot progress steps here during startup so the
 * gateway can broadcast real-time boot status to frontend SSE clients.
 * When the worker reports "ready", the gateway transitions all of the
 * user's "creating" projects to "running".
 *
 * Authentication: Bearer worker-token (same as other /internal routes).
 */

import { createLogger, verifyWorkerToken } from "@lobu/core"
import { Hono } from "hono"
import { broadcastToProject } from "../../web/chat-routes.js"
import { db } from "../../db/connection.js"
import { projects, users } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"

const logger = createLogger("internal-boot-progress")

export interface BootProgressEvent {
  step: string
  label: string
}

const STEP_ORDER = ["container", "workspace", "engine", "ready"] as const
export type BootStep = (typeof STEP_ORDER)[number]

/**
 * Find all "creating" projects for the user identified by conversationId.
 */
async function findCreatingProjects(conversationId: string): Promise<string[]> {
  const user = await db.query.users.findFirst({
    where: eq(users.peonAgentId, conversationId),
    columns: { id: true },
  })
  if (!user) return []

  const creatingProjects = await db.query.projects.findMany({
    where: and(eq(projects.userId, user.id), eq(projects.status, "creating")),
    columns: { id: true },
  })

  return creatingProjects.map((p) => p.id)
}

export function createBootProgressRoutes(): Hono {
  const router = new Hono()

  router.post("/internal/boot-progress", async (c) => {
    const authHeader = c.req.header("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing authorization" }, 401)
    }

    const workerToken = authHeader.slice(7)
    const tokenData = verifyWorkerToken(workerToken)
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401)
    }

    let body: BootProgressEvent
    try {
      body = await c.req.json<BootProgressEvent>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    if (!body.step || !body.label) {
      return c.json({ error: "step and label are required" }, 400)
    }

    const { conversationId } = tokenData
    const projectIds = await findCreatingProjects(conversationId)

    if (projectIds.length === 0) {
      logger.debug(`boot-progress: no creating projects for ${conversationId}`)
      return c.json({ ok: true })
    }

    logger.info(`boot-progress: step=${body.step} label="${body.label}" projects=[${projectIds.join(",")}]`)

    const event: BootProgressEvent = {
      step: body.step.slice(0, 50),
      label: body.label.slice(0, 200),
    }

    for (const projectId of projectIds) {
      broadcastToProject(projectId, "boot_progress", event)
    }

    if (body.step === "ready") {
      for (const projectId of projectIds) {
        await db
          .update(projects)
          .set({ status: "running", updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), eq(projects.status, "creating")))

        broadcastToProject(projectId, "project_status", { status: "running" })
      }
      logger.info(`boot-progress: marked ${projectIds.length} project(s) as running`)
    }

    return c.json({ ok: true })
  })

  return router
}
