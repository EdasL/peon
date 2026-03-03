import { useState, useRef, useEffect } from "react"
import { useChat } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, MessageSquare, Send, X, RefreshCw } from "lucide-react"
import { MarkdownMessage } from "./MarkdownMessage"
import { cn } from "@/lib/utils"

const THINKING_SENTINEL = "Thinking..."

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-zinc-400 animate-bounce"
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

export function ChatPanel({ projectId }: { projectId: string }) {
  const { messages, send, sending, streamingContent, loading, error, connected } =
    useChat(projectId)
  const [input, setInput] = useState("")
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false)

  useEffect(() => {
    if (connected) setHasConnectedOnce(true)
  }, [connected])
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streamingContent])

  const handleSend = () => {
    if (!input.trim()) return
    send(input.trim())
    setInput("")
  }

  const visibleError = error && error !== dismissedError ? error : null

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">Team Lead</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {visibleError && (
        <div className="flex items-start gap-2 bg-red-950/30 border-b border-red-800/30 px-4 py-2 text-xs text-red-400">
          <span className="flex-1">{visibleError}</span>
          <button
            onClick={() => setDismissedError(visibleError)}
            className="shrink-0 text-red-500 hover:text-red-300"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Reconnection banner (only after first successful connection) */}
      {hasConnectedOnce && !connected && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 text-xs text-amber-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>Reconnecting to server...</span>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-700" />
          </div>
        ) : (
          <div className="px-4 py-3 space-y-4">
            {messages.length === 0 && !streamingContent && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MessageSquare className="h-8 w-8 text-zinc-800 mb-3" />
                <p className="text-sm text-zinc-600">
                  Describe a feature or bug to get started
                </p>
                <p className="text-xs text-zinc-700 mt-1">
                  Your team will pick up the work automatically
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2.5",
                  msg.role === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                {/* Avatar */}
                {msg.role === "assistant" && (
                  <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-900/60 text-[10px] font-bold text-blue-300 mt-0.5">
                    TL
                  </div>
                )}

                <div
                  className={cn(
                    "flex flex-col max-w-[80%]",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-zinc-800/80 text-zinc-100 rounded-bl-sm"
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <MarkdownMessage content={msg.content} />
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.createdAt && (
                    <span className="mt-1 text-[10px] text-zinc-600 px-1">
                      {formatTime(msg.createdAt)}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {streamingContent && (
              <div className="flex gap-2.5">
                <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-900/60 text-[10px] font-bold text-blue-300 mt-0.5">
                  TL
                </div>
                <div className="flex flex-col items-start max-w-[80%]">
                  <div className="rounded-xl rounded-bl-sm px-3.5 py-2 text-sm bg-zinc-800/80 text-zinc-100 leading-relaxed">
                    {streamingContent === THINKING_SENTINEL ? (
                      <TypingDots />
                    ) : (
                      <MarkdownMessage content={streamingContent + "▍"} />
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border/40">
        <div className="flex gap-2 items-start">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                // Auto-resize
                e.target.style.height = "auto"
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Message team lead..."
              disabled={sending}
              rows={1}
              className={cn(
                "w-full resize-none rounded-lg border border-border/40 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600",
                "focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-zinc-600",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "min-h-[36px] max-h-[120px] leading-relaxed"
              )}
            />
          </div>
          <Button
            size="icon"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="h-[36px] min-h-[36px] w-[36px] flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-zinc-700">
          Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
