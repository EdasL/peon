import { broadcastToProject } from "./chat-routes.js"

// Task state cache per project (populated from worker events)
const projectTasks = new Map<string, Map<string, WorkerTask>>()

interface WorkerTask {
  id: string
  subject: string
  description: string
  status: "pending" | "in_progress" | "completed"
  owner: string | null
  boardColumn: string
  updatedAt: number
}

export function handleWorkerTaskUpdate(projectId: string, task: WorkerTask) {
  if (!projectTasks.has(projectId)) projectTasks.set(projectId, new Map())
  projectTasks.get(projectId)!.set(task.id, task)

  // Broadcast to all SSE clients watching this project
  broadcastToProject(projectId, "task_update", task)
}

export function getProjectTasks(projectId: string): WorkerTask[] {
  const tasks = projectTasks.get(projectId)
  if (!tasks) return []
  return Array.from(tasks.values())
}

export function clearProjectTasks(projectId: string) {
  projectTasks.delete(projectId)
}
