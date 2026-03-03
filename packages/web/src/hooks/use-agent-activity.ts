import { useState, useEffect, useRef, useCallback } from "react"
import { fetchTasks } from "@/lib/api"
import type { ClaudeTask } from "../../server/types"

export type AgentStatus = "idle" | "working" | "error"

export interface AgentState {
  name: string
  status: AgentStatus
  currentTask: string | null
  activeForm: string | null
}

export interface ActivityEvent {
  id: string
  timestamp: number
  agentName: string
  type: "started" | "completed" | "status_change" | "task_update" | "tool_use"
  taskSubject: string
  detail?: string
  /** For tool_use events: the raw tool name (e.g. "Read", "Bash") */
  tool?: string
  /** For tool_use events: whether this is a start or end marker */
  toolPhase?: "start" | "end"
}

/** Shape of SSE agent_activity event data from the backend */
interface AgentActivityEvent {
  type: "tool_start" | "tool_end" | "thinking" | "turn_end" | "error"
  tool?: string
  text?: string
  message?: string
  timestamp: number
}

const POLL_INTERVAL = 4000
const MAX_FEED_EVENTS = 100
/** How long (ms) a tool_start action stays visible on the agent card */
const TOOL_ACTION_TTL = 10_000

/** Convert a raw tool name into a short human-readable verb phrase */
function toolLabel(tool: string): string {
  switch (tool.toLowerCase()) {
    case "read":
      return "Reading file"
    case "write":
      return "Writing file"
    case "edit":
    case "multiedit":
      return "Editing file"
    case "bash":
      return "Running command"
    case "grep":
      return "Searching codebase"
    case "glob":
      return "Scanning files"
    case "webbrowser":
    case "webfetch":
      return "Fetching URL"
    case "websearch":
      return "Searching web"
    default:
      return `Using ${tool}`
  }
}

function deriveAgentStatus(tasks: ClaudeTask[], agentName: string): AgentState {
  const owned = tasks.filter((t) => t.owner === agentName)
  const active = owned.find((t) => t.status === "in_progress")
  if (active) {
    return {
      name: agentName,
      status: "working",
      currentTask: active.subject,
      activeForm: active.activeForm ?? null,
    }
  }
  return {
    name: agentName,
    status: "idle",
    currentTask: null,
    activeForm: null,
  }
}

function extractAgents(tasks: ClaudeTask[]): string[] {
  const names = new Set<string>()
  for (const t of tasks) {
    if (t.owner && t.owner !== "qa") names.add(t.owner)
    if (t.owner === "qa") names.add("qa")
  }
  return Array.from(names)
}

export function useAgentActivity(projectId: string, templateAgentNames?: string[]) {
  const [tasks, setTasks] = useState<ClaudeTask[]>([])
  const [agents, setAgents] = useState<AgentState[]>([])
  const [feed, setFeed] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  /** Most recent tool action text + the time it arrived (for TTL check) */
  const [lastToolAction, setLastToolAction] = useState<{ text: string; at: number } | null>(null)
  const prevTasksRef = useRef<Map<string, ClaudeTask>>(new Map())

  const addFeedEvent = useCallback((event: Omit<ActivityEvent, "id">) => {
    const e: ActivityEvent = { ...event, id: `${Date.now()}-${Math.random()}` }
    setFeed((prev) => [e, ...prev].slice(0, MAX_FEED_EVENTS))
  }, [])

  const processTasks = useCallback(
    (incoming: ClaudeTask[]) => {
      const prev = prevTasksRef.current

      for (const task of incoming) {
        const old = prev.get(task.id)
        const agentName = task.owner ?? "team-lead"

        if (!old) {
          // New task appeared
          if (task.status === "in_progress") {
            addFeedEvent({
              timestamp: Date.now(),
              agentName,
              type: "started",
              taskSubject: task.subject,
            })
          }
        } else {
          // Existing task changed
          if (old.status !== task.status) {
            if (task.status === "in_progress") {
              addFeedEvent({
                timestamp: Date.now(),
                agentName,
                type: "started",
                taskSubject: task.subject,
              })
            } else if (task.status === "completed" && old.status === "in_progress") {
              addFeedEvent({
                timestamp: Date.now(),
                agentName,
                type: "completed",
                taskSubject: task.subject,
              })
            }
          } else if (old.owner !== task.owner && task.owner) {
            addFeedEvent({
              timestamp: Date.now(),
              agentName: task.owner,
              type: "task_update",
              taskSubject: task.subject,
              detail: `assigned to ${task.owner}`,
            })
          }
        }
      }

      // Update prev map
      const nextMap = new Map<string, ClaudeTask>()
      for (const t of incoming) nextMap.set(t.id, t)
      prevTasksRef.current = nextMap

      setTasks(incoming)

      // Derive agent states
      const agentNames = extractAgents(incoming)
      // Always include team-lead if there are in_progress tasks without explicit owner
      const hasLeadWork = incoming.some((t) => !t.owner && t.status === "in_progress")
      if (hasLeadWork && !agentNames.includes("team-lead")) agentNames.unshift("team-lead")

      // If no task-derived agents yet but we have template agents, show them as idle
      if (agentNames.length === 0 && templateAgentNames && templateAgentNames.length > 0) {
        setAgents(templateAgentNames.map((name) => ({
          name,
          status: "idle" as const,
          currentTask: null,
          activeForm: null,
        })))
      } else {
        const agentStates = agentNames.map((name) => deriveAgentStatus(incoming, name))
        setAgents(agentStates)
      }
    },
    [addFeedEvent]
  )

  const refresh = useCallback(async () => {
    try {
      const raw = await fetchTasks(projectId)
      processTasks(raw)
    } catch {
      // Silently fail — polling will retry
    } finally {
      setLoading(false)
    }
  }, [projectId, processTasks])

  // Initial load + polling
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  // SSE for immediate task_update and agent_activity events
  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/chat/stream`, {
      withCredentials: true,
    })

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.addEventListener("task_update", () => {
      // Trigger a refresh to get the latest state
      refresh()
    })

    es.addEventListener("task_delete", () => {
      refresh()
    })

    es.addEventListener("agent_activity", (e: MessageEvent) => {
      let data: AgentActivityEvent
      try {
        data = JSON.parse(e.data) as AgentActivityEvent
      } catch {
        return
      }

      const ts = data.timestamp ?? Date.now()

      if (data.type === "tool_start" && data.tool) {
        const label = toolLabel(data.tool)
        // Ensure at least one agent exists when a tool fires before tasks load
        setAgents((prev) => {
          if (prev.length === 0)
            return [{ name: "agent", status: "working", currentTask: null, activeForm: label }]
          return prev.map((a) => ({ ...a, status: "working" as const, activeForm: label }))
        })
        // Use local clock for TTL, not server timestamp
        setLastToolAction({ text: label, at: Date.now() })
        addFeedEvent({
          timestamp: ts,
          agentName: "agent",
          type: "tool_use",
          taskSubject: data.tool,
          detail: label,
          tool: data.tool,
          toolPhase: "start",
        })
      } else if (data.type === "tool_end" && data.tool) {
        addFeedEvent({
          timestamp: ts,
          agentName: "agent",
          type: "tool_use",
          taskSubject: data.tool,
          detail: `Done: ${data.tool}`,
          tool: data.tool,
          toolPhase: "end",
        })
      } else if (data.type === "thinking") {
        // Intentionally skipped — too noisy for the feed.
        // The agent is working; no state update needed.
      } else if (data.type === "turn_end") {
        // Clear tool action when turn finishes
        setLastToolAction(null)
      } else if (data.type === "error" && data.message) {
        setAgents((prev) => {
          if (prev.length === 0)
            return [{ name: "agent", status: "error", currentTask: null, activeForm: data.message ?? null }]
          return prev.map((a) => ({ ...a, status: "error" as const, activeForm: data.message ?? a.activeForm }))
        })
        addFeedEvent({
          timestamp: ts,
          agentName: "agent",
          type: "status_change",
          taskSubject: "error",
          detail: data.message,
        })
      }
    })

    return () => es.close()
  }, [projectId, refresh, addFeedEvent])

  // Auto-clear stale tool action after TTL expires
  useEffect(() => {
    if (!lastToolAction) return
    const remaining = TOOL_ACTION_TTL - (Date.now() - lastToolAction.at)
    if (remaining <= 0) {
      setLastToolAction(null)
      return
    }
    const timer = setTimeout(() => setLastToolAction(null), remaining)
    return () => clearTimeout(timer)
  }, [lastToolAction])

  return { tasks, agents, feed, loading, connected, currentToolAction: lastToolAction?.text ?? null }
}
