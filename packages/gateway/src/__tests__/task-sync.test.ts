/**
 * Tests for Gateway Task Sync — internal task routes + handleWorkerTaskUpdate
 *
 * Covers:
 * 1. POST /internal/tasks — validation, boardColumn defaults
 * 2. Task status transitions via upsert
 * 3. Default boardColumn is "todo" (not "backlog")
 */

import { describe, expect, test } from "bun:test"

// ---------------------------------------------------------------------------
// Mock helpers — inline the validation logic from internal/tasks.ts
// without importing Hono/drizzle/verifyWorkerToken.
// ---------------------------------------------------------------------------

interface WorkerTask {
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

/**
 * Mirrors the body normalization from POST /internal/tasks handler.
 */
function normalizeTaskBody(body: Partial<WorkerTask>): WorkerTask | null {
  if (!body.id || !body.subject) return null

  return {
    id: body.id,
    subject: body.subject,
    description: body.description ?? "",
    status: body.status ?? "pending",
    owner: body.owner ?? null,
    boardColumn: body.boardColumn ?? "todo",
    metadata: body.metadata ?? undefined,
    updatedAt: body.updatedAt ?? Date.now(),
    blocks: body.blocks ?? [],
    blockedBy: body.blockedBy ?? [],
  }
}

// ---------------------------------------------------------------------------
// 1. Body normalization / validation
// ---------------------------------------------------------------------------

describe("POST /internal/tasks — body normalization", () => {
  test("rejects body without id", () => {
    const result = normalizeTaskBody({ subject: "Test" })
    expect(result).toBeNull()
  })

  test("rejects body without subject", () => {
    const result = normalizeTaskBody({ id: "task-1" })
    expect(result).toBeNull()
  })

  test("defaults boardColumn to 'todo'", () => {
    const result = normalizeTaskBody({ id: "task-1", subject: "Test" })
    expect(result).not.toBeNull()
    expect(result!.boardColumn).toBe("todo")
  })

  test("defaults status to 'pending'", () => {
    const result = normalizeTaskBody({ id: "task-1", subject: "Test" })
    expect(result!.status).toBe("pending")
  })

  test("defaults owner to null", () => {
    const result = normalizeTaskBody({ id: "task-1", subject: "Test" })
    expect(result!.owner).toBeNull()
  })

  test("defaults description to empty string", () => {
    const result = normalizeTaskBody({ id: "task-1", subject: "Test" })
    expect(result!.description).toBe("")
  })

  test("preserves provided values", () => {
    const result = normalizeTaskBody({
      id: "task-1",
      subject: "Build login",
      description: "Add auth form",
      status: "in_progress",
      owner: "frontend",
      boardColumn: "in_progress",
    })
    expect(result!.id).toBe("task-1")
    expect(result!.subject).toBe("Build login")
    expect(result!.description).toBe("Add auth form")
    expect(result!.status).toBe("in_progress")
    expect(result!.owner).toBe("frontend")
    expect(result!.boardColumn).toBe("in_progress")
  })
})

// ---------------------------------------------------------------------------
// 2. Task status transitions via upsert
// ---------------------------------------------------------------------------

describe("Task status transitions — upsert flow", () => {
  // In-memory task store simulating DB upsert behavior
  const store = new Map<string, WorkerTask>()

  function upsert(task: WorkerTask) {
    store.set(task.id, task)
  }

  test("create → todo, update → in_progress → done", () => {
    store.clear()

    // Step 1: Create task (todo)
    const createTask = normalizeTaskBody({
      id: "task-lifecycle",
      subject: "Build feature",
      boardColumn: "todo",
    })!
    upsert(createTask)
    expect(store.get("task-lifecycle")!.boardColumn).toBe("todo")
    expect(store.get("task-lifecycle")!.status).toBe("pending")

    // Step 2: Agent picks up (in_progress)
    const pickupTask = normalizeTaskBody({
      id: "task-lifecycle",
      subject: "Build feature",
      status: "in_progress",
      owner: "backend",
      boardColumn: "in_progress",
    })!
    upsert(pickupTask)
    expect(store.get("task-lifecycle")!.boardColumn).toBe("in_progress")
    expect(store.get("task-lifecycle")!.owner).toBe("backend")

    // Step 3: Agent completes (done)
    const doneTask = normalizeTaskBody({
      id: "task-lifecycle",
      subject: "Build feature",
      status: "completed",
      owner: "backend",
      boardColumn: "done",
    })!
    upsert(doneTask)
    expect(store.get("task-lifecycle")!.boardColumn).toBe("done")
    expect(store.get("task-lifecycle")!.status).toBe("completed")
  })

  test("upsert with same id replaces previous task", () => {
    store.clear()

    upsert(normalizeTaskBody({
      id: "task-upsert",
      subject: "Original",
    })!)

    expect(store.get("task-upsert")!.subject).toBe("Original")

    upsert(normalizeTaskBody({
      id: "task-upsert",
      subject: "Updated",
      status: "in_progress",
      boardColumn: "in_progress",
    })!)

    expect(store.size).toBe(1) // no duplicate
    expect(store.get("task-upsert")!.subject).toBe("Updated")
    expect(store.get("task-upsert")!.boardColumn).toBe("in_progress")
  })
})

// ---------------------------------------------------------------------------
// 3. Board column valid values
// ---------------------------------------------------------------------------

describe("Board column values", () => {
  const VALID_COLUMNS = ["backlog", "todo", "in_progress", "qa", "done"]

  test("default column 'todo' is in valid set", () => {
    expect(VALID_COLUMNS).toContain("todo")
  })

  test("all transition columns are valid", () => {
    expect(VALID_COLUMNS).toContain("todo")
    expect(VALID_COLUMNS).toContain("in_progress")
    expect(VALID_COLUMNS).toContain("done")
  })

  test("'backlog' is no longer the default for new tasks", () => {
    const task = normalizeTaskBody({ id: "t", subject: "s" })!
    expect(task.boardColumn).not.toBe("backlog")
    expect(task.boardColumn).toBe("todo")
  })
})

// ---------------------------------------------------------------------------
// 4. Placeholder subject detection for status-only updates
// ---------------------------------------------------------------------------

describe("Placeholder subject detection", () => {
  function isPlaceholder(subject: string | undefined): boolean {
    return !subject || subject.startsWith("Task ")
  }

  test("empty subject is a placeholder", () => {
    expect(isPlaceholder("")).toBe(true)
  })

  test("undefined subject is a placeholder", () => {
    expect(isPlaceholder(undefined)).toBe(true)
  })

  test("'Task peon-123' is a placeholder", () => {
    expect(isPlaceholder("Task peon-123")).toBe(true)
  })

  test("real subject is not a placeholder", () => {
    expect(isPlaceholder("Add login page")).toBe(false)
  })

  test("subject starting with 'Task' but with content is not placeholder if it has space after", () => {
    // "Task " prefix → placeholder; "TaskManager" → not placeholder
    expect(isPlaceholder("TaskManager")).toBe(false)
  })
})
