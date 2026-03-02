/**
 * Telegram-specific type definitions.
 */

/**
 * Telegram context extracted from incoming messages.
 */
export interface TelegramContext {
  /** Sender's numeric Telegram user ID */
  senderId: number;

  /** Sender's username (without @) */
  senderUsername?: string;

  /** Sender's display name */
  senderDisplayName?: string;

  /** Chat ID (positive for users, negative for groups) */
  chatId: number;

  /** Chat type: "private", "group", "supergroup", or "channel" */
  chatType: string;

  /** Whether this is a group chat */
  isGroup: boolean;

  /** Message ID */
  messageId: number;

  /** Message thread ID (for topics in supergroups) */
  messageThreadId?: number;

  /** Replied-to message context */
  repliedMessage?: {
    id: number;
    body: string;
    sender: string;
  };
}

/**
 * Check if a chat type is a group chat.
 */
export function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}
