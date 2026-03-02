import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { projects } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { launchProject, getProjectApiKey } from "../../web/project-launcher.js"

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

  // Launch container in background
  const apiKey = await getProjectApiKey(session.userId)
  if (apiKey) {
    launchProject({
      projectId: project.id,
      userId: session.userId,
      repoUrl: body.repoUrl ?? null,
      templateId: body.templateId,
      apiKey,
    }).catch(async (err) => {
      console.error(`Failed to launch project ${project.id}:`, err)
      await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
    })
  }

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
