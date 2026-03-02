import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { projects, apiKeys } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { ensureUserContainer, initProjectWorkspace } from "../../web/project-launcher.js"
import { getPeonPlatform } from "../../peon/platform.js"

const projectsRouter = new Hono()
projectsRouter.use("*", requireAuth)

// GET /api/projects — list user's projects
projectsRouter.get("/", async (c) => {
  const session = getSession(c)
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.userId),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
  })
  return c.json({ projects: userProjects })
})

// POST /api/projects — create a new project
projectsRouter.post("/", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{
    name: string
    repoUrl?: string
    repoBranch?: string
    templateId: string
  }>()

  // Require API key before creating project
  const hasApiKey = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.userId, session.userId), eq(apiKeys.provider, "anthropic")),
  })
  if (!hasApiKey) {
    return c.json({ error: "Add an Anthropic API key in settings before creating a project" }, 400)
  }

  const result = await db.insert(projects).values({
    userId: session.userId,
    name: body.name,
    repoUrl: body.repoUrl,
    repoBranch: body.repoBranch ?? "main",
    templateId: body.templateId,
    status: "creating",
  }).returning()
  const project = result[0]
  if (!project) return c.json({ error: "Failed to create project" }, 500)

  // Ensure user has a container (idempotent) + init project workspace
  const services = getPeonPlatform().getServices()
  ensureUserContainer(session.userId, services).then(async (result) => {
    if (result.error === "no-api-key") {
      await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
      return
    }
    await initProjectWorkspace(
      session.userId,
      result.lobuAgentId,
      project.id,
      body.templateId,
      body.repoUrl ?? null,
      services
    )
    await db.update(projects).set({ status: "creating" }).where(eq(projects.id, project.id))
  }).catch(async (err) => {
    console.error(`Failed to launch project ${project.id}:`, err)
    await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
  })

  return c.json({ project }, 201)
})

// GET /api/projects/:id
projectsRouter.get("/:id", async (c) => {
  const session = getSession(c)
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)
  return c.json({ project })
})

// DELETE /api/projects/:id
projectsRouter.delete("/:id", async (c) => {
  const session = getSession(c)
  const [deleted] = await db.delete(projects)
    .where(and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)))
    .returning()
  if (!deleted) return c.json({ error: "Not found" }, 404)
  return c.json({ project: deleted })
})

export { projectsRouter }
