import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { projects, apiKeys, users } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { ensureUserContainer, initProjectWorkspace } from "../../web/project-launcher.js"
import { getPeonPlatform } from "../../peon/platform.js"
import {
  getPeonDeploymentName,
  getContainerStatus,
  removeContainer,
} from "../../web/container-manager.js"

const projectsRouter = new Hono()
projectsRouter.use("*", requireAuth)

// GET /api/projects — list user's projects with real container status
projectsRouter.get("/", async (c) => {
  const session = getSession(c)
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.userId),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
  })

  // Fetch the user's lobuAgentId for Docker status queries
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { lobuAgentId: true },
  })

  // If we have a container deployment name, query Docker for real status
  if (user?.lobuAgentId) {
    const deploymentName = getPeonDeploymentName(session.userId, user.lobuAgentId)
    const dockerStatus = await getContainerStatus(deploymentName)
    if (dockerStatus !== null) {
      // Map Docker status to projects schema enum: "creating" | "running" | "stopped" | "error"
      const dbStatus = dockerStatus === "starting" ? "creating" : dockerStatus
      // Update all user's projects with the real container status
      const statusUpdates = userProjects.map((p) => ({
        ...p,
        status: dbStatus as typeof p.status,
      }))
      return c.json({ projects: statusUpdates })
    }
  }

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
    // Store deployment name in DB for future status queries and cleanup
    const deploymentName = getPeonDeploymentName(session.userId, result.lobuAgentId)
    await db.update(projects)
      .set({ deploymentName, status: "creating" })
      .where(eq(projects.id, project.id))

    await initProjectWorkspace(
      session.userId,
      result.lobuAgentId,
      project.id,
      body.templateId,
      body.repoUrl ?? null,
      services
    )
  }).catch(async (err) => {
    console.error(`Failed to launch project ${project.id}:`, err)
    await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
  })

  return c.json({ project }, 201)
})

// GET /api/projects/:id — with real Docker status
projectsRouter.get("/:id", async (c) => {
  const session = getSession(c)
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  // Enrich with real Docker container status if we have the deployment name
  if (project.deploymentName) {
    const dockerStatus = await getContainerStatus(project.deploymentName)
    if (dockerStatus !== null) {
      const dbStatus = dockerStatus === "starting" ? "creating" : dockerStatus
      return c.json({ project: { ...project, status: dbStatus } })
    }
  }

  return c.json({ project })
})

// DELETE /api/projects/:id — stop/remove container if this is the last project
projectsRouter.delete("/:id", async (c) => {
  const session = getSession(c)
  const [deleted] = await db.delete(projects)
    .where(and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)))
    .returning()
  if (!deleted) return c.json({ error: "Not found" }, 404)

  // Check if user has any remaining projects
  const remainingProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.userId),
    columns: { id: true },
  })

  // Only remove the container when the user has no remaining projects
  if (remainingProjects.length === 0 && deleted.deploymentName) {
    removeContainer(deleted.deploymentName).catch((err) => {
      console.error(`Failed to remove container ${deleted.deploymentName}:`, err)
    })
  }

  return c.json({ project: deleted })
})

export { projectsRouter }
