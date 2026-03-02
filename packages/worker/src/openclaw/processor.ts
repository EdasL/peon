/**
 * OpenClaw progress processor.
 *
 * Processes OpenClaw/Claude Code streaming events and extracts user-friendly content.
 * Adapted from the pi-agent processor to work with OpenClaw's event format.
 *
 * OpenClaw events arrive as JSON lines from the Claude Code CLI `--output-format stream-json`.
 */

import { createLogger } from "@lobu/core";
import { formatToolExecution } from "../shared/processor-utils";

const logger = createLogger("openclaw-processor");

/**
 * Claude Code stream-json event types.
 */
export interface ClaudeCodeEvent {
  type: string;
  subtype?: string;
  // text events
  content_block_delta?: {
    type: string;
    delta?: { type: string; text?: string };
  };
  // assistant message
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  // tool use
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  // result
  result?: string;
  error?: string;
  // system
  session_id?: string;
}

/**
 * Processes OpenClaw / Claude Code streaming events and extracts user-friendly content.
 */
export class OpenClawProgressProcessor {
  private chronologicalOutput = "";
  private lastSentContent = "";
  private currentThinking = "";
  private verboseLogging = false;
  private finalResult: { text: string; isFinal: boolean } | null = null;
  private hasStreamedText = false;
  private fatalErrorMessage: string | null = null;

  setVerboseLogging(enabled: boolean): void {
    this.verboseLogging = enabled;
    logger.info(`Verbose logging ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Process a Claude Code stream-json event.
   * Returns true if new content was appended.
   */
  processEvent(event: ClaudeCodeEvent): boolean {
    switch (event.type) {
      case "assistant": {
        if (event.subtype === "text") {
          // Streaming text delta
          const text =
            event.content_block_delta?.delta?.text ??
            (typeof (event as any).text === "string"
              ? (event as any).text
              : undefined);
          if (text) {
            this.hasStreamedText = true;
            this.chronologicalOutput += text;
            return true;
          }
        }
        if (event.subtype === "thinking") {
          const text =
            event.content_block_delta?.delta?.text ??
            (typeof (event as any).text === "string"
              ? (event as any).text
              : undefined);
          if (text) {
            this.currentThinking += text;
            if (this.verboseLogging) {
              this.chronologicalOutput += text;
              return true;
            }
          }
        }
        return false;
      }

      case "content_block_delta": {
        const delta = event.content_block_delta?.delta;
        if (delta?.type === "text_delta" && delta.text) {
          this.hasStreamedText = true;
          this.chronologicalOutput += delta.text;
          return true;
        }
        if (delta?.type === "thinking_delta" && delta.text) {
          this.currentThinking += delta.text;
          if (this.verboseLogging) {
            this.chronologicalOutput += delta.text;
            return true;
          }
        }
        return false;
      }

      case "tool_use": {
        const params =
          event.tool_input && typeof event.tool_input === "object"
            ? event.tool_input
            : {};
        const formatted = formatToolExecution(
          event.tool_name || "unknown",
          params,
          this.verboseLogging
        );
        if (formatted) {
          this.chronologicalOutput += `${formatted}\n`;
          return true;
        }
        return false;
      }

      case "result": {
        if (event.error) {
          this.fatalErrorMessage = event.error;
          return false;
        }
        if (event.result && !this.hasStreamedText) {
          this.chronologicalOutput += event.result;
          return true;
        }
        return false;
      }

      case "error": {
        const errorMsg =
          event.error ||
          (typeof (event as any).message === "string"
            ? (event as any).message
            : "Unknown error");
        this.fatalErrorMessage = errorMsg;
        return false;
      }

      case "system": {
        // System events (session_id, etc.) — no user-facing output
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Get delta since last sent content.
   * Returns null if no new content.
   */
  getDelta(): string | null {
    const fullContent = this.chronologicalOutput.trim();

    if (!fullContent) {
      return null;
    }

    if (fullContent === this.lastSentContent) {
      return null;
    }

    if (this.lastSentContent && fullContent.startsWith(this.lastSentContent)) {
      const delta = fullContent.slice(this.lastSentContent.length);
      this.lastSentContent = fullContent;
      return delta;
    }

    this.lastSentContent = fullContent;
    return fullContent;
  }

  setFinalResult(result: { text: string; isFinal: boolean }): void {
    this.finalResult = result;
  }

  getFinalResult(): { text: string; isFinal: boolean } | null {
    const result = this.finalResult;
    this.finalResult = null;
    return result;
  }

  consumeFatalErrorMessage(): string | null {
    const result = this.fatalErrorMessage;
    this.fatalErrorMessage = null;
    return result;
  }

  getCurrentThinking(): string | null {
    return this.currentThinking || null;
  }

  reset(): void {
    this.lastSentContent = "";
    this.chronologicalOutput = "";
    this.currentThinking = "";
    this.finalResult = null;
    this.hasStreamedText = false;
    this.fatalErrorMessage = null;
  }
}
