import { useState, useEffect, useRef, useCallback } from "react"
import { fetchTasks } from "@/lib/api"
import type { ClaudeTask } from "../../server/types"

const STALE_THRESHOLD_MS = 30_000
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

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
  /** File path associated with the tool call (Read, Write, Edit, Grep, Glob) */
  filePath?: string
  /** Shell command (Bash tool) */
  command?: string
}

/** Shape of SSE agent_activity event data from the backend */
interface AgentActivityEvent {
  type: "tool_start" | "tool_end" | "thinking" | "turn_end" | "error"
  tool?: string
  text?: string
  /** File path associated with the tool call */
  filePath?: string
  /** Shell command (Bash tool) */
  command?: string
  message?: string
  agentName?: string
  timestamp: number
}

const POLL_INTERVAL = 4000
const MAX_FEED_EVENTS = 100
/** How long (ms) a tool_start action stays visible on the agent card */
const TOOL_ACTION_TTL = 10_000

/** Convert a raw tool name into a short human-readable verb phrase */
function toolVerb(tool: string): string {
  switch (tool.toLowerCase()) {
    case "read":
      return "Reading"
    case "write":
      return "Creating"
    case "edit":
    case "multiedit":
      return "Editing"
    case "bash":
      return "Running"
    case "grep":
      return "Searching"
    case "glob":
      return "Finding files"
    case "webbrowser":
    case "webfetch":
      return "Fetching"
    case "websearch":
      return "Searching web"
    default:
      return `Using ${tool}`
  }
}

/**
 * Build a human-readable label for a tool call.
 * Uses enriched fields (filePath, command) when available, falls back to text or generic verb.
 */
function toolLabel(tool: string, opts?: { filePath?: string; command?: string; text?: string }): string {
  const verb = toolVerb(tool)
  if (opts?.filePath) return `${verb} \`${opts.filePath}\``
  if (opts?.command) {
    const cmd = opts.command.length > 80 ? `${opts.command.slice(0, 80)}...` : opts.command
    return `${verb} \`${cmd}\``
  }
  if (opts?.text) return `${verb} — ${opts.text}`
  // Fallback: generic label
  switch (tool.toLowerCase()) {
    case "read": return "Reading file"
    case "write": return "Creating file"
    case "edit":
    case "multiedit": return "Editing file"
    case "bash": return "Running command"
    case "grep": return "Searching codebase"
    case "glob": return "Scanning files"
    case "webbrowser":
    case "webfetch": return "Fetching URL"
    case "websearch": return "Searching web"
    default: return `Using ${tool}`
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
    let cancelled = false
    const lastEventTimeRef = { current: 0 }
    const backoffRef = { current: BACKOFF_INITIAL_MS }
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let staleCheckInterval: ReturnType<typeof setInterval> | null = null
    let currentEs: EventSource | null = null

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const connectSSE = (isReconnect: boolean) => {
      if (cancelled) return

      if (currentEs) {
        currentEs.close()
        currentEs = null
      }

      const es = new EventSource(`/api/projects/${projectId}/chat/stream`, {
        withCredentials: true,
      })
      currentEs = es

      es.onopen = () => {
        if (cancelled) return
        backoffRef.current = BACKOFF_INITIAL_MS
        lastEventTimeRef.current = Date.now()
        setConnected(true)
        if (isReconnect) refresh()
      }

      es.onerror = () => {
        if (cancelled) return
        setConnected(false)
        es.close()
        if (currentEs === es) currentEs = null

        clearReconnect()
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS)
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connectSSE(true)
        }, delay)
      }

      const markEvent = () => {
        lastEventTimeRef.current = Date.now()
        setConnected(true)
      }

      es.addEventListener("ping", markEvent)

      es.addEventListener("task_update", () => {
        markEvent()
        refresh()
      })

      es.addEventListener("task_delete", () => {
        markEvent()
        refresh()
      })

      es.addEventListener("agent_activity", (e: MessageEvent) => {
        markEvent()
        let data: AgentActivityEvent
        try {
          data = JSON.parse(e.data) as AgentActivityEvent
        } catch {
          return
        }

        const ts = data.timestamp ?? Date.now()
        const agentName = data.agentName ?? "agent"

        if (data.type === "tool_start" && data.tool) {
          const label = toolLabel(data.tool, {
            filePath: data.filePath,
            command: data.command,
            text: data.text,
          })
          setAgents((prev) => {
            if (prev.length === 0)
              return [{ name: agentName, status: "working", currentTask: null, activeForm: label }]
            const idx = prev.findIndex((a) => a.name === agentName)
            if (idx >= 0) {
              const updated = [...prev]
              updated[idx] = { ...updated[idx], status: "working", activeForm: label }
              return updated
            }
            return prev.map((a) => ({ ...a, status: "working" as const, activeForm: label }))
          })
          setLastToolAction({ text: label, at: Date.now() })
          addFeedEvent({
            timestamp: ts,
            agentName,
            type: "tool_use",
            taskSubject: data.tool,
            detail: label,
            tool: data.tool,
            toolPhase: "start",
            filePath: data.filePath,
            command: data.command,
          })
        } else if (data.type === "tool_end" && data.tool) {
          addFeedEvent({
            timestamp: ts,
            agentName,
            type: "tool_use",
            taskSubject: data.tool,
            detail: `Done: ${data.tool}`,
            tool: data.tool,
            toolPhase: "end",
          })
        } else if (data.type === "thinking") {
          // Intentionally skipped — too noisy for the feed.
        } else if (data.type === "turn_end") {
          setLastToolAction(null)
        } else if (data.type === "error" && data.message) {
          setAgents((prev) => {
            if (prev.length === 0)
              return [{ name: agentName, status: "error", currentTask: null, activeForm: data.message ?? null }]
            return prev.map((a) => ({ ...a, status: "error" as const, activeForm: data.message ?? a.activeForm }))
          })
          addFeedEvent({
            timestamp: ts,
            agentName,
            type: "status_change",
            taskSubject: "error",
            detail: data.message,
          })
        }
      })
    }

    connectSSE(false)

    // Stale-connection detector: if no event in 30s, reconnect
    staleCheckInterval = setInterval(() => {
      if (cancelled) return
      const elapsed = Date.now() - lastEventTimeRef.current
      if (elapsed > STALE_THRESHOLD_MS && currentEs) {
        setConnected(false)
        currentEs.close()
        currentEs = null
        clearReconnect()
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS)
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connectSSE(true)
        }, delay)
      }
    }, STALE_THRESHOLD_MS)

    return () => {
      cancelled = true
      clearReconnect()
      if (staleCheckInterval !== null) clearInterval(staleCheckInterval)
      if (currentEs) currentEs.close()
    }
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
