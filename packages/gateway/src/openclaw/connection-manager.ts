/**
 * OpenClaw Connection Manager.
 *
 * Maintains WebSocket connections to each active worker container's OpenClaw
 * gateway. Subscribes to raw events (agent, chat, presence) and maps them to
 * broadcastToProject() SSE events so the frontend receives a reliable,
 * full-fidelity activity stream.
 *
 * Replaces the old fire-and-forget HTTP relay from the worker.
 */

import { createLogger, OpenClawProtocolClient } from "@lobu/core"
import { broadcastToProject } from "../web/redis-broadcast.js"

const logger = createLogger("openclaw-conn-mgr")

interface ContainerConnection {
  projectId: string
  deploymentName: string
  client: OpenClawProtocolClient
}

const connections = new Map<string, ContainerConnection>()

/**
 * Connect to a container's OpenClaw gateway and start streaming events
 * to the associated project's SSE clients.
 */
export async function connectToContainer(
  projectId: string,
  deploymentName: string,
  openclawWsUrl: string,
  openclawToken?: string,
): Promise<void> {
  // Disconnect existing connection for this project if any
  disconnectProject(projectId)

  const client = new OpenClawProtocolClient({
    clientId: "gateway-client",
    clientDisplayName: `Peon Gateway (${projectId.substring(0, 8)})`,
    autoReconnect: true,
    token: openclawToken,
  })

  const conn: ContainerConnection = { projectId, deploymentName, client }
  connections.set(projectId, conn)

  client.onEvent((event: string, data: Record<string, unknown>) => {
    handleOpenClawEvent(projectId, event, data)
  })

  try {
    await client.connect(openclawWsUrl)
    logger.info(`Connected to OpenClaw for project ${projectId} at ${openclawWsUrl}`)
  } catch (err) {
    logger.error(
      `Failed to connect to OpenClaw for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`
    )
    // Auto-reconnect is enabled, so the client will keep trying
  }
}

/**
 * Disconnect from a project's container OpenClaw gateway.
 */
export function disconnectProject(projectId: string): void {
  const conn = connections.get(projectId)
  if (conn) {
    conn.client.disconnect()
    connections.delete(projectId)
    logger.info(`Disconnected from OpenClaw for project ${projectId}`)
  }
}

/**
 * Disconnect by deployment name (used when container is deleted/stopped).
 */
export function disconnectByDeployment(deploymentName: string): void {
  for (const [projectId, conn] of connections) {
    if (conn.deploymentName === deploymentName) {
      conn.client.disconnect()
      connections.delete(projectId)
      logger.info(`Disconnected OpenClaw for deployment ${deploymentName} (project ${projectId})`)
      return
    }
  }
}

/**
 * Get the protocol client for a project (used by WS proxy for dashboard).
 */
export function getClientForProject(projectId: string): OpenClawProtocolClient | null {
  return connections.get(projectId)?.client ?? null
}

/** Get all active connections (for debugging/monitoring). */
export function getActiveConnections(): ReadonlyMap<string, ContainerConnection> {
  return connections
}

// ---------------------------------------------------------------------------
// Event mapping: OpenClaw raw events -> broadcastToProject SSE events
// ---------------------------------------------------------------------------

/**
 * Map raw OpenClaw gateway events to Peon's SSE broadcast format.
 * The frontend's use-agent-activity.ts already handles these event types.
 */
function handleOpenClawEvent(
  projectId: string,
  event: string,
  data: Record<string, unknown>
): void {
  if (event === "agent") {
    handleAgentEvent(projectId, data)
  } else if (event === "chat") {
    handleChatEvent(projectId, data)
  } else if (event === "presence") {
    // Future: broadcast presence updates
    logger.debug(`[${projectId}] presence event: ${JSON.stringify(data).substring(0, 100)}`)
  }
}

function handleAgentEvent(projectId: string, data: Record<string, unknown>): void {
  const stream = data.stream as string | undefined
  const evtData = data.data as Record<string, unknown> | undefined
  if (!evtData) return

  const sessionKey = data.sessionKey as string | undefined
  const agentName = deriveAgentName(sessionKey)

  if (stream === "tool") {
    const phase = evtData.phase as string | undefined
    const toolName = (evtData.name as string) ?? "unknown"
    const input = (evtData.input as Record<string, unknown>) ?? {}

    if (phase === "start" || !phase) {
      const filePath = (input.file_path ?? input.path) as string | undefined
      const command = input.command as string | undefined
      const text = buildToolActivityText(toolName, input)

      broadcastToProject(projectId, "agent_activity", {
        type: "tool_start",
        tool: toolName,
        agentName,
        timestamp: Date.now(),
        ...(text && { text }),
        ...(filePath && { filePath }),
        ...(command && { command }),
      })

      // Intercept task-related tool calls to broadcast task updates
      if (isTaskTool(toolName)) {
        handleTaskToolCall(projectId, toolName, input)
      }
    } else if (phase === "end" || phase === "result") {
      broadcastToProject(projectId, "agent_activity", {
        type: "tool_end",
        tool: toolName,
        agentName,
        timestamp: Date.now(),
      })
    }
  } else if (stream === "lifecycle") {
    const phase = evtData.phase as string | undefined
    if (phase === "end") {
      broadcastToProject(projectId, "agent_activity", {
        type: "turn_end",
        agentName,
        timestamp: Date.now(),
      })
    } else if (phase === "error") {
      broadcastToProject(projectId, "agent_activity", {
        type: "error",
        agentName,
        message: (evtData.error as string) ?? "Agent error",
        timestamp: Date.now(),
      })
    }
  } else if (stream === "thinking") {
    // Intentionally skipped — too noisy for the activity feed
  }
}

function handleChatEvent(projectId: string, data: Record<string, unknown>): void {
  const state = data.state as string | undefined
  if (state === "error") {
    broadcastToProject(projectId, "agent_activity", {
      type: "error",
      agentName: "lead",
      message: (data.errorMessage as string) ?? "Chat error",
      timestamp: Date.now(),
    })
  }
}

// ---------------------------------------------------------------------------
// Task tool interception
// ---------------------------------------------------------------------------

const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TodoWrite"])

function isTaskTool(name: string): boolean {
  return TASK_TOOLS.has(name)
}

function handleTaskToolCall(
  projectId: string,
  toolName: string,
  input: Record<string, unknown>
): void {
  if (toolName === "TodoWrite") {
    const todos = input.todos as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(todos)) return
    for (const todo of todos) {
      broadcastToProject(projectId, "task_update", {
        id: todo.id ?? `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        subject: (todo.content as string) ?? "Untitled task",
        status: mapTodoStatus(todo.status as string),
        owner: null,
        boardColumn: mapTodoStatusToColumn(todo.status as string),
        updatedAt: Date.now(),
      })
    }
  } else if (toolName === "TaskCreate" || toolName === "TaskUpdate") {
    const taskId = (input.taskId ?? input.id) as string | undefined
    const subject = (input.subject ?? input.title) as string | undefined
    if (!subject && toolName === "TaskCreate") return

    broadcastToProject(projectId, "task_update", {
      id: taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      subject: subject ?? `Task ${taskId}`,
      description: (input.description as string) ?? "",
      status: normalizeTaskStatus(input.status as string),
      owner: (input.owner as string) ?? null,
      boardColumn: deriveBoardColumn(input.status as string),
      updatedAt: Date.now(),
    })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveAgentName(sessionKey: string | undefined): string {
  if (!sessionKey || sessionKey === "main") return "lead"
  const dashIdx = sessionKey.indexOf("-")
  if (dashIdx > 0) return sessionKey.substring(0, dashIdx)
  return sessionKey
}

function buildToolActivityText(tool: string, input: Record<string, unknown>): string | undefined {
  const filePath = (input.file_path ?? input.path) as string | undefined
  const command = input.command as string | undefined
  const query = input.query as string | undefined

  switch (tool.toLowerCase()) {
    case "read": return filePath ? `Reading ${filePath}` : "Reading file"
    case "write": return filePath ? `Creating ${filePath}` : "Creating file"
    case "edit":
    case "multiedit": return filePath ? `Editing ${filePath}` : "Editing file"
    case "bash":
    case "exec": return command ? `Running \`${command.length > 60 ? command.substring(0, 60) + "..." : command}\`` : "Running command"
    case "grep": return query ? `Searching for "${query}"` : "Searching codebase"
    case "glob": return "Scanning files"
    case "websearch": return query ? `Searching web: ${query}` : "Searching web"
    default: return undefined
  }
}

function mapTodoStatus(status: string | undefined): string {
  switch (status) {
    case "in_progress": return "in_progress"
    case "completed": return "completed"
    case "cancelled": return "completed"
    default: return "pending"
  }
}

function mapTodoStatusToColumn(status: string | undefined): string {
  switch (status) {
    case "in_progress": return "in_progress"
    case "completed":
    case "cancelled": return "done"
    default: return "backlog"
  }
}

function normalizeTaskStatus(s?: string): string {
  if (s === "in_progress") return "in_progress"
  if (s === "completed") return "completed"
  return "pending"
}

function deriveBoardColumn(status?: string): string {
  if (status === "in_progress") return "in_progress"
  if (status === "completed") return "done"
  return "backlog"
}
