/**
 * Internal task sync route.
 *
 * Worker containers (via the peon-gateway plugin) POST task create/update
 * events here when they intercept TaskCreate/TaskUpdate tool calls from
 * Claude Code's stream-json output in DelegateToProject.
 *
 * Authentication: Bearer worker-token (same as all /internal routes).
 * The token carries conversationId → used to resolve the projectId.
 */

import { createLogger, verifyWorkerToken } from "@lobu/core"
import { Hono } from "hono"
import { getActiveProject } from "../../web/chat-routes.js"
import { handleWorkerTaskUpdate, deleteProjectTask, getProjectTasks } from "../../web/task-sync.js"
import type { WorkerTask } from "../../web/task-sync.js"
import { db } from "../../db/connection.js"
import { projects, users, tasks } from "../../db/schema.js"
import { eq, and, lt, sql } from "drizzle-orm"

const logger = createLogger("internal-tasks")

// Cache conversationId → projectId (same pattern as agent-activity)
const PROJECT_CACHE_MAX = 500
const projectIdCache = new Map<string, { id: string | null; expiresAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of projectIdCache) {
    if (val.expiresAt <= now) projectIdCache.delete(key)
  }
}, 5 * 60_000)

// Stale lock cleanup: release locks older than 30 minutes every 5 minutes
setInterval(async () => {
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000)
    const released = await db.update(tasks)
      .set({ lockedBy: null, lockedAt: null, lockedRunId: null, updatedAt: new Date() })
      .where(and(
        sql`${tasks.lockedAt} IS NOT NULL`,
        lt(tasks.lockedAt, thirtyMinAgo)
      ))
      .returning({ id: tasks.id })

    if (released.length > 0) {
      logger.info(`Stale lock cleanup: released ${released.length} locks`)
    }
  } catch (err) {
    logger.error("Stale lock cleanup failed", err)
  }
}, 5 * 60_000)

async function resolveProjectId(conversationId: string): Promise<string | null> {
  const active = getActiveProject(conversationId)
  if (active) return active

  const cached = projectIdCache.get(conversationId)
  if (cached && cached.expiresAt > Date.now()) return cached.id

  const user = await db.query.users.findFirst({
    where: eq(users.peonAgentId, conversationId),
    columns: { id: true },
  })
  if (!user) {
    projectIdCache.set(conversationId, { id: null, expiresAt: Date.now() + 60_000 })
    return null
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.userId, user.id),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
    columns: { id: true },
  })
  const id = project?.id ?? null
  if (projectIdCache.size >= PROJECT_CACHE_MAX) {
    const firstKey = projectIdCache.keys().next().value
    if (firstKey) projectIdCache.delete(firstKey)
  }
  projectIdCache.set(conversationId, { id, expiresAt: Date.now() + 60_000 })
  return id
}

function authMiddleware(c: any): { conversationId: string } | null {
  const authHeader = c.req.header("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const tokenData = verifyWorkerToken(authHeader.slice(7))
  if (!tokenData) return null
  return tokenData
}

export function createInternalTaskRoutes(): Hono {
  const router = new Hono()

  // POST /internal/tasks — upsert a task
  router.post("/internal/tasks", async (c) => {
    const token = authMiddleware(c)
    if (!token) return c.json({ error: "Unauthorized" }, 401)

    let body: WorkerTask
    try {
      body = await c.req.json<WorkerTask>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    if (!body.id || !body.subject) {
      return c.json({ error: "id and subject are required" }, 400)
    }

    const projectId = await resolveProjectId(token.conversationId)
    if (!projectId) {
      logger.warn(`internal/tasks: no project found for conversationId=${token.conversationId}`)
      return c.json({ error: "No active project found" }, 404)
    }

    const task: WorkerTask = {
      id: body.id,
      subject: body.subject,
      description: body.description ?? "",
      status: body.status ?? "pending",
      owner: body.owner ?? null,
      boardColumn: body.boardColumn ?? "todo",
      metadata: body.metadata ?? undefined,
      updatedAt: body.updatedAt ?? Date.now(),
      blocks: body.blocks ?? [],
      blockedBy: body.blockedBy ?? [],
    }

    await handleWorkerTaskUpdate(projectId, task)
    logger.debug(`internal/tasks: upserted task ${task.id} for project ${projectId}`)
    return c.json({ ok: true, projectId, taskId: task.id })
  })

  // DELETE /internal/tasks/:taskId — delete a task
  router.delete("/internal/tasks/:taskId", async (c) => {
    const token = authMiddleware(c)
    if (!token) return c.json({ error: "Unauthorized" }, 401)

    const taskId = c.req.param("taskId")
    const projectId = await resolveProjectId(token.conversationId)
    if (!projectId) return c.json({ error: "No active project found" }, 404)

    await deleteProjectTask(projectId, taskId)
    logger.debug(`internal/tasks: deleted task ${taskId} for project ${projectId}`)
    return c.json({ ok: true })
  })

  // GET /internal/tasks — list tasks for the active project
  router.get("/internal/tasks", async (c) => {
    const token = authMiddleware(c)
    if (!token) return c.json({ error: "Unauthorized" }, 401)

    const projectId = await resolveProjectId(token.conversationId)
    if (!projectId) return c.json({ tasks: [] })

    const projectTasks = await getProjectTasks(projectId)
    return c.json({ tasks: projectTasks })
  })

  // POST /internal/tasks/:id/checkout — atomic task checkout
  router.post("/internal/tasks/:id/checkout", async (c) => {
    const token = authMiddleware(c)
    if (!token) return c.json({ error: "Unauthorized" }, 401)

    const taskId = c.req.param("id")
    const body = await c.req.json<{ agentRole: string; runId: string }>().catch(() => null)
    if (!body?.agentRole || !body?.runId) {
      return c.json({ error: "agentRole and runId required" }, 400)
    }

    const projectId = await resolveProjectId(token.conversationId)
    if (!projectId) return c.json({ error: "No active project found" }, 404)

    const result = await db.update(tasks)
      .set({
        lockedBy: body.agentRole,
        lockedAt: new Date(),
        lockedRunId: body.runId,
        owner: body.agentRole,
        status: "in_progress",
        boardColumn: "in_progress",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.projectId, projectId),
          sql`${tasks.lockedBy} IS NULL`
        )
      )
      .returning({ id: tasks.id })

    if (result.length === 0) {
      return c.json({ error: "Task already locked or not found" }, 409)
    }

    logger.debug(`internal/tasks: checked out task ${taskId} to ${body.agentRole}`)
    return c.json({ ok: true, taskId })
  })

  // POST /internal/tasks/:id/release — release task lock
  router.post("/internal/tasks/:id/release", async (c) => {
    const token = authMiddleware(c)
    if (!token) return c.json({ error: "Unauthorized" }, 401)

    const taskId = c.req.param("id")
    const projectId = await resolveProjectId(token.conversationId)
    if (!projectId) return c.json({ error: "No active project found" }, 404)

    await db.update(tasks)
      .set({
        lockedBy: null,
        lockedAt: null,
        lockedRunId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))

    logger.debug(`internal/tasks: released lock on task ${taskId}`)
    return c.json({ ok: true })
  })

  return router
}
