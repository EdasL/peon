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
  restartContainer,
} from "../../web/container-manager.js"
import { broadcastToProject } from "../../web/chat-routes.js"

// ---------------------------------------------------------------------------
// Name generation — adjective + noun pairs
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "bold", "brave", "bright", "calm", "clever", "cool", "crisp", "daring",
  "deep", "eager", "fast", "fierce", "firm", "fleet", "free", "fresh",
  "grand", "great", "hardy", "keen", "kind", "light", "lofty", "loyal",
  "mighty", "nimble", "noble", "quick", "quiet", "rapid", "ready", "sharp",
  "sleek", "smart", "solid", "steady", "strong", "sure", "swift", "vast",
  "vivid", "warm", "wild", "wise",
]

const NOUNS = [
  "badger", "bear", "boar", "buck", "bull", "condor", "crane", "crow",
  "deer", "dove", "duck", "eagle", "elk", "falcon", "finch", "fox",
  "frog", "hawk", "heron", "ibis", "jay", "kite", "kiwi", "lark",
  "lion", "lynx", "mink", "mole", "moose", "moth", "mouse", "newt",
  "orca", "otter", "owl", "panda", "pike", "puma", "quail", "raven",
  "robin", "seal", "shark", "snipe", "stag", "swan", "teal", "tiger",
  "vole", "wolf", "wren",
]

function generateProjectName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!
  return `${adj}-${noun}`
}

// ---------------------------------------------------------------------------

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
    name?: string
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

  // Generate a human-readable name if none provided
  const projectName = body.name?.trim() || generateProjectName()

  const result = await db.insert(projects).values({
    userId: session.userId,
    name: projectName,
    repoUrl: body.repoUrl,
    repoBranch: body.repoBranch ?? "main",
    templateId: body.templateId,
    status: "creating",
  }).returning()
  const project = result[0]
  if (!project) return c.json({ error: "Failed to create project" }, 500)

  // Ensure user has a container (idempotent) + init project workspace
  const services = getPeonPlatform().getServices()
  ensureUserContainer(session.userId, services).then(async (containerResult) => {
    if (containerResult.error === "no-api-key") {
      await db.update(projects).set({ status: "error", updatedAt: new Date() }).where(eq(projects.id, project.id))
      broadcastToProject(project.id, "project_status", { status: "error" })
      return
    }
    // Store deployment name in DB for future status queries and cleanup
    const deploymentName = getPeonDeploymentName(session.userId, containerResult.lobuAgentId)
    await db.update(projects)
      .set({ deploymentName, status: "creating" })
      .where(eq(projects.id, project.id))

    await initProjectWorkspace(
      session.userId,
      containerResult.lobuAgentId,
      project.id,
      body.templateId,
      body.repoUrl ?? null,
      services
    )

    // Start polling for container readiness (fire-and-forget)
    const { waitForContainerReady } = await import("../../web/project-launcher.js")
    waitForContainerReady(project.id, deploymentName)
  }).catch(async (err) => {
    console.error(`Failed to launch project ${project.id}:`, err)
    await db.update(projects).set({ status: "error", updatedAt: new Date() }).where(eq(projects.id, project.id))
    broadcastToProject(project.id, "project_status", { status: "error" })
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

// GET /api/projects/:id/status — return real container state
projectsRouter.get("/:id/status", async (c) => {
  const session = getSession(c)
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  let containerStatus: "starting" | "running" | "stopped" | "error"

  if (project.deploymentName) {
    const dockerStatus = await getContainerStatus(project.deploymentName)
    if (dockerStatus !== null) {
      containerStatus = dockerStatus
      // Sync DB status and broadcast to SSE clients
      const dbStatus = dockerStatus === "starting" ? "creating" : dockerStatus
      if (project.status !== dbStatus) {
        await db.update(projects).set({ status: dbStatus as any, updatedAt: new Date() })
          .where(eq(projects.id, project.id))
        broadcastToProject(project.id, "project_status", { status: dbStatus })
      }
    } else {
      containerStatus = mapDbStatus(project.status)
    }
  } else {
    containerStatus = mapDbStatus(project.status)
  }

  return c.json({ status: containerStatus, projectId: project.id })
})

function mapDbStatus(dbStatus: string): "starting" | "running" | "stopped" | "error" {
  switch (dbStatus) {
    case "creating": return "starting"
    case "running": return "running"
    case "error": return "error"
    default: return "stopped"
  }
}

// POST /api/projects/:id/restart — restart a stopped project container
projectsRouter.post("/:id/restart", async (c) => {
  const session = getSession(c)
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  if (!project.deploymentName) {
    return c.json({ error: "No container associated with this project" }, 400)
  }

  const restarted = await restartContainer(project.deploymentName)
  if (!restarted) {
    // Container doesn't exist — need to re-provision
    const services = getPeonPlatform().getServices()
    const { ensureUserContainer, initProjectWorkspace, waitForContainerReady } = await import("../../web/project-launcher.js")

    await db.update(projects).set({ status: "creating", updatedAt: new Date() }).where(eq(projects.id, project.id))

    const containerResult = await ensureUserContainer(session.userId, services)
    if (containerResult.error) {
      await db.update(projects).set({ status: "error", updatedAt: new Date() }).where(eq(projects.id, project.id))
      broadcastToProject(project.id, "project_status", { status: "error" })
      return c.json({ error: containerResult.error }, 400)
    }

    const deploymentName = getPeonDeploymentName(session.userId, containerResult.lobuAgentId)
    await db.update(projects).set({ deploymentName, status: "creating" }).where(eq(projects.id, project.id))

    await initProjectWorkspace(session.userId, containerResult.lobuAgentId, project.id, project.templateId, project.repoUrl, services)
    waitForContainerReady(project.id, deploymentName)

    return c.json({ status: "creating" })
  }

  // Container restarted successfully
  await db.update(projects).set({ status: "running", updatedAt: new Date() }).where(eq(projects.id, project.id))
  broadcastToProject(project.id, "project_status", { status: "running" })
  return c.json({ status: "running" })
})

// PATCH /api/projects/:id — update project name
projectsRouter.patch("/:id", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{ name?: string }>()

  if (!body.name?.trim()) {
    return c.json({ error: "Name is required" }, 400)
  }

  const [updated] = await db.update(projects)
    .set({ name: body.name.trim(), updatedAt: new Date() })
    .where(and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)))
    .returning()

  if (!updated) return c.json({ error: "Not found" }, 404)
  return c.json({ project: updated })
})

// DELETE /api/projects/:id — remove project from DB, remove container if last project
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
