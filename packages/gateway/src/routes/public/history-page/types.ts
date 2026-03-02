export interface HistoryMessage {
  id: string;
  type: "message" | "compaction" | "model_change" | "custom_message";
  role?: string;
  content: unknown;
  model?: string;
  timestamp: string;
  isVerbose?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface MessagesResponse {
  messages: HistoryMessage[];
  nextCursor: string | null;
  hasMore: boolean;
  sessionId: string;
}

export interface StatsResponse {
  sessionId: string;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  currentModel?: string;
}

export interface StatusResponse {
  connected: boolean;
  hasHttpServer: boolean;
  deploymentCount: number;
}
