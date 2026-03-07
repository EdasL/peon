import { useState, useRef, useEffect, useMemo } from "react"
import { useChat } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { Loader2, MessageSquare, Send, X, RefreshCw } from "lucide-react"
import { MarkdownMessage } from "./MarkdownMessage"
import { RichMessage } from "./RichMessage"
import { cn } from "@/lib/utils"
import type { ContentBlock } from "@/lib/api"
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css"
import {
  MessageList,
  Message,
  TypingIndicator,
} from "@chatscope/chat-ui-kit-react"

const THINKING_SENTINEL = "Thinking..."

type ContentSegment =
  | { type: "text"; text: string }
  | { type: "tools"; blocks: ContentBlock[] }

/** Split contentBlocks into consecutive text vs tool segments so each
 *  can be rendered as its own chat bubble. */
function splitContentSegments(blocks: ContentBlock[], fallbackText?: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let toolBuf: ContentBlock[] = []
  let textBuf = ""

  const flushText = () => {
    if (textBuf.trim()) {
      segments.push({ type: "text", text: textBuf })
      textBuf = ""
    }
  }
  const flushTools = () => {
    if (toolBuf.length > 0) {
      segments.push({ type: "tools", blocks: [...toolBuf] })
      toolBuf = []
    }
  }

  for (const block of blocks) {
    if (block.type === "tool_use") {
      flushText()
      toolBuf.push(block)
    } else if (block.type === "tool_result") {
      continue
    } else {
      flushTools()
      if (block.type === "text" && block.text) {
        textBuf += block.text
      } else if (block.type === "thinking") {
        // keep thinking blocks with tools visually
        toolBuf.push(block)
      }
    }
  }
  flushTools()
  flushText()

  // If nothing was produced, fall back to plain content
  if (segments.length === 0 && fallbackText?.trim()) {
    segments.push({ type: "text", text: fallbackText })
  }

  return segments
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: "0.8s" }}
        />
      ))}
    </span>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  } catch {
    return ""
  }
}

export function ChatPanel({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const { messages, send, sending, streamingContent, streamingTarget, streamingBlocks, loading, error, connected } =
    useChat(projectId)
  const [input, setInput] = useState("")
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false)

  const toolBlocks = useMemo(() => {
    return streamingBlocks.filter((b) => b.type === "tool_use")
  }, [streamingBlocks])

  const renderedMessages = useMemo(() => {
    return messages.flatMap((msg) => {
      const key = msg._stableKey || msg.id
      const footer = (label: string) => (
        <Message.Footer>
          <span className="text-[11px] text-muted-foreground">
            {label}
            {msg.createdAt && ` \u00b7 ${formatTime(msg.createdAt)}`}
          </span>
        </Message.Footer>
      )

      if (msg.role !== "assistant") {
        return (
          <Message key={key} model={{ direction: "outgoing", position: "single" }}>
            <Message.CustomContent>
              <span className="text-sm leading-relaxed">{msg.content}</span>
            </Message.CustomContent>
            {footer("You")}
          </Message>
        )
      }

      if (msg.contentBlocks?.length) {
        const segments = splitContentSegments(msg.contentBlocks, msg.content)
        return segments.map((seg, i) => (
          <Message
            key={`${key}-seg-${i}`}
            model={{ direction: "incoming", position: "single" }}
          >
            <Message.CustomContent>
              {seg.type === "tools" ? (
                <RichMessage blocks={seg.blocks} />
              ) : (
                <MarkdownMessage content={seg.text} />
              )}
            </Message.CustomContent>
            {i === segments.length - 1 && footer("Team Lead")}
          </Message>
        ))
      }

      return (
        <Message key={key} model={{ direction: "incoming", position: "single" }}>
          <Message.CustomContent>
            <MarkdownMessage content={msg.content} />
          </Message.CustomContent>
          {footer("Team Lead")}
        </Message>
      )
    })
  }, [messages])

  useEffect(() => {
    if (connected) setHasConnectedOnce(true)
  }, [connected])
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const msgListRef = useRef<HTMLDivElement>(null)

  const handleSend = () => {
    if (!input.trim() || disabled) return
    send(input.trim())
    setInput("")
  }

  const visibleError = error && error !== dismissedError ? error : null

  return (
    <div className="chat-panel-root flex flex-col h-full min-w-0 overflow-hidden bg-background">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-medium">Team Lead</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[#22C55E]" />
              live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-status-warning-text">
              <span className="size-1.5 rounded-full bg-status-warning-text animate-pulse" />
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {visibleError && (
        <div className="flex items-start gap-2 bg-status-error-bg border-b border-status-error-border px-4 py-2 text-xs text-destructive">
          <span className="flex-1">{visibleError}</span>
          <button
            onClick={() => setDismissedError(visibleError)}
            className="shrink-0 text-destructive hover:text-destructive/70 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Reconnection banner */}
      {hasConnectedOnce && !connected && (
        <div className="flex items-center gap-2 bg-status-warning-bg border-b border-status-warning-border px-3 py-1.5 text-xs text-status-warning-text">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>Reconnecting to server...</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && !streamingContent ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Describe a feature or bug to get started
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Your team will pick up the work automatically
            </p>
          </div>
        ) : (
          <MessageList
            ref={msgListRef}
            autoScrollToBottom
            autoScrollToBottomOnMount
            typingIndicator={
              streamingContent === THINKING_SENTINEL && toolBlocks.length === 0 ? (
                <TypingIndicator content="Team Lead is thinking" />
              ) : null
            }
          >
            {renderedMessages}
            {toolBlocks.length > 0 && (
              <Message
                model={{
                  direction: "incoming",
                  position: "single",
                }}
              >
                <Message.CustomContent>
                  <RichMessage blocks={toolBlocks} />
                </Message.CustomContent>
                <Message.Footer>
                  <span className="text-[11px] text-muted-foreground">Team Lead</span>
                </Message.Footer>
              </Message>
            )}
            {streamingContent && streamingContent !== THINKING_SENTINEL && (
              <Message
                model={{
                  direction: "incoming",
                  position: "single",
                }}
              >
                <Message.CustomContent>
                  <MarkdownMessage content={streamingContent + " |"} />
                </Message.CustomContent>
                <Message.Footer>
                  <span className="text-[11px] text-muted-foreground">Team Lead</span>
                </Message.Footer>
              </Message>
            )}
          </MessageList>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2 items-start">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = "auto"
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={disabled ? "Chat unavailable" : "Message team lead..."}
              disabled={sending || disabled}
              rows={1}
              className={cn(
                "w-full resize-none rounded-sm border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-[#C8C5BC]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "min-h-[36px] max-h-[120px] leading-relaxed"
              )}
            />
          </div>
          <Button
            size="icon"
            onClick={handleSend}
            disabled={sending || disabled || !input.trim()}
            className="size-[38px] min-h-[38px] flex-shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {disabled ? "Container is stopped. Restart to continue." : "Enter to send, Shift+Enter for new line"}
        </p>
      </div>
    </div>
  )
}
