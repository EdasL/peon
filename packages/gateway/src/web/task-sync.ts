import { db } from "../db/connection.js"
import { tasks, type Task } from "../db/schema.js"
import { eq, and } from "drizzle-orm"
import { broadcastToProject } from "./chat-routes.js"

export interface WorkerTask {
  id: string
  subject: string
  description: string
  status: "pending" | "in_progress" | "completed"
  owner: string | null
  boardColumn: string
  metadata?: Record<string, unknown>
  updatedAt: number
  blocks?: string[]
  blockedBy?: string[]
}

export async function handleWorkerTaskUpdate(projectId: string, task: WorkerTask) {
  const boardColumn = task.boardColumn as Task["boardColumn"]
  await db.insert(tasks).values({
    id: task.id,
    projectId,
    subject: task.subject,
    description: task.description,
    status: task.status,
    owner: task.owner,
    boardColumn,
    metadata: task.metadata ?? null,
  }).onConflictDoUpdate({
    target: tasks.id,
    set: {
      subject: task.subject,
      description: task.description,
      status: task.status,
      owner: task.owner,
      boardColumn,
      metadata: task.metadata ?? null,
      updatedAt: new Date(),
    },
  })

  broadcastToProject(projectId, "task_update", task)
}

export async function getProjectTasks(projectId: string): Promise<WorkerTask[]> {
  const rows = await db.query.tasks.findMany({
    where: eq(tasks.projectId, projectId),
  })
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    description: r.description,
    status: r.status,
    owner: r.owner,
    boardColumn: r.boardColumn,
    metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    updatedAt: r.updatedAt.getTime(),
    blocks: [],     // Not yet tracked in DB — placeholder for type alignment
    blockedBy: [],  // Not yet tracked in DB — placeholder for type alignment
  }))
}

export async function deleteProjectTask(projectId: string, taskId: string) {
  await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
  broadcastToProject(projectId, "task_delete", { id: taskId })
}

export async function clearProjectTasks(projectId: string) {
  await db.delete(tasks).where(eq(tasks.projectId, projectId))
}
