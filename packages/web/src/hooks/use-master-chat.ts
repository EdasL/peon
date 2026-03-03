import { useState, useEffect, useRef, useCallback } from "react"
import type { MasterChatMessage } from "@/lib/api"
import * as api from "@/lib/api"

const STALE_THRESHOLD_MS = 30_000
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function useMasterChat() {
  const [messages, setMessages] = useState<MasterChatMessage[]>([])
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

      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      const es = new EventSource("/api/chat/stream", {
        withCredentials: true,
      })
      eventSourceRef.current = es

      es.onopen = () => {
        if (cancelledRef.current) return
        backoffRef.current = BACKOFF_INITIAL_MS
        lastEventTimeRef.current = Date.now()
        setConnected(true)
        setError(null)

        if (isReconnect) {
          api
            .getMasterChatHistory()
            .then((d) => {
              if (!cancelledRef.current) setMessages(d.messages)
            })
            .catch(() => {})
          setStreamingContent(null)
        }
      }

      es.onerror = () => {
        if (cancelledRef.current) return
        setConnected(false)
        es.close()
        eventSourceRef.current = null

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
        const msg = JSON.parse(e.data) as MasterChatMessage
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

      es.addEventListener("task_update", markEvent)
      es.addEventListener("agent_activity", markEvent)
    },
    [],
  )

  useEffect(() => {
    cancelledRef.current = false

    setLoading(true)
    api
      .getMasterChatHistory()
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

    connectSSE(false)

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
  }, [connectSSE])

  const send = useCallback(
    async (content: string) => {
      setSending(true)
      setError(null)

      const optimisticId = `optimistic-${Date.now()}`
      const optimisticMsg: MasterChatMessage = {
        id: optimisticId,
        userId: null,
        projectId: null,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMsg])

      try {
        const { message } = await api.sendMasterChatMessage(content)
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) {
            return prev.filter((m) => m.id !== optimisticId)
          }
          return prev.map((m) => (m.id === optimisticId ? message : m))
        })
      } catch (err: unknown) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        const msg = err instanceof Error ? err.message : "Failed to send message"
        setError(msg)
      } finally {
        setSending(false)
      }
    },
    [],
  )

  return { messages, send, sending, streamingContent, loading, error, connected }
}
