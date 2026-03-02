import {
  readTeamConfig,
  readTeamTasks,
  updateTask,
} from "./claude-files.js"
import type { ClaudeTask, ClaudeTeamMember } from "./types.js"

const OPENCLAW_GATEWAY = "http://127.0.0.1:18789"

/**
 * Rule-based triage: match task subject/description against agent roles.
 */
function ruleBasedTriage(
  task: ClaudeTask,
  agents: ClaudeTeamMember[]
): string | null {
  const text = `${task.subject} ${task.description}`.toLowerCase()

  const rules: Array<{ keywords: string[]; agentType: string }> = [
    {
      keywords: ["ui", "design", "style", "css", "layout", "theme", "icon", "font", "color", "ux", "accessibility"],
      agentType: "designer",
    },
    {
      keywords: ["api", "database", "server", "backend", "endpoint", "route", "schema", "migration", "go ", "sql", "auth"],
      agentType: "backend",
    },
    {
      keywords: ["mobile", "react native", "app", "screen", "navigation", "ios", "android", "expo", "component", "hook"],
      agentType: "mobile",
    },
  ]

  for (const rule of rules) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      const match = agents.find((a) => a.agentType === rule.agentType)
      if (match) return match.name
    }
  }

  // Fallback: assign to first non-lead, non-qa agent
  const fallback = agents.find(
    (a) => a.agentType !== "lead" && a.name !== "qa"
  )
  return fallback?.name ?? null
}

/**
 * Try OpenClaw gateway for AI-powered triage, fall back to rules.
 */
async function triageTask(
  task: ClaudeTask,
  agents: ClaudeTeamMember[]
): Promise<string | null> {
  const eligibleAgents = agents.filter(
    (m) => m.agentType !== "lead" && m.name !== "qa"
  )
  if (eligibleAgents.length === 0) return null

  // Try OpenClaw gateway first
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/api/v1/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Assign this task to the most appropriate agent. Task: "${task.subject}" — ${task.description}. Available agents: ${eligibleAgents.map((a) => `${a.name} (${a.agentType})`).join(", ")}. Reply with ONLY the agent name, nothing else.`,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = (await res.json()) as { reply?: string }
      const reply = data.reply?.trim().toLowerCase()
      if (reply) {
        const match = eligibleAgents.find((a) => reply.includes(a.name))
        if (match) return match.name
      }
    }
  } catch {
    // OpenClaw not running — fall through to rules
  }

  return ruleBasedTriage(task, eligibleAgents)
}

// Track active pollers so we can stop them
const activePollers = new Map<string, ReturnType<typeof setInterval>>()

/**
 * Start polling for unassigned "pending" tasks in a team and auto-assign them.
 */
export function startTriagePoller(teamName: string): void {
  // Don't start duplicate pollers
  if (activePollers.has(teamName)) return

  const interval = setInterval(async () => {
    try {
      const config = await readTeamConfig(teamName)
      if (!config) return

      const tasks = await readTeamTasks(teamName)
      for (const task of tasks) {
        // Only triage: pending, no owner, not internal
        if (
          task.status === "pending" &&
          !task.owner &&
          !task.metadata?._internal
        ) {
          const agent = await triageTask(task, config.members)
          if (agent) {
            await updateTask(teamName, task.id, { owner: agent })
            console.log(`[triage] Assigned task #${task.id} "${task.subject}" → ${agent}`)
          }
        }
      }
    } catch (err) {
      console.error(`[triage] Error polling ${teamName}:`, err)
    }
  }, 10_000)

  activePollers.set(teamName, interval)
  console.log(`[triage] Started poller for team "${teamName}"`)
}

/**
 * Stop a team's triage poller.
 */
export function stopTriagePoller(teamName: string): void {
  const interval = activePollers.get(teamName)
  if (interval) {
    clearInterval(interval)
    activePollers.delete(teamName)
  }
}
