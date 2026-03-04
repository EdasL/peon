/** OpenClaw gateway protocol types — adapted from openclaw-nerve/src/types.ts */

export type AgentStatusKind = "IDLE" | "THINKING" | "STREAMING" | "DONE" | "ERROR"

export interface GranularAgentState {
  status: AgentStatusKind
  toolName?: string
  toolDescription?: string
  since: number
}

export interface Session {
  sessionKey?: string
  key?: string
  id?: string
  label?: string
  state?: string
  agentState?: string
  busy?: boolean
  processing?: boolean
  status?: string
  lastActivity?: string | number
  updatedAt?: number
  abortedLastRun?: boolean
  model?: string
  thinking?: string
  thinkingLevel?: string
  totalTokens?: number
  contextTokens?: number
  parentId?: string
  inputTokens?: number
  outputTokens?: number
  channel?: string
  kind?: string
  displayName?: string
}

export function getSessionKey(s: Session): string {
  return s.sessionKey || s.key || s.id || ""
}

export interface AgentLogEntry {
  icon: string
  text: string
  ts: number
}

export interface EventEntry {
  badge: string
  badgeCls: string
  desc: string
  ts: Date
}

export interface TokenData {
  entries?: TokenEntry[]
  totalCost?: number
  totalInput?: number
  totalOutput?: number
  totalCacheRead?: number
  totalMessages?: number
  persistent?: {
    totalCost: number
    totalInput: number
    totalOutput: number
    lastUpdated: string
  }
  updatedAt?: number
}

export interface TokenEntry {
  source: string
  cost: number
  messageCount?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  errorCount?: number
}

export type ChatMessageRole = "user" | "assistant" | "tool" | "toolResult" | "system"

export type ContentBlockType = "text" | "tool_use" | "toolCall" | "tool_result" | "toolResult" | "image" | "thinking"

export interface ChatMessage {
  role: ChatMessageRole
  content: string | ContentBlock[]
  text?: string
  timestamp?: string | number
  createdAt?: string | number
  ts?: string | number
}

export interface ContentBlock {
  type: ContentBlockType
  text?: string
  name?: string
  input?: Record<string, unknown>
  id?: string
  toolCallId?: string
  arguments?: string | Record<string, unknown>
  content?: string | ContentBlock[]
  data?: string
  mimeType?: string
  source?: { type?: string; media_type?: string; data?: string }
}

export interface GatewayEvent {
  type: "event"
  event: string
  payload?: unknown
  seq?: number
  stateVersion?: { presence: number; health: number }
}

export interface GatewayRequest {
  type: "req"
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface GatewayResponse {
  type: "res"
  id: string
  ok: boolean
  payload?: unknown
  error?: { message: string; code?: string }
}

export type GatewayMessage = GatewayEvent | GatewayRequest | GatewayResponse

export interface AgentEventPayload {
  sessionKey?: string
  state?: string
  agentState?: string
  stream?: string
  data?: AgentToolStreamData
  totalTokens?: number
  contextTokens?: number
}

export interface AgentToolStreamData {
  phase: "start" | "result"
  toolCallId?: string
  name?: string
  args?: Record<string, unknown>
}

export interface SessionsListResponse {
  sessions?: Session[]
}

export interface ChatHistoryResponse {
  messages?: ChatMessage[]
}
