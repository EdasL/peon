import type { Request, Response, NextFunction } from "@tinyhttp/app"
import {
  listTeams,
  readTeamConfig,
  readTeamTasks,
  createTask,
  updateTask,
  deleteTask,
  createTeam,
  deleteTeam,
  spawnAgent,
} from "./claude-files.js"

type Handler = (req: Request, res: Response, next?: NextFunction) => void

// GET /api/teams — list all teams with their configs
export const getTeams: Handler = async (_req, res) => {
  try {
    const names = await listTeams()
    const teams = await Promise.all(
      names.map(async (teamName) => {
        const config = await readTeamConfig(teamName)
        return config ?? { name: teamName }
      })
    )
    res.json(teams)
  } catch (err) {
    res.status(500).json({ error: "Failed to list teams" })
  }
}

// GET /api/teams/:name/config — read team config
export const getTeamConfig: Handler = async (req, res) => {
  const { name } = req.params
  const config = await readTeamConfig(name)
  if (!config) {
    res.status(404).json({ error: `Team "${name}" not found` })
    return
  }
  res.json(config)
}

// GET /api/teams/:name/tasks — read all tasks for a team
export const getTeamTasks: Handler = async (req, res) => {
  const { name } = req.params
  const tasks = await readTeamTasks(name)
  res.json(tasks)
}

// POST /api/teams/:name/tasks — create a new task
export const postTeamTask: Handler = async (req, res) => {
  const { name } = req.params
  const body = req.body
  if (!body || !body.subject) {
    res.status(400).json({ error: "subject is required" })
    return
  }
  try {
    const task = await createTask(name, body)
    res.status(201).json(task)
  } catch (err) {
    res.status(500).json({ error: "Failed to create task" })
  }
}

// PATCH /api/teams/:name/tasks/:id — update a task
export const patchTeamTask: Handler = async (req, res) => {
  const { name, id } = req.params
  const body = req.body
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Request body required" })
    return
  }
  const updated = await updateTask(name, id, body)
  if (!updated) {
    res.status(404).json({ error: `Task "${id}" not found in team "${name}"` })
    return
  }
  res.json(updated)
}

// DELETE /api/teams/:name/tasks/:id — delete a task
export const deleteTeamTask: Handler = async (req, res) => {
  const { name, id } = req.params
  const deleted = await deleteTask(name, id)
  if (!deleted) {
    res.status(404).json({ error: `Task "${id}" not found in team "${name}"` })
    return
  }
  res.json({ ok: true })
}

// POST /api/teams — create a new team
export const postTeam: Handler = async (req, res) => {
  const body = req.body
  if (!body || !body.name || !body.cwd || !Array.isArray(body.agents)) {
    res
      .status(400)
      .json({ error: "name, cwd, and agents[] are required" })
    return
  }
  try {
    const config = await createTeam(body)
    res.status(201).json(config)
  } catch (err) {
    res.status(500).json({ error: "Failed to create team" })
  }
}

// DELETE /api/teams/:name — delete a team
export const deleteTeamRoute: Handler = async (req, res) => {
  const { name } = req.params
  const ok = await deleteTeam(name)
  if (!ok) {
    res.status(500).json({ error: `Failed to delete team "${name}"` })
    return
  }
  res.json({ ok: true })
}

// POST /api/teams/:name/agents/:agent/restart — restart a specific agent
export const restartAgent: Handler = async (req, res) => {
  const { name, agent } = req.params
  const config = await readTeamConfig(name)
  if (!config) {
    res.status(404).json({ error: `Team "${name}" not found` })
    return
  }
  const member = config.members.find((m) => m.name === agent)
  if (!member) {
    res.status(404).json({ error: `Agent "${agent}" not found in team "${name}"` })
    return
  }
  spawnAgent(name, member.name, member.model, member.cwd)
  res.json({ ok: true })
}
