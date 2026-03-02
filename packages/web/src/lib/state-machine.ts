import type { ClaudeTask, BoardColumn, BoardTask } from "../../server/types"

export const COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "qa", label: "QA" },
  { id: "done", label: "Done" },
]

/**
 * Derive which board column a task belongs in based on its
 * status and owner fields, optionally overridden by a stored columnMap.
 */
export function deriveColumn(
  task: ClaudeTask,
  columnMap: Record<string, BoardColumn>
): BoardColumn {
  // If we have an explicit column override, use it
  if (columnMap[task.id]) return columnMap[task.id]

  const { status, owner } = task

  if (status === "completed") return "done"

  // QA: owner is "qa" regardless of status
  if (owner?.toLowerCase() === "qa") return "qa"

  if (status === "in_progress") return "in_progress"

  // status === "pending"
  if (owner) return "todo"
  return "backlog"
}

/**
 * Convert raw tasks to board tasks with column assignment.
 */
export function toBoardTasks(
  tasks: ClaudeTask[],
  columnMap: Record<string, BoardColumn>
): BoardTask[] {
  return tasks
    .filter((task) => !task.metadata?._internal)
    .map((task) => ({
      ...task,
      boardColumn: deriveColumn(task, columnMap),
      tag: (task.metadata?.tag as string) ?? undefined,
    }))
}

export interface Transition {
  taskId: string
  column: BoardColumn
  updates: Partial<Pick<ClaudeTask, "status" | "owner">>
}

/**
 * Detect auto-advance transitions by comparing previous and current task states.
 *
 * - Coding agent completes (in_progress -> completed, owner != qa)
 *   -> move to QA, rewrite owner=qa, status=pending
 * - QA agent completes (qa column, status=completed)
 *   -> move to Done
 * - Agent starts (todo, status -> in_progress)
 *   -> move to In Progress
 */
export function detectTransitions(
  prev: BoardTask[],
  current: ClaudeTask[],
  columnMap: Record<string, BoardColumn>
): Transition[] {
  const transitions: Transition[] = []
  const prevMap = new Map(prev.map((t) => [t.id, t]))

  for (const task of current) {
    const prevTask = prevMap.get(task.id)
    if (!prevTask) continue

    // Coding agent completes: was in_progress, now completed, owner != qa
    if (
      prevTask.boardColumn === "in_progress" &&
      task.status === "completed" &&
      task.owner?.toLowerCase() !== "qa"
    ) {
      transitions.push({
        taskId: task.id,
        column: "qa",
        updates: { owner: "qa", status: "pending" },
      })
      continue
    }

    // QA agent completes: was in qa, now completed
    if (prevTask.boardColumn === "qa" && task.status === "completed") {
      transitions.push({
        taskId: task.id,
        column: "done",
        updates: {},
      })
      continue
    }

    // Agent starts working: was in todo, now in_progress
    if (prevTask.boardColumn === "todo" && task.status === "in_progress") {
      transitions.push({
        taskId: task.id,
        column: "in_progress",
        updates: {},
      })
      continue
    }
  }

  return transitions
}
