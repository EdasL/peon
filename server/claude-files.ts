import { readdir, readFile, writeFile, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import type { ClaudeTask, ClaudeTeamConfig } from "./types.js"

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
