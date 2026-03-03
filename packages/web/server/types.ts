// Claude Code task file format (from ~/.claude/tasks/{team}/{id}.json)
export interface ClaudeTask {
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: "pending" | "in_progress" | "completed"
  blocks?: string[]
  blockedBy?: string[]
  metadata?: Record<string, unknown>
}

// Claude Code team config format (from ~/.claude/teams/{team}/config.json)
export interface ClaudeTeamConfig {
  name: string
  description: string
  createdAt: number
  leadAgentId: string
  leadSessionId: string
  members: ClaudeTeamMember[]
}

export interface ClaudeTeamMember {
  agentId: string
  name: string
  agentType: string
  model: string
  prompt?: string
  color?: string
  planModeRequired?: boolean
  joinedAt: number
  tmuxPaneId: string
  cwd: string
  subscriptions: string[]
  backendType?: string
}

// Board-specific types
export type BoardColumn = "backlog" | "todo" | "in_progress" | "qa" | "done"

export interface BoardTask extends ClaudeTask {
  boardColumn: BoardColumn
  tag?: string
}
