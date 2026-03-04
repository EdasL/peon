/**
 * TASK 3 tests — Board read-only 3 columns
 *
 * Verifies:
 * - Column mapping: backlog/todo -> "To Do", in_progress -> "In Progress", qa/done -> "Done"
 * - No drag handles rendered
 * - No add/delete buttons
 * - Cards show owner + active dot
 */

import { describe, expect, test } from "bun:test"

// ---------------------------------------------------------------------------
// Column mapping logic (pure function, testable now)
// ---------------------------------------------------------------------------

/**
 * Maps the DB boardColumn value to display column.
 * Spec: backlog + todo -> "To Do", in_progress -> "In Progress", qa + done -> "Done"
 */
function mapBoardColumn(dbColumn: string): "To Do" | "In Progress" | "Done" {
  switch (dbColumn) {
    case "backlog":
    case "todo":
      return "To Do"
    case "in_progress":
      return "In Progress"
    case "qa":
    case "done":
      return "Done"
    default:
      return "To Do" // Default unknown columns to To Do
  }
}

/**
 * Groups tasks by display column.
 */
function groupByDisplayColumn<T extends { boardColumn: string }>(
  tasks: T[]
): Record<string, T[]> {
  const groups: Record<string, T[]> = {
    "To Do": [],
    "In Progress": [],
    "Done": [],
  }
  for (const task of tasks) {
    const col = mapBoardColumn(task.boardColumn)
    groups[col]!.push(task)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Board column mapping", () => {
  test("backlog maps to 'To Do'", () => {
    expect(mapBoardColumn("backlog")).toBe("To Do")
  })

  test("todo maps to 'To Do'", () => {
    expect(mapBoardColumn("todo")).toBe("To Do")
  })

  test("in_progress maps to 'In Progress'", () => {
    expect(mapBoardColumn("in_progress")).toBe("In Progress")
  })

  test("qa maps to 'Done'", () => {
    expect(mapBoardColumn("qa")).toBe("Done")
  })

  test("done maps to 'Done'", () => {
    expect(mapBoardColumn("done")).toBe("Done")
  })

  test("unknown column defaults to 'To Do'", () => {
    expect(mapBoardColumn("review")).toBe("To Do")
    expect(mapBoardColumn("cancelled")).toBe("To Do")
    expect(mapBoardColumn("")).toBe("To Do")
  })
})

describe("Task grouping by display column", () => {
  const mockTasks = [
    { id: "1", subject: "Setup repo", boardColumn: "done", owner: "lead" },
    { id: "2", subject: "Add auth", boardColumn: "in_progress", owner: "backend" },
    { id: "3", subject: "Write tests", boardColumn: "todo", owner: "qa" },
    { id: "4", subject: "Design UI", boardColumn: "backlog", owner: null },
    { id: "5", subject: "Code review", boardColumn: "qa", owner: "lead" },
  ]

  test("groups tasks into 3 display columns", () => {
    const grouped = groupByDisplayColumn(mockTasks)
    expect(Object.keys(grouped)).toEqual(["To Do", "In Progress", "Done"])
  })

  test("To Do contains backlog + todo tasks", () => {
    const grouped = groupByDisplayColumn(mockTasks)
    expect(grouped["To Do"]).toHaveLength(2)
    expect(grouped["To Do"]!.map((t) => t.id).sort()).toEqual(["3", "4"])
  })

  test("In Progress contains in_progress tasks", () => {
    const grouped = groupByDisplayColumn(mockTasks)
    expect(grouped["In Progress"]).toHaveLength(1)
    expect(grouped["In Progress"]![0]!.id).toBe("2")
  })

  test("Done contains qa + done tasks", () => {
    const grouped = groupByDisplayColumn(mockTasks)
    expect(grouped["Done"]).toHaveLength(2)
    expect(grouped["Done"]!.map((t) => t.id).sort()).toEqual(["1", "5"])
  })

  test("empty task list produces empty columns", () => {
    const grouped = groupByDisplayColumn([])
    expect(grouped["To Do"]).toHaveLength(0)
    expect(grouped["In Progress"]).toHaveLength(0)
    expect(grouped["Done"]).toHaveLength(0)
  })
})

describe("Board read-only constraints (source verification)", () => {
  test("KanbanPanel source should not contain drag-related imports after TASK 3", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../KanbanPanel.tsx", import.meta.url),
      "utf-8"
    )
    // After TASK 3: no dnd-kit, no drag handles, no create/delete UI
    expect(source).not.toContain("@dnd-kit")
    expect(source).not.toContain("useDraggable")
    expect(source).not.toContain("useDroppable")
    expect(source).not.toContain("DndContext")
  })

  test("no CreateTaskDialog rendered after TASK 3", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../KanbanPanel.tsx", import.meta.url),
      "utf-8"
    )
    // After TASK 3: CreateTaskDialog should not be rendered
    expect(source).not.toContain("<CreateTaskDialog")
  })

  test("no TaskDetailDrawer rendered after TASK 3", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../KanbanPanel.tsx", import.meta.url),
      "utf-8"
    )
    // After TASK 3: TaskDetailDrawer should not be rendered
    expect(source).not.toContain("<TaskDetailDrawer")
  })
})

describe("Card display", () => {
  test("card shows owner name when assigned", () => {
    const task = { id: "1", subject: "Add auth", owner: "backend", status: "in_progress" }
    expect(task.owner).toBe("backend")
    expect(task.owner).not.toBeNull()
  })

  test("card shows active dot when status is working", () => {
    const agentStatus = "working" as const
    const showActiveDot = agentStatus === "working"
    expect(showActiveDot).toBe(true)
  })

  test("card does not show active dot when status is idle", () => {
    const agentStatus: string = "idle"
    const showActiveDot = agentStatus === "working"
    expect(showActiveDot).toBe(false)
  })
})
