import { useState, useEffect, useRef, useCallback } from "react"
import type { ChatMessage } from "@/lib/api"
import * as api from "@/lib/api"

export function useChat(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    // Load history
    api.getChatHistory(projectId).then((d) => setMessages(d.messages))

    // Connect SSE
    const es = new EventSource(`/api/projects/${projectId}/chat/stream`)
    es.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data) as ChatMessage
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    })
    eventSourceRef.current = es
    return () => es.close()
  }, [projectId])

  const send = useCallback(async (content: string) => {
    setSending(true)
    try {
      await api.sendChatMessage(projectId, content)
    } finally {
      setSending(false)
    }
  }, [projectId])

  return { messages, send, sending }
}
