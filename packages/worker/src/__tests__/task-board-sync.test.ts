/**
 * Tests for Task Board Sync — CreateProjectTasks tool + task status transitions
 *
 * Covers:
 * 1. createProjectTasks — POST to gateway, board column mapping
 * 2. syncTaskToGateway — Claude Code TaskCreate/TaskUpdate forwarding
 * 3. deriveBoardColumn — status → boardColumn mapping (todo/in_progress/done)
 * 4. normalizeStatus — raw status string normalization
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"

// ---------------------------------------------------------------------------
// Extract pure functions for unit testing
// We re-implement the pure logic from peon-gateway/index.ts to test
// without requiring the full plugin registration / OpenClaw runtime.
// ---------------------------------------------------------------------------

function normalizeStatus(s?: string): "pending" | "in_progress" | "completed" {
  if (s === "in_progress") return "in_progress"
  if (s === "completed") return "completed"
  return "pending"
}

function deriveBoardColumn(status?: string): string {
  if (status === "in_progress") return "in_progress"
  if (status === "completed") return "done"
  return "todo"
}

// ---------------------------------------------------------------------------
// 1. normalizeStatus()
// ---------------------------------------------------------------------------

describe("normalizeStatus()", () => {
  test("in_progress → in_progress", () => {
    expect(normalizeStatus("in_progress")).toBe("in_progress")
  })

  test("completed → completed", () => {
    expect(normalizeStatus("completed")).toBe("completed")
  })

  test("pending → pending", () => {
    expect(normalizeStatus("pending")).toBe("pending")
  })

  test("undefined → pending", () => {
    expect(normalizeStatus(undefined)).toBe("pending")
  })

  test("unknown string → pending", () => {
    expect(normalizeStatus("something_else")).toBe("pending")
  })
})

// ---------------------------------------------------------------------------
// 2. deriveBoardColumn()
// ---------------------------------------------------------------------------

describe("deriveBoardColumn()", () => {
  test("pending → todo (new tasks go to Todo column)", () => {
    expect(deriveBoardColumn("pending")).toBe("todo")
  })

  test("in_progress → in_progress", () => {
    expect(deriveBoardColumn("in_progress")).toBe("in_progress")
  })

  test("completed → done", () => {
    expect(deriveBoardColumn("completed")).toBe("done")
  })

  test("undefined → todo", () => {
    expect(deriveBoardColumn(undefined)).toBe("todo")
  })

  test("unknown status → todo", () => {
    expect(deriveBoardColumn("random")).toBe("todo")
  })
})

// ---------------------------------------------------------------------------
// 3. Task status transitions (todo → in_progress → done)
// ---------------------------------------------------------------------------

describe("Task status transitions", () => {
  test("create → todo column", () => {
    const status = normalizeStatus(undefined)
    const column = deriveBoardColumn(status)
    expect(status).toBe("pending")
    expect(column).toBe("todo")
  })

  test("agent picks up → in_progress column with owner", () => {
    const status = normalizeStatus("in_progress")
    const column = deriveBoardColumn(status)
    expect(status).toBe("in_progress")
    expect(column).toBe("in_progress")
  })

  test("agent completes → done column", () => {
    const status = normalizeStatus("completed")
    const column = deriveBoardColumn(status)
    expect(status).toBe("completed")
    expect(column).toBe("done")
  })

  test("full lifecycle: todo → in_progress → done", () => {
    // Create
    const createColumn = deriveBoardColumn(normalizeStatus(undefined))
    expect(createColumn).toBe("todo")

    // Pick up
    const pickupColumn = deriveBoardColumn(normalizeStatus("in_progress"))
    expect(pickupColumn).toBe("in_progress")

    // Complete
    const doneColumn = deriveBoardColumn(normalizeStatus("completed"))
    expect(doneColumn).toBe("done")
  })
})

// ---------------------------------------------------------------------------
// 4. CreateProjectTasks — mock gateway call
// ---------------------------------------------------------------------------

describe("CreateProjectTasks tool", () => {
  let fetchCalls: Array<{ url: string; options: RequestInit }>
  let originalFetch: typeof global.fetch
  let mockResponses: Map<string, { status: number; body: unknown }>

  beforeEach(() => {
    fetchCalls = []
    mockResponses = new Map()
    originalFetch = global.fetch

    global.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = url.toString()
      fetchCalls.push({ url: urlStr, options: options ?? {} })
      const mock = mockResponses.get(urlStr) ?? { status: 200, body: { ok: true } }
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  // Inline minimal version of createProjectTasks for testing
  async function createProjectTasks(
    gatewayUrl: string,
    workerToken: string,
    params: { projectId: string; tasks: Array<{ subject: string; description?: string; owner?: string }> }
  ) {
    const created: string[] = []
    const errors: string[] = []

    for (const t of params.tasks) {
      const id = `peon-test-${Math.random().toString(36).slice(2, 8)}`
      const body = {
        id,
        subject: t.subject,
        description: t.description ?? "",
        status: "pending",
        owner: t.owner ?? null,
        boardColumn: "todo",
        updatedAt: Date.now(),
      }

      try {
        const res = await fetch(`${gatewayUrl}/internal/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${workerToken}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          created.push(id)
        } else {
          errors.push(`${t.subject}: ${res.statusText}`)
        }
      } catch (err) {
        errors.push(`${t.subject}: ${String(err)}`)
      }
    }

    return { created, errors }
  }

  test("POSTs each task to /internal/tasks", async () => {
    const result = await createProjectTasks(
      "https://gw.test",
      "tok-123",
      {
        projectId: "proj-1",
        tasks: [
          { subject: "Add login page", description: "Build the login form" },
          { subject: "Add auth API", owner: "backend" },
        ],
      }
    )

    expect(result.created).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(fetchCalls).toHaveLength(2)

    // Verify first call
    expect(fetchCalls[0]!.url).toBe("https://gw.test/internal/tasks")
    const body0 = JSON.parse(fetchCalls[0]!.options.body as string)
    expect(body0.subject).toBe("Add login page")
    expect(body0.description).toBe("Build the login form")
    expect(body0.boardColumn).toBe("todo")
    expect(body0.status).toBe("pending")

    // Verify second call
    const body1 = JSON.parse(fetchCalls[1]!.options.body as string)
    expect(body1.subject).toBe("Add auth API")
    expect(body1.owner).toBe("backend")
  })

  test("sends Authorization header with worker token", async () => {
    await createProjectTasks(
      "https://gw.test",
      "my-secret-token",
      { projectId: "proj-1", tasks: [{ subject: "Test task" }] }
    )

    const headers = fetchCalls[0]!.options.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer my-secret-token")
    expect(headers["Content-Type"]).toBe("application/json")
  })

  test("handles gateway errors gracefully", async () => {
    mockResponses.set("https://gw.test/internal/tasks", {
      status: 404,
      body: { error: "No active project found" },
    })

    const result = await createProjectTasks(
      "https://gw.test",
      "tok-123",
      { projectId: "proj-1", tasks: [{ subject: "Will fail" }] }
    )

    expect(result.created).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Will fail")
  })

  test("sets boardColumn to 'todo' for all new tasks", async () => {
    await createProjectTasks(
      "https://gw.test",
      "tok-123",
      {
        projectId: "proj-1",
        tasks: [
          { subject: "Task A" },
          { subject: "Task B" },
          { subject: "Task C" },
        ],
      }
    )

    for (const call of fetchCalls) {
      const body = JSON.parse(call.options.body as string)
      expect(body.boardColumn).toBe("todo")
    }
  })
})

// ---------------------------------------------------------------------------
// 5. syncTaskToGateway — TaskCreate/TaskUpdate forwarding
// ---------------------------------------------------------------------------

describe("syncTaskToGateway logic", () => {
  let fetchCalls: Array<{ url: string; body: Record<string, unknown> }>
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    fetchCalls = []
    originalFetch = global.fetch

    global.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(options.body as string) : {}
      fetchCalls.push({ url: url.toString(), body })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  // Inline the sync logic for testing
  async function syncTaskToGateway(
    gatewayUrl: string,
    workerToken: string,
    toolName: string,
    input: Record<string, unknown>
  ) {
    if (toolName === "TaskList") return

    const taskId = (input.taskId ?? input.id) as string | undefined
    if (!taskId && toolName !== "TaskCreate") return

    const subject = (input.subject ?? "") as string
    if (!subject && toolName === "TaskCreate") return

    const status = normalizeStatus((input.status as string) ?? undefined)
    const boardColumn = deriveBoardColumn((input.status as string) ?? undefined)
    const owner = (input.owner as string | null) ?? null

    const id = taskId ?? `cc-test-${Math.random().toString(36).slice(2, 8)}`

    const body = {
      id,
      subject: subject || `Task ${id}`,
      description: (input.description as string) ?? "",
      status,
      owner,
      boardColumn,
      metadata: (input.metadata as Record<string, unknown>) ?? undefined,
      updatedAt: Date.now(),
      blocks: (input.addBlocks as string[]) ?? [],
      blockedBy: (input.addBlockedBy as string[]) ?? [],
    }

    await fetch(`${gatewayUrl}/internal/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
  }

  test("TaskCreate syncs with boardColumn 'todo'", async () => {
    await syncTaskToGateway("https://gw.test", "tok", "TaskCreate", {
      subject: "New task",
      description: "Details here",
    })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.body.subject).toBe("New task")
    expect(fetchCalls[0]!.body.boardColumn).toBe("todo")
    expect(fetchCalls[0]!.body.status).toBe("pending")
  })

  test("TaskUpdate with in_progress syncs to in_progress column", async () => {
    await syncTaskToGateway("https://gw.test", "tok", "TaskUpdate", {
      taskId: "task-1",
      status: "in_progress",
      owner: "backend",
    })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.body.boardColumn).toBe("in_progress")
    expect(fetchCalls[0]!.body.owner).toBe("backend")
  })

  test("TaskUpdate with completed syncs to done column", async () => {
    await syncTaskToGateway("https://gw.test", "tok", "TaskUpdate", {
      taskId: "task-1",
      status: "completed",
    })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.body.boardColumn).toBe("done")
    expect(fetchCalls[0]!.body.status).toBe("completed")
  })

  test("TaskList is a no-op (read-only)", async () => {
    await syncTaskToGateway("https://gw.test", "tok", "TaskList", {})
    expect(fetchCalls).toHaveLength(0)
  })

  test("TaskCreate without subject is skipped", async () => {
    await syncTaskToGateway("https://gw.test", "tok", "TaskCreate", {
      description: "no subject",
    })
    expect(fetchCalls).toHaveLength(0)
  })

  test("TaskUpdate without taskId is skipped", async () => {
    await syncTaskToGateway("https://gw.test", "tok", "TaskUpdate", {
      status: "completed",
    })
    expect(fetchCalls).toHaveLength(0)
  })
})
