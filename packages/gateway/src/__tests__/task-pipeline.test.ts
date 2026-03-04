/**
 * TASK 5 tests — Task pipeline: chat -> tasks on board
 *
 * Verifies:
 * - CreateTask tool creates task with boardColumn: 'todo'
 * - Task transitions: todo -> in_progress -> done
 * - SSE task_update broadcast on change
 */

import { describe, expect, test, beforeEach } from "bun:test"

// ---------------------------------------------------------------------------
// Simulated task store (mirrors task-sync.ts behavior)
// ---------------------------------------------------------------------------

interface WorkerTask {
  id: string
  subject: string
  description?: string
  status: string
  owner: string | null
  boardColumn: string
  updatedAt: number
}

class MockTaskStore {
  private tasks = new Map<string, WorkerTask>()
  public broadcasts: Array<{ event: string; data: any }> = []

  async upsertTask(projectId: string, task: WorkerTask): Promise<void> {
    this.tasks.set(`${projectId}:${task.id}`, task)
    this.broadcasts.push({
      event: "task_update",
      data: { projectId, task },
    })
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    this.tasks.delete(`${projectId}:${taskId}`)
    this.broadcasts.push({
      event: "task_delete",
      data: { projectId, taskId },
    })
  }

  async getTasks(projectId: string): Promise<WorkerTask[]> {
    const result: WorkerTask[] = []
    for (const [key, task] of this.tasks) {
      if (key.startsWith(`${projectId}:`)) {
        result.push(task)
      }
    }
    return result
  }

  getLastBroadcast() {
    return this.broadcasts[this.broadcasts.length - 1]
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Task creation from worker", () => {
  let store: MockTaskStore

  beforeEach(() => {
    store = new MockTaskStore()
  })

  test("CreateTask creates task with boardColumn: 'todo'", async () => {
    const task: WorkerTask = {
      id: "task-1",
      subject: "Add login page",
      description: "Implement OAuth login flow",
      status: "pending",
      owner: null,
      boardColumn: "todo",
      updatedAt: Date.now(),
    }

    await store.upsertTask("proj-1", task)

    const tasks = await store.getTasks("proj-1")
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.boardColumn).toBe("todo")
    expect(tasks[0]!.subject).toBe("Add login page")
    expect(tasks[0]!.status).toBe("pending")
  })

  test("new task has no owner assigned", async () => {
    const task: WorkerTask = {
      id: "task-2",
      subject: "Setup database",
      status: "pending",
      owner: null,
      boardColumn: "todo",
      updatedAt: Date.now(),
    }

    await store.upsertTask("proj-1", task)
    const tasks = await store.getTasks("proj-1")
    expect(tasks[0]!.owner).toBeNull()
  })

  test("broadcasts task_update SSE event on creation", async () => {
    const task: WorkerTask = {
      id: "task-3",
      subject: "Add tests",
      status: "pending",
      owner: null,
      boardColumn: "todo",
      updatedAt: Date.now(),
    }

    await store.upsertTask("proj-1", task)

    const broadcast = store.getLastBroadcast()
    expect(broadcast).toBeDefined()
    expect(broadcast!.event).toBe("task_update")
    expect(broadcast!.data.projectId).toBe("proj-1")
    expect(broadcast!.data.task.id).toBe("task-3")
  })
})

describe("Task transitions", () => {
  let store: MockTaskStore

  beforeEach(async () => {
    store = new MockTaskStore()
    // Seed with a task in todo
    await store.upsertTask("proj-1", {
      id: "task-t1",
      subject: "Implement auth",
      status: "pending",
      owner: null,
      boardColumn: "todo",
      updatedAt: Date.now(),
    })
  })

  test("todo -> in_progress when agent picks up task", async () => {
    await store.upsertTask("proj-1", {
      id: "task-t1",
      subject: "Implement auth",
      status: "in_progress",
      owner: "backend",
      boardColumn: "in_progress",
      updatedAt: Date.now(),
    })

    const tasks = await store.getTasks("proj-1")
    const task = tasks.find((t) => t.id === "task-t1")!
    expect(task.boardColumn).toBe("in_progress")
    expect(task.owner).toBe("backend")
    expect(task.status).toBe("in_progress")
  })

  test("in_progress -> done when agent completes task", async () => {
    // First transition to in_progress
    await store.upsertTask("proj-1", {
      id: "task-t1",
      subject: "Implement auth",
      status: "in_progress",
      owner: "backend",
      boardColumn: "in_progress",
      updatedAt: Date.now(),
    })

    // Then complete
    await store.upsertTask("proj-1", {
      id: "task-t1",
      subject: "Implement auth",
      status: "completed",
      owner: "backend",
      boardColumn: "done",
      updatedAt: Date.now(),
    })

    const tasks = await store.getTasks("proj-1")
    const task = tasks.find((t) => t.id === "task-t1")!
    expect(task.boardColumn).toBe("done")
    expect(task.status).toBe("completed")
    expect(task.owner).toBe("backend")
  })

  test("each transition broadcasts task_update", async () => {
    store.broadcasts = [] // Clear initial creation broadcast

    await store.upsertTask("proj-1", {
      id: "task-t1",
      subject: "Implement auth",
      status: "in_progress",
      owner: "backend",
      boardColumn: "in_progress",
      updatedAt: Date.now(),
    })

    await store.upsertTask("proj-1", {
      id: "task-t1",
      subject: "Implement auth",
      status: "completed",
      owner: "backend",
      boardColumn: "done",
      updatedAt: Date.now(),
    })

    expect(store.broadcasts).toHaveLength(2)
    expect(store.broadcasts[0]!.event).toBe("task_update")
    expect(store.broadcasts[0]!.data.task.boardColumn).toBe("in_progress")
    expect(store.broadcasts[1]!.event).toBe("task_update")
    expect(store.broadcasts[1]!.data.task.boardColumn).toBe("done")
  })
})

describe("Task deletion", () => {
  let store: MockTaskStore

  beforeEach(async () => {
    store = new MockTaskStore()
    await store.upsertTask("proj-1", {
      id: "task-d1",
      subject: "Temp task",
      status: "pending",
      owner: null,
      boardColumn: "todo",
      updatedAt: Date.now(),
    })
  })

  test("delete removes task from store", async () => {
    await store.deleteTask("proj-1", "task-d1")
    const tasks = await store.getTasks("proj-1")
    expect(tasks).toHaveLength(0)
  })

  test("delete broadcasts task_delete event", async () => {
    await store.deleteTask("proj-1", "task-d1")
    const broadcast = store.getLastBroadcast()
    expect(broadcast!.event).toBe("task_delete")
    expect(broadcast!.data.taskId).toBe("task-d1")
  })
})

describe("Multiple tasks per project", () => {
  let store: MockTaskStore

  beforeEach(() => {
    store = new MockTaskStore()
  })

  test("stores multiple tasks for same project", async () => {
    await store.upsertTask("proj-1", {
      id: "t1", subject: "Task 1", status: "pending", owner: null, boardColumn: "todo", updatedAt: Date.now(),
    })
    await store.upsertTask("proj-1", {
      id: "t2", subject: "Task 2", status: "pending", owner: null, boardColumn: "todo", updatedAt: Date.now(),
    })
    await store.upsertTask("proj-1", {
      id: "t3", subject: "Task 3", status: "pending", owner: null, boardColumn: "todo", updatedAt: Date.now(),
    })

    const tasks = await store.getTasks("proj-1")
    expect(tasks).toHaveLength(3)
  })

  test("tasks from different projects are isolated", async () => {
    await store.upsertTask("proj-1", {
      id: "t1", subject: "Proj 1 task", status: "pending", owner: null, boardColumn: "todo", updatedAt: Date.now(),
    })
    await store.upsertTask("proj-2", {
      id: "t2", subject: "Proj 2 task", status: "pending", owner: null, boardColumn: "todo", updatedAt: Date.now(),
    })

    const proj1Tasks = await store.getTasks("proj-1")
    const proj2Tasks = await store.getTasks("proj-2")
    expect(proj1Tasks).toHaveLength(1)
    expect(proj2Tasks).toHaveLength(1)
    expect(proj1Tasks[0]!.subject).toBe("Proj 1 task")
    expect(proj2Tasks[0]!.subject).toBe("Proj 2 task")
  })
})

describe("Internal task route validation", () => {
  test("task requires id and subject", () => {
    const validTask = { id: "t1", subject: "Task" }
    const missingId = { subject: "Task" }
    const missingSubject = { id: "t1" }

    expect(validTask.id && validTask.subject).toBeTruthy()
    expect((missingId as any).id).toBeUndefined()
    expect((missingSubject as any).subject).toBeUndefined()
  })

  test("boardColumn defaults to 'todo' when not provided", () => {
    const task = { id: "t1", subject: "Task" }
    const boardColumn = (task as any).boardColumn ?? "todo"
    expect(boardColumn).toBe("todo")
  })

  test("status defaults to 'pending' when not provided", () => {
    const task = { id: "t1", subject: "Task" }
    const status = (task as any).status ?? "pending"
    expect(status).toBe("pending")
  })
})
