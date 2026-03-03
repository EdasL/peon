import { useState, useEffect, useRef, useCallback } from "react"
import type { ChatMessage } from "@/lib/api"
import * as api from "@/lib/api"

const STALE_THRESHOLD_MS = 30_000
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function useChat(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastEventTimeRef = useRef<number>(0)
  const backoffRef = useRef<number>(BACKOFF_INITIAL_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  const connectSSE = useCallback(
    (isReconnect: boolean) => {
      if (cancelledRef.current) return

      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      const es = new EventSource(`/api/projects/${projectId}/chat/stream`, {
        withCredentials: true,
      })
      eventSourceRef.current = es

      es.onopen = () => {
        if (cancelledRef.current) return
        // Reset backoff on successful open
        backoffRef.current = BACKOFF_INITIAL_MS
        lastEventTimeRef.current = Date.now()
        setConnected(true)
        setError(null)

        if (isReconnect) {
          api
            .getChatHistory(projectId)
            .then((d) => {
              if (!cancelledRef.current) setMessages(d.messages)
            })
            .catch(() => {})
          // Clear any in-progress streaming state that may have been orphaned
          setStreamingContent(null)
        }
      }

      es.onerror = () => {
        if (cancelledRef.current) return
        setConnected(false)
        es.close()
        eventSourceRef.current = null

        // Schedule reconnect with exponential backoff
        clearReconnectTimer()
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS)
        reconnectTimerRef.current = setTimeout(() => {
          if (!cancelledRef.current) connectSSE(true)
        }, delay)
      }

      const markEvent = () => {
        lastEventTimeRef.current = Date.now()
        setConnected(true)
      }

      es.addEventListener("ping", markEvent)

      es.addEventListener("message", (e) => {
        markEvent()
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
        markEvent()
        const { accumulated } = JSON.parse(e.data)
        setStreamingContent(accumulated)
      })

      es.addEventListener("chat_status", (e) => {
        markEvent()
        const { state } = JSON.parse(e.data)
        if (state === "thinking") {
          setStreamingContent("Thinking...")
        }
      })

      // Mark any other event types as activity
      es.addEventListener("task_update", markEvent)
      es.addEventListener("agent_activity", markEvent)
      es.addEventListener("project_status", markEvent)
    },
    [projectId],
  )

  useEffect(() => {
    cancelledRef.current = false

    // Load history
    setLoading(true)
    api
      .getChatHistory(projectId)
      .then((d) => {
        if (!cancelledRef.current) {
          setMessages(d.messages)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelledRef.current) {
          const msg = err instanceof Error ? err.message : "Failed to load chat history"
          setError(msg)
        }
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })

    // Initial SSE connection
    connectSSE(false)

    // Stale-connection detector: if no event in 30s, treat as disconnected and reconnect
    staleCheckRef.current = setInterval(() => {
      if (cancelledRef.current) return
      const elapsed = Date.now() - lastEventTimeRef.current
      if (elapsed > STALE_THRESHOLD_MS && eventSourceRef.current) {
        setConnected(false)
        eventSourceRef.current.close()
        eventSourceRef.current = null
        clearReconnectTimer()
        const delay = backoffRef.current
        backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS)
        reconnectTimerRef.current = setTimeout(() => {
          if (!cancelledRef.current) connectSSE(true)
        }, delay)
      }
    }, STALE_THRESHOLD_MS)

    return () => {
      cancelledRef.current = true
      clearReconnectTimer()
      if (staleCheckRef.current !== null) {
        clearInterval(staleCheckRef.current)
        staleCheckRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [projectId, connectSSE])

  const send = useCallback(
    async (content: string) => {
      setSending(true)
      setError(null)

      // Optimistic insert — show the message immediately
      const optimisticId = `optimistic-${Date.now()}`
      const optimisticMsg: ChatMessage = {
        id: optimisticId,
        projectId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMsg])

      try {
        const { message } = await api.sendChatMessage(projectId, content)
        // Replace optimistic message with server-confirmed one (also dedup if SSE arrived first)
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== optimisticId && m.id !== message.id)
          return [...filtered, message]
        })
      } catch (err: unknown) {
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
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
