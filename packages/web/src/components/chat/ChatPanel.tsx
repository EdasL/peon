import { useState, useRef, useEffect } from "react"
import { useChat } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, MessageSquare, Send, X } from "lucide-react"
import { MarkdownMessage } from "./MarkdownMessage"

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
    <div className="flex flex-col h-full border-l">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-semibold text-sm">Chat with Team Lead</h3>
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              Reconnecting...
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

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {messages.length === 0 && !streamingContent && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Send a message to start working with your team
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <MarkdownMessage content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.createdAt && (
                  <span className="mt-1 text-[10px] text-muted-foreground px-1">
                    {formatTime(msg.createdAt)}
                  </span>
                )}
              </div>
            ))}
            {streamingContent && (
              <div className="flex flex-col items-start">
                <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-muted">
                  <MarkdownMessage content={streamingContent} />
                  <span className="animate-pulse">|</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Describe a feature or bug..."
          disabled={sending || loading}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={sending || loading || !input.trim()}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
