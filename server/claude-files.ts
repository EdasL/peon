import { readdir, readFile, writeFile, unlink, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { exec } from "node:child_process"
import type { ClaudeTask, ClaudeTeamConfig, ClaudeTeamMember } from "./types.js"

const CLAUDE_DIR = join(homedir(), ".claude")
const TEAMS_DIR = join(CLAUDE_DIR, "teams")
const TASKS_DIR = join(CLAUDE_DIR, "tasks")

// List all team directory names
export async function listTeams(): Promise<string[]> {
  const entries = await readdir(TEAMS_DIR, { withFileTypes: true })
  const teams: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // Only include dirs that have a config.json
    try {
      await readFile(join(TEAMS_DIR, entry.name, "config.json"), "utf-8")
      teams.push(entry.name)
    } catch {
      // skip dirs without config.json
    }
  }
  return teams
}

// Read a team's config.json
export async function readTeamConfig(
  name: string
): Promise<ClaudeTeamConfig | null> {
  try {
    const raw = await readFile(join(TEAMS_DIR, name, "config.json"), "utf-8")
    return JSON.parse(raw) as ClaudeTeamConfig
  } catch {
    return null
  }
}

// Read all tasks for a team
export async function readTeamTasks(name: string): Promise<ClaudeTask[]> {
  const dir = join(TASKS_DIR, name)
  let entries: string[]
  try {
    entries = await readdir(dir).then((files) =>
      files.filter((f) => f.endsWith(".json"))
    )
  } catch {
    return []
  }

  const tasks: ClaudeTask[] = []
  for (const file of entries) {
    try {
      const raw = await readFile(join(dir, file), "utf-8")
      const task = JSON.parse(raw) as ClaudeTask
      tasks.push(task)
    } catch {
      // skip invalid files
    }
  }

  // Sort by numeric id
  tasks.sort((a, b) => Number(a.id) - Number(b.id))
  return tasks
}

// Create a new task file
export async function createTask(
  teamName: string,
  task: Omit<ClaudeTask, "id">
): Promise<ClaudeTask> {
  const dir = join(TASKS_DIR, teamName)
  await mkdir(dir, { recursive: true })

  // Find next available id
  const existing = await readTeamTasks(teamName)
  const maxId = existing.reduce((max, t) => Math.max(max, Number(t.id)), 0)
  const newId = String(maxId + 1)

  const newTask: ClaudeTask = {
    id: newId,
    subject: task.subject,
    description: task.description,
    activeForm: task.activeForm,
    owner: task.owner,
    status: task.status ?? "pending",
    blocks: task.blocks ?? [],
    blockedBy: task.blockedBy ?? [],
    metadata: task.metadata,
  }

  await writeFile(join(dir, `${newId}.json`), JSON.stringify(newTask, null, 2))
  return newTask
}

// Update an existing task file (partial update)
export async function updateTask(
  teamName: string,
  taskId: string,
  updates: Partial<ClaudeTask>
): Promise<ClaudeTask | null> {
  const filePath = join(TASKS_DIR, teamName, `${taskId}.json`)
  let existing: ClaudeTask
  try {
    const raw = await readFile(filePath, "utf-8")
    existing = JSON.parse(raw) as ClaudeTask
  } catch {
    return null
  }

  const updated: ClaudeTask = { ...existing, ...updates, id: taskId }
  await writeFile(filePath, JSON.stringify(updated, null, 2))
  return updated
}

// Delete a task file
export async function deleteTask(
  teamName: string,
  taskId: string
): Promise<boolean> {
  try {
    await unlink(join(TASKS_DIR, teamName, `${taskId}.json`))
    return true
  } catch {
    return false
  }
}

// --- Team creation / deletion / agent spawning ---

export interface CreateTeamInput {
  name: string
  description: string
  cwd: string
  agents: Array<{
    name: string
    agentType: string
    model: string
    color?: string
    prompt?: string
  }>
}

// Create a new team: config, inboxes, task dir, spawn agents
export async function createTeam(input: CreateTeamInput): Promise<ClaudeTeamConfig> {
  const now = Date.now()
  const teamDir = join(TEAMS_DIR, input.name)
  const inboxDir = join(teamDir, "inboxes")
  const taskDir = join(TASKS_DIR, input.name)

  // Create directories
  await mkdir(inboxDir, { recursive: true })
  await mkdir(taskDir, { recursive: true })

  // Build members array: team-lead + agents
  const members: ClaudeTeamMember[] = [
    {
      agentId: `team-lead@${input.name}`,
      name: "team-lead",
      agentType: "lead",
      model: "claude-opus-4-6",
      joinedAt: now,
      tmuxPaneId: "",
      cwd: input.cwd,
      subscriptions: [],
    },
    ...input.agents.map((agent) => ({
      agentId: `${agent.name}@${input.name}`,
      name: agent.name,
      agentType: agent.agentType,
      model: agent.model,
      color: agent.color,
      prompt: agent.prompt,
      planModeRequired: false,
      joinedAt: now,
      tmuxPaneId: "in-process",
      cwd: input.cwd,
      subscriptions: [],
      backendType: "in-process" as const,
    })),
  ]

  const config: ClaudeTeamConfig = {
    name: input.name,
    description: input.description,
    createdAt: now,
    leadAgentId: `team-lead@${input.name}`,
    leadSessionId: "",
    members,
  }

  // Write config.json
  await writeFile(join(teamDir, "config.json"), JSON.stringify(config, null, 2))

  // Create inbox files for each member
  for (const member of members) {
    await writeFile(join(inboxDir, `${member.name}.json`), "[]")
  }

  // Spawn agents (fire and forget)
  for (const agent of input.agents) {
    spawnAgent(input.name, agent.name, agent.model, input.cwd)
  }

  return config
}

// Delete a team and its task directory
export async function deleteTeam(name: string): Promise<boolean> {
  const teamDir = join(TEAMS_DIR, name)
  const taskDir = join(TASKS_DIR, name)

  try {
    await rm(teamDir, { recursive: true, force: true })
    await rm(taskDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// Spawn a single Claude Code agent (fire and forget)
export function spawnAgent(
  teamName: string,
  agentName: string,
  model: string,
  cwd: string
): void {
  const cmd = `claude --team ${teamName} --agent-name ${agentName} --model ${model} --cwd ${cwd} &`
  exec(cmd, { cwd }, (error) => {
    if (error) {
      console.error(`Failed to spawn agent ${agentName}@${teamName}:`, error.message)
    }
  })
}
