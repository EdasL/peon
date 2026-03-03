import { useState, useEffect, useRef, useCallback } from "react"
import type { ChatMessage } from "@/lib/api"
import * as api from "@/lib/api"

export function useChat(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false

    // Load history
    setLoading(true)
    api
      .getChatHistory(projectId)
      .then((d) => {
        if (!cancelled) {
          setMessages(d.messages)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load chat history"
          setError(msg)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // Connect SSE
    const es = new EventSource(`/api/projects/${projectId}/chat/stream`, { withCredentials: true })

    es.onopen = () => {
      setConnected(true)
      setError(null)
    }

    es.onerror = () => {
      setConnected(false)
    }

    es.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data) as ChatMessage
      if (msg.role === "assistant") {
        setStreamingContent(null)
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    })

    es.addEventListener("chat_delta", (e) => {
      const { accumulated } = JSON.parse(e.data)
      setStreamingContent(accumulated)
    })

    es.addEventListener("chat_status", (e) => {
      const { state } = JSON.parse(e.data)
      if (state === "thinking") {
        setStreamingContent("Thinking...")
      }
    })

    eventSourceRef.current = es

    return () => {
      cancelled = true
      es.close()
    }
  }, [projectId])

  const send = useCallback(
    async (content: string) => {
      setSending(true)
      setError(null)
      try {
        await api.sendChatMessage(projectId, content)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to send message"
        setError(msg)
      } finally {
        setSending(false)
      }
    },
    [projectId],
  )

  return { messages, send, sending, streamingContent, loading, error, connected }
}
