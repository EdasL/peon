import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { projects, teams, teamMembers } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"

// ---------------------------------------------------------------------------
// projectTeamsRouter — mounted at /api/projects
// Handles: POST /api/projects/:id/teams, GET /api/projects/:id/teams
// ---------------------------------------------------------------------------

const projectTeamsRouter = new Hono()
projectTeamsRouter.use("*", requireAuth)

// POST /api/projects/:id/teams — create a team with members
projectTeamsRouter.post("/:id/teams", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
    columns: { id: true },
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const body = await c.req.json<{
    name: string
    members?: Array<{
      roleName: string
      displayName: string
      systemPrompt: string
      color?: string
    }>
  }>()

  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400)
  }

  const [team] = await db.insert(teams).values({
    projectId,
    name: body.name.trim(),
  }).returning()
  if (!team) return c.json({ error: "Failed to create team" }, 500)

  let members: typeof teamMembers.$inferSelect[] = []
  if (body.members?.length) {
    members = await db.insert(teamMembers).values(
      body.members.map((m) => ({
        teamId: team.id,
        roleName: m.roleName,
        displayName: m.displayName,
        systemPrompt: m.systemPrompt,
        color: m.color ?? "bg-zinc-500",
      }))
    ).returning()
  }

  return c.json({ team: { ...team, members } }, 201)
})

// GET /api/projects/:id/teams — list teams for a project with members
projectTeamsRouter.get("/:id/teams", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
    columns: { id: true },
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const projectTeams = await db.query.teams.findMany({
    where: eq(teams.projectId, projectId),
    with: { members: true },
  })

  return c.json({ teams: projectTeams })
})

// ---------------------------------------------------------------------------
// teamMembersRouter — mounted at /api/teams
// Handles: POST /api/teams/:id/members, DELETE /api/teams/:id/members/:memberId
// ---------------------------------------------------------------------------

const teamMembersRouter = new Hono()
teamMembersRouter.use("*", requireAuth)

// POST /api/teams/:id/members — add a member to an existing team
teamMembersRouter.post("/:id/members", async (c) => {
  const session = getSession(c)
  const teamId = c.req.param("id")

  // Validate ownership: team → project → user
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    with: { project: { columns: { userId: true } } },
  })
  if (!team || team.project.userId !== session.userId) {
    return c.json({ error: "Not found" }, 404)
  }

  const body = await c.req.json<{
    roleName: string
    displayName: string
    systemPrompt: string
    color?: string
  }>()

  if (!body.roleName?.trim() || !body.displayName?.trim() || !body.systemPrompt?.trim()) {
    return c.json({ error: "roleName, displayName, and systemPrompt are required" }, 400)
  }

  const [member] = await db.insert(teamMembers).values({
    teamId,
    roleName: body.roleName.trim(),
    displayName: body.displayName.trim(),
    systemPrompt: body.systemPrompt.trim(),
    color: body.color ?? "bg-zinc-500",
  }).returning()
  if (!member) return c.json({ error: "Failed to add member" }, 500)

  return c.json({ member }, 201)
})

// DELETE /api/teams/:id/members/:memberId — remove a member
teamMembersRouter.delete("/:id/members/:memberId", async (c) => {
  const session = getSession(c)
  const teamId = c.req.param("id")
  const memberId = c.req.param("memberId")

  // Validate ownership: team → project → user
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    with: { project: { columns: { userId: true } } },
  })
  if (!team || team.project.userId !== session.userId) {
    return c.json({ error: "Not found" }, 404)
  }

  const [deleted] = await db.delete(teamMembers)
    .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
    .returning()
  if (!deleted) return c.json({ error: "Not found" }, 404)

  return c.json({ ok: true })
})

export { projectTeamsRouter, teamMembersRouter }
