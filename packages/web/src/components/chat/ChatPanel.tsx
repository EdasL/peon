import { useState, useRef, useEffect } from "react"
import { useChat } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { Loader2, MessageSquare, Send, X, RefreshCw } from "lucide-react"
import { MarkdownMessage } from "./MarkdownMessage"
import { cn } from "@/lib/utils"
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css"
import {
  MessageList,
  Message,
  MessageGroup,
  TypingIndicator,
} from "@chatscope/chat-ui-kit-react"

const THINKING_SENTINEL = "Thinking..."

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
  const { messages, send, sending, streamingContent, loading, error, connected } =
    useChat(projectId)
  const [input, setInput] = useState("")
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false)

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
              streamingContent === THINKING_SENTINEL ? (
                <TypingIndicator content="Team Lead is thinking" />
              ) : null
            }
          >
            {messages.map((msg) => (
              <Message
                key={msg.id}
                model={{
                  direction: msg.role === "user" ? "outgoing" : "incoming",
                  position: "single",
                }}
              >
                <Message.CustomContent>
                  {msg.role === "assistant" ? (
                    <MarkdownMessage content={msg.content} />
                  ) : (
                    <span className="text-sm leading-relaxed">{msg.content}</span>
                  )}
                </Message.CustomContent>
                <Message.Footer>
                  <span className="text-[11px] text-muted-foreground">
                    {msg.role === "user" ? "You" : "Team Lead"}
                    {msg.createdAt && ` \u00b7 ${formatTime(msg.createdAt)}`}
                  </span>
                </Message.Footer>
              </Message>
            ))}
            {streamingContent && streamingContent !== THINKING_SENTINEL && (
              <Message
                model={{
                  direction: "incoming",
                  position: "single",
                }}
              >
                <Message.CustomContent>
                  <MarkdownMessage content={streamingContent + "\u258D"} />
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
            className="h-[36px] min-h-[36px] w-[36px] flex-shrink-0"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
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
