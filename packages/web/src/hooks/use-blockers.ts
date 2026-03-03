import { useState, useMemo } from "react"
import type { AgentState, ActivityEvent } from "@/hooks/use-agent-activity"
import type { ChatMessage } from "@/lib/api"
import type { ClaudeTask } from "../../server/types"

export interface Blocker {
  id: string
  agentName?: string
  type: "idle" | "question" | "stuck_task"
  message: string
  taskId?: string
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000
const STUCK_TASK_THRESHOLD_MS = 30 * 60 * 1000

const QUESTION_PATTERN =
  /\b(blocked|waiting|need input|could you|please clarify|what should)\b/i

export function useBlockers(opts: {
  projectStatus: string
  agents: AgentState[]
  feed: ActivityEvent[]
  tasks: (ClaudeTask & { updatedAt?: number })[]
  chatMessages: ChatMessage[]
  lastActivityAt: number
}): {
  blockers: Blocker[]
  dismiss: (id: string) => void
} {
  const { projectStatus, tasks, chatMessages, lastActivityAt } = opts

  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const blockers = useMemo<Blocker[]>(() => {
    const now = Date.now()
    const result: Blocker[] = []

    // 1. Idle detection
    if (
      projectStatus === "running" &&
      lastActivityAt > 0 &&
      now - lastActivityAt > IDLE_THRESHOLD_MS
    ) {
      result.push({
        id: "idle",
        type: "idle",
        message: "Team has gone quiet — no activity for 5+ minutes",
      })
    }

    // 2. Question in chat from assistant
    for (const msg of chatMessages) {
      if (msg.role !== "assistant") continue
      const content = msg.content.trim()
      const isQuestion = content.endsWith("?") || QUESTION_PATTERN.test(content)
      if (!isQuestion) continue

      const id = `question-${msg.id}`
      const preview =
        content.length > 100 ? `${content.slice(0, 100)}…` : content
      result.push({
        id,
        type: "question",
        message: preview,
      })
    }

    // 3. Stuck tasks
    for (const task of tasks) {
      if (task.status !== "in_progress") continue
      const updatedAt = task.updatedAt ?? 0
      if (updatedAt === 0) continue
      const elapsedMs = now - updatedAt
      if (elapsedMs < STUCK_TASK_THRESHOLD_MS) continue

      const elapsedMin = Math.floor(elapsedMs / 60_000)
      result.push({
        id: `stuck-${task.id}`,
        agentName: task.owner,
        type: "stuck_task",
        message: `Task "${task.subject}" stuck for ${elapsedMin} minutes`,
        taskId: task.id,
      })
    }

    return result.filter((b) => !dismissed.has(b.id))
  }, [projectStatus, tasks, chatMessages, lastActivityAt, dismissed])

  const dismiss = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]))
  }

  return { blockers, dismiss }
}
