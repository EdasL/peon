/**
 * Internal hook-events route.
 *
 * Worker containers forward Claude Code hook events here (via send_event.py).
 * The gateway maps hook event types to agent status (working/idle/error)
 * and broadcasts an `agent_status` SSE event to project subscribers.
 *
 * Authentication: Bearer worker-token (same as other /internal routes).
 */

import { createLogger, verifyWorkerToken } from "@lobu/core"
import { Hono } from "hono"
import { broadcastToProject } from "../../web/chat-routes.js"
import { getActiveProject } from "../../web/chat-routes.js"
import { handleWorkerTaskUpdate } from "../../web/task-sync.js"
import type { WorkerTask } from "../../web/task-sync.js"
import { db } from "../../db/connection.js"
import { projects, users, activityLog, tasks } from "../../db/schema.js"
import { eq, and, ne, ilike } from "drizzle-orm"

const logger = createLogger("internal-hook-events")

function buildHookToolText(toolName: string, input: Record<string, unknown>): string | undefined {
  const filePath = (input.file_path ?? input.path ?? input.filePath) as string | undefined
  const shortPath = filePath ? filePath.split("/").slice(-2).join("/") : undefined
  switch (toolName.toLowerCase()) {
    case "read":
      return shortPath ? `Reading ${shortPath}` : "Reading file"
    case "edit":
    case "multiedit":
    case "streplace":
      return shortPath ? `Editing ${shortPath}` : "Editing file"
    case "write":
      return shortPath ? `Writing ${shortPath}` : "Writing file"
    case "bash":
    case "exec":
    case "shell": {
      const cmd = (input.command as string | undefined) ?? ""
      return cmd ? `Running ${cmd.slice(0, 100)}` : "Running command"
    }
    case "grep": {
      const pat = (input.pattern as string | undefined) ?? ""
      const inPath = (input.path as string | undefined) ?? ""
      if (pat && inPath) return `Searching '${pat.slice(0, 40)}' in ${inPath.split("/").slice(-2).join("/")}`
      if (pat) return `Searching '${pat.slice(0, 40)}'`
      return "Searching"
    }
    case "glob": {
      const pat = (input.pattern ?? input.glob_pattern) as string | undefined
      return pat ? `Globbing ${pat.slice(0, 60)}` : "Listing files"
    }
    case "webfetch":
    case "websearch": {
      const target = (input.url ?? input.query ?? input.search_term) as string | undefined
      return target ? `Fetching ${String(target).slice(0, 60)}` : "Fetching web"
    }
    case "todowrite":
      return "Updating tasks"
    case "task":
      return "Launching task"
    case "delegatetoproject": {
      const task = (input.task as string | undefined) ?? ""
      return task ? `Setting up project — ${task.slice(0, 60)}` : "Setting up project with Claude Code team"
    }
    case "createprojecttasks": {
      const tasks = input.tasks as unknown[] | undefined
      return tasks?.length ? `Creating ${tasks.length} task${tasks.length > 1 ? "s" : ""} on the board` : "Planning project tasks"
    }
    case "updatetaskstatus": {
      const status = (input.status as string | undefined) ?? ""
      return status ? `Moving task to ${status.replace(/_/g, " ")}` : "Updating task status"
    }
    case "listprojecttasks":
      return "Reviewing project tasks"
    case "deletetask":
      return "Removing task from board"
    case "checkteamstatus":
      return "Checking if team is still working"
    case "getteamresult":
      return "Getting team results"
    case "uploaduserfile": {
      const desc = (input.description as string | undefined) ?? ""
      return desc ? `Sharing file — ${desc.slice(0, 60)}` : shortPath ? `Sharing ${shortPath}` : "Sharing file"
    }
    case "schedulereminder": {
      const reminderTask = (input.task as string | undefined) ?? ""
      return reminderTask ? `Scheduling — ${reminderTask.slice(0, 50)}` : "Scheduling a reminder"
    }
    case "cancelreminder":
      return "Cancelling reminder"
    case "listreminders":
      return "Checking pending reminders"
    case "searchextensions": {
      const q = (input.query as string | undefined) ?? ""
      return q ? `Searching extensions for "${q.slice(0, 40)}"` : "Searching extensions"
    }
    case "installextension": {
      const extId = (input.id as string | undefined) ?? ""
      return extId ? `Installing extension ${extId}` : "Installing extension"
    }
    case "getsettingslink":
    case "getsettingslinkfordomain":
      return "Opening settings"
    case "generateaudio":
      return "Generating audio"
    case "getchannelhistory":
      return "Loading chat history"
    case "askuserquestion": {
      const question = (input.question as string | undefined) ?? ""
      return question ? `Asking — ${question.slice(0, 50)}` : "Asking a question"
    }
    default: {
      if (shortPath) return shortPath
      if (input.command) return String(input.command).slice(0, 80)
      if (input.query) return String(input.query).slice(0, 60)
      return undefined
    }
  }
}

export type AgentStatus = "working" | "idle" | "error"

export interface HookEventPayload {
  eventType: string
  agentId: string
  timestamp: number
  toolName?: string
  toolUseId?: string
  toolInput?: Record<string, unknown>
  notificationType?: string
  error?: string
  projectId?: string
  // TaskCompleted hook fields
  taskId?: string
  taskSubject?: string
  taskDescription?: string
  teammateName?: string
}

export interface AgentStatusEvent {
  type: "agent_status"
  agentId: string
  status: AgentStatus
  toolName?: string
  error?: string
  timestamp: number
}

/**
 * Pure function: map a Claude Code hook event type to an agent status.
 *
 * | Hook event            | Agent status |
 * |-----------------------|-------------|
 * | PreToolUse            | working     |
 * | PostToolUse           | working     |
 * | PostToolUseFailure    | error       |
 * | Notification (idle)   | idle        |
 * | Stop                  | idle        |
 * | SessionEnd            | idle        |
 * | SubagentStart         | working     |
 * | SubagentStop          | idle        |
 */
export function mapHookEventToStatus(
  eventType: string,
  notificationType?: string
): AgentStatus | null {
  switch (eventType) {
    case "PreToolUse":
    case "PostToolUse":
    case "SubagentStart":
      return "working"

    case "PostToolUseFailure":
      return "error"

    case "Stop":
    case "SessionEnd":
    case "SubagentStop":
    case "TeammateIdle":
    case "TaskCompleted":
      return "idle"

    case "Notification":
      // Only idle_prompt notification means idle
      if (notificationType === "idle_prompt") return "idle"
      return null

    default:
      return null
  }
}

// Cache conversationId -> projectId (same pattern as tasks.ts)
const PROJECT_CACHE_MAX = 500
const projectIdCache = new Map<string, { id: string | null; expiresAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of projectIdCache) {
    if (val.expiresAt <= now) projectIdCache.delete(key)
  }
}, 5 * 60_000)

async function resolveProjectId(conversationId: string): Promise<string | null> {
  const active = getActiveProject(conversationId)
  if (active) return active

  const cached = projectIdCache.get(conversationId)
  if (cached && cached.expiresAt > Date.now()) return cached.id

  const user = await db.query.users.findFirst({
    where: eq(users.peonAgentId, conversationId),
    columns: { id: true },
  })
  if (!user) {
    projectIdCache.set(conversationId, { id: null, expiresAt: Date.now() + 60_000 })
    return null
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.userId, user.id),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
    columns: { id: true },
  })
  const id = project?.id ?? null
  if (projectIdCache.size >= PROJECT_CACHE_MAX) {
    const firstKey = projectIdCache.keys().next().value
    if (firstKey) projectIdCache.delete(firstKey)
  }
  projectIdCache.set(conversationId, { id, expiresAt: Date.now() + 60_000 })
  return id
}

export function createHookEventRoutes(): Hono {
  const router = new Hono()

  router.post("/internal/hook-events", async (c) => {
    const authHeader = c.req.header("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing authorization" }, 401)
    }

    const workerToken = authHeader.slice(7)
    const tokenData = verifyWorkerToken(workerToken)
    if (!tokenData) {
      return c.json({ error: "Invalid worker token" }, 401)
    }

    let body: HookEventPayload
    try {
      body = await c.req.json<HookEventPayload>()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }

    if (!body.eventType || !body.agentId) {
      return c.json({ error: "eventType and agentId are required" }, 400)
    }

    // Resolve projectId: prefer explicit from payload, fall back to token lookup
    const projectId = body.projectId || await resolveProjectId(tokenData.conversationId)
    if (!projectId) {
      logger.debug(`hook-events: no project found for conversationId=${tokenData.conversationId}`)
      return c.json({ ok: true })
    }

    // Handle task events: extract task data from tool_input
    const resolvedOwner = body.agentId === "default" ? "lead" : body.agentId
    const isTaskTool = body.toolName === "TaskCreate" || body.toolName === "TaskUpdate"
    if (isTaskTool && body.toolInput) {
      const ti = body.toolInput
      const taskId = (ti.taskId ?? ti.id ?? `cc-${Date.now()}`) as string
      const subject = (ti.subject ?? "") as string
      if (subject) {
        const taskStatus = (ti.status as string) ?? "pending"
        const task: WorkerTask = {
          id: taskId,
          subject,
          description: (ti.description as string) ?? "",
          status: taskStatus === "in_progress" ? "in_progress" : taskStatus === "completed" ? "completed" : "pending",
          owner: (ti.owner as string) ?? resolvedOwner,
          boardColumn: taskStatus === "in_progress" ? "in_progress" : taskStatus === "completed" ? "done" : "todo",
          metadata: (ti.metadata as Record<string, unknown>) ?? undefined,
          updatedAt: body.timestamp || Date.now(),
          blocks: (ti.addBlocks as string[]) ?? [],
          blockedBy: (ti.addBlockedBy as string[]) ?? [],
        }
        await handleWorkerTaskUpdate(projectId, task)
        logger.debug(`hook-events: ${body.toolName} task=${taskId} for project=${projectId}`)
      }
    }

    // Handle TodoWrite — Claude Code's built-in task tool
    if (body.toolName === "TodoWrite" && body.toolInput) {
      const todos = body.toolInput.todos as Array<Record<string, unknown>> | undefined
      if (Array.isArray(todos)) {
        for (const todo of todos) {
          const todoStatus = (todo.status as string) ?? "pending"
          const task: WorkerTask = {
            id: (todo.id as string) ?? `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            subject: (todo.content as string) ?? "Untitled task",
            description: "",
            status: todoStatus === "in_progress" ? "in_progress" : todoStatus === "completed" || todoStatus === "cancelled" ? "completed" : "pending",
            owner: resolvedOwner,
            boardColumn: todoStatus === "in_progress" ? "in_progress" : todoStatus === "completed" || todoStatus === "cancelled" ? "done" : "todo",
            updatedAt: body.timestamp || Date.now(),
            blocks: [],
            blockedBy: [],
          }
          await handleWorkerTaskUpdate(projectId, task)
        }
        logger.debug(`hook-events: TodoWrite ${todos.length} todos for project=${projectId} owner=${resolvedOwner}`)
      }
    }

    // Handle TaskCompleted hook event — try to match an existing board task
    // by subject before falling back to upserting with Claude Code's internal ID.
    if (body.eventType === "TaskCompleted") {
      let matchedTaskId: string | null = null

      if (body.taskSubject) {
        const existing = await db.query.tasks.findFirst({
          where: and(
            eq(tasks.projectId, projectId),
            ilike(tasks.subject, body.taskSubject),
            ne(tasks.status, "completed"),
          ),
          columns: { id: true, subject: true },
        })
        if (existing) matchedTaskId = existing.id
      }

      const taskId = matchedTaskId ?? body.taskId ?? `cc-done-${Date.now()}`
      const task: WorkerTask = {
        id: taskId,
        subject: body.taskSubject ?? `Task ${taskId}`,
        description: body.taskDescription ?? "",
        status: "completed",
        owner: body.teammateName ?? resolvedOwner,
        boardColumn: "done",
        updatedAt: body.timestamp || Date.now(),
        blocks: [],
        blockedBy: [],
      }
      await handleWorkerTaskUpdate(projectId, task)
      logger.debug(`hook-events: TaskCompleted task=${taskId}${matchedTaskId ? " (matched by subject)" : ""} for project=${projectId}`)
    }

    // Auto-complete in-progress tasks when the Claude Code session ends.
    // SubagentStop/TaskCompleted hooks don't fire in --teammate-mode in-process,
    // so SessionEnd (which fires after all teammates finish) is our only signal.
    if (body.eventType === "SessionEnd") {
      const inProgressTasks = await db.query.tasks.findMany({
        where: and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, "in_progress"),
        ),
        columns: { id: true, subject: true, owner: true },
      })
      for (const t of inProgressTasks) {
        const doneTask: WorkerTask = {
          id: t.id,
          subject: t.subject,
          description: "",
          status: "completed",
          owner: t.owner,
          boardColumn: "done",
          updatedAt: Date.now(),
          blocks: [],
          blockedBy: [],
        }
        await handleWorkerTaskUpdate(projectId, doneTask)
      }
      if (inProgressTasks.length > 0) {
        logger.info(`hook-events: SessionEnd auto-completed ${inProgressTasks.length} in_progress tasks for project=${projectId}`)
      }
    }

    // Broadcast agent_activity from hook events (PreToolUse/PostToolUse have full toolInput)
    if (body.eventType === "PreToolUse" && body.toolName) {
      const ti = body.toolInput ?? {}
      const filePath = (ti.file_path ?? ti.path ?? ti.filePath) as string | undefined
      const command = (ti.command ?? ti.cmd) as string | undefined
      const pattern = (ti.pattern ?? ti.query ?? ti.search_term ?? ti.glob_pattern) as string | undefined
      const text = buildHookToolText(body.toolName, ti)
      const agentName = body.agentId === "default" ? "lead" : body.agentId
      const activityPayload = {
        type: "tool_start",
        tool: body.toolName,
        agentName,
        ...(text && { text }),
        ...(filePath && { filePath }),
        ...(command && { command }),
        ...(pattern && { pattern }),
        timestamp: body.timestamp || Date.now(),
      }
      broadcastToProject(projectId, "agent_activity", activityPayload)
    } else if ((body.eventType === "PostToolUse" || body.eventType === "PostToolUseFailure") && body.toolName) {
      const agentName = body.agentId === "default" ? "lead" : body.agentId
      const toolEndPayload = {
        type: "tool_end",
        tool: body.toolName,
        agentName,
        timestamp: body.timestamp || Date.now(),
      }
      broadcastToProject(projectId, "agent_activity", toolEndPayload)
    }

    const status = mapHookEventToStatus(body.eventType, body.notificationType)
    if (!status) {
      // Unknown or irrelevant event type — acknowledge but skip broadcast
      return c.json({ ok: true, status: null })
    }

    const resolvedAgentId = body.agentId === "default" ? "lead" : body.agentId
    const sseEvent: AgentStatusEvent = {
      type: "agent_status",
      agentId: resolvedAgentId,
      status,
      timestamp: body.timestamp || Date.now(),
    }

    if (body.toolName) sseEvent.toolName = body.toolName.slice(0, 100)
    if (body.error && status === "error") sseEvent.error = body.error.slice(0, 500)

    broadcastToProject(projectId, "agent_status", sseEvent)
    logger.debug(`hook-events: ${body.eventType} -> ${status} for agent=${body.agentId} project=${projectId}`)

    // Persist to audit log (parallel write alongside SSE broadcast)
    try {
      await db.insert(activityLog).values({
        projectId,
        actorRole: body.agentId,
        entityType: body.toolName ? "tool" : "event",
        entityId: body.toolUseId ?? body.taskId ?? undefined,
        action: body.eventType,
        details: {
          toolName: body.toolName,
          ...(body.toolInput && { toolInput: body.toolInput }),
          ...(body.error && { error: body.error }),
          ...(body.teammateName && { teammateName: body.teammateName }),
        },
      })
    } catch (err) {
      logger.warn("Failed to persist activity log entry", err)
    }

    return c.json({ ok: true, status })
  })

  return router
}
