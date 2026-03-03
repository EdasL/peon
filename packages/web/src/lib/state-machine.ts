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

