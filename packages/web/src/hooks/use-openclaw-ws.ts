/**
 * OpenClaw WebSocket hook — connects to the container's OpenClaw gateway
 * through the Peon gateway's WS proxy at /api/ws?projectId=xxx.
 *
 * The Peon gateway (running in Docker alongside the worker containers)
 * can reach the worker's OpenClaw port via Docker networking and relays
 * messages bidirectionally. It also injects the auth token into the
 * connect handshake so the browser doesn't need the token.
 *
 * Handles OpenClaw protocol v3: challenge/connect handshake, JSON-RPC,
 * event dispatch, and auto-reconnect with exponential backoff.
 */

import { useRef, useCallback, useState, useEffect } from "react"
import type { GatewayMessage, GatewayEvent, GatewayResponse } from "@/lib/openclaw-types"

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting"

interface PendingReq {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

type EventHandler = (msg: GatewayEvent) => void

const RECONNECT_BASE_DELAY = 1000
const RECONNECT_MAX_DELAY = 30000
const RECONNECT_MAX_ATTEMPTS = 50
const RPC_TIMEOUT_MS = 30000
const INSTANCE_ID_KEY = "peon-ws-instance-id"

function getOrCreateInstanceId(): string {
  const fallback = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const existing = sessionStorage.getItem(INSTANCE_ID_KEY)
    if (existing) return existing
    sessionStorage.setItem(INSTANCE_ID_KEY, fallback)
    return fallback
  } catch {
    return fallback
  }
}

function buildWsUrl(projectId: string): string {
  const loc = window.location
  const proto = loc.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${loc.host}/api/ws?projectId=${encodeURIComponent(projectId)}`
}

export function useOpenClawWs(projectId: string | null) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected")
  const [connectError, setConnectError] = useState("")
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const reqIdRef = useRef(0)
  const pendingRef = useRef<Record<string, PendingReq>>({})
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const connectReqIdRef = useRef<string | null>(null)

  const subscribersRef = useRef<Set<EventHandler>>(new Set())
  const projectIdRef = useRef(projectId)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const intentionalDisconnectRef = useRef(false)
  const hasConnectedRef = useRef(false)
  const instanceIdRef = useRef(getOrCreateInstanceId())
  const connectionGenRef = useRef(0)

  projectIdRef.current = projectId

  function rejectAllPending(reason: Error) {
    for (const id of Object.keys(pendingRef.current)) {
      pendingRef.current[id].reject(reason)
      delete pendingRef.current[id]
    }
    for (const id of Object.keys(timeoutsRef.current)) {
      clearTimeout(timeoutsRef.current[id])
      delete timeoutsRef.current[id]
    }
  }

  function clearReconnect() {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }

  function teardown() {
    intentionalDisconnectRef.current = true
    clearReconnect()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    rejectAllPending(new Error("Disconnected"))
    setConnectionState("disconnected")
  }

  const doConnectRef = useRef<(wsUrl: string, isReconnect: boolean) => void>(null!)

  doConnectRef.current = (wsUrl: string, isReconnect: boolean) => {
    const gen = ++connectionGenRef.current
    if (!isReconnect) setConnectError("")
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    rejectAllPending(new Error("Reconnecting"))
    connectReqIdRef.current = null

    setConnectionState(isReconnect ? "reconnecting" : "connecting")

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      setConnectError("Connection failed: " + errMsg)
      setConnectionState("disconnected")
      return
    }
    wsRef.current = ws

    ws.onmessage = (ev) => {
      let msg: GatewayMessage
      try { msg = JSON.parse(ev.data) as GatewayMessage } catch { return }

      // OpenClaw protocol: on challenge, send connect request
      if (msg.type === "event" && msg.event === "connect.challenge") {
        const id = String(++reqIdRef.current)
        connectReqIdRef.current = id
        ws.send(JSON.stringify({
          type: "req", id, method: "connect",
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: {
              id: "webchat-ui",
              version: "0.1.0",
              platform: "web",
              mode: "webchat",
              instanceId: instanceIdRef.current,
            },
            role: "operator",
            scopes: ["operator.admin", "operator.read", "operator.write"],
            caps: ["tool-events"],
          },
        }))
        for (const handler of subscribersRef.current) {
          try { handler(msg) } catch { /* ignore */ }
        }
        return
      }

      // Handle connect response
      if (msg.type === "res") {
        const response = msg as GatewayResponse
        if (response.id === connectReqIdRef.current) {
          connectReqIdRef.current = null
          if (response.ok) {
            reconnectAttemptRef.current = 0
            hasConnectedRef.current = true
            setReconnectAttempt(0)
            setConnectError("")
            setConnectionState("connected")
          } else {
            const errMsg = "Auth failed: " + (response.error?.message || "unknown")
            setConnectError(errMsg)
            setConnectionState("disconnected")
            ws.close()
          }
          return
        }
        const p = pendingRef.current[response.id]
        if (p) {
          delete pendingRef.current[response.id]
          const tid = timeoutsRef.current[response.id]
          if (tid) { clearTimeout(tid); delete timeoutsRef.current[response.id] }
          if (response.ok) p.resolve(response.payload)
          else p.reject(new Error(response.error?.message || "request failed"))
        }
        return
      }

      if (msg.type === "event") {
        for (const handler of subscribersRef.current) {
          try { handler(msg as GatewayEvent) } catch { /* ignore */ }
        }
      }
    }

    ws.onerror = () => {
      if (!isReconnect) setConnectError("WebSocket error")
    }

    ws.onclose = () => {
      rejectAllPending(new Error("WebSocket disconnected"))
      if (gen !== connectionGenRef.current) return
      if (intentionalDisconnectRef.current || !hasConnectedRef.current) {
        setConnectionState("disconnected")
        return
      }

      const attempt = ++reconnectAttemptRef.current
      setReconnectAttempt(attempt)

      if (attempt > RECONNECT_MAX_ATTEMPTS) {
        setConnectError(`Reconnect failed after ${RECONNECT_MAX_ATTEMPTS} attempts`)
        setConnectionState("disconnected")
        return
      }

      const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(1.5, attempt - 1) + Math.random() * 500,
        RECONNECT_MAX_DELAY,
      )
      setConnectionState("reconnecting")

      reconnectTimeoutRef.current = setTimeout(() => {
        if (intentionalDisconnectRef.current || !projectIdRef.current) return
        doConnectRef.current(buildWsUrl(projectIdRef.current), true)
      }, delay)
    }
  }

  const subscribe = useCallback((handler: EventHandler) => {
    subscribersRef.current.add(handler)
    return () => { subscribersRef.current.delete(handler) }
  }, [])

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("Not connected"))
      const id = String(++reqIdRef.current)
      pendingRef.current[id] = { resolve, reject }
      ws.send(JSON.stringify({ type: "req", id, method, params }))
      timeoutsRef.current[id] = setTimeout(() => {
        if (pendingRef.current[id]) {
          delete pendingRef.current[id]
          delete timeoutsRef.current[id]
          reject(new Error("Timeout"))
        }
      }, RPC_TIMEOUT_MS)
    })
  }, [])

  const disconnect = useCallback(() => { teardown() }, [])

  // Auto-connect when projectId changes
  useEffect(() => {
    if (!projectId) {
      teardown()
      return
    }

    intentionalDisconnectRef.current = false
    hasConnectedRef.current = false
    reconnectAttemptRef.current = 0
    setReconnectAttempt(0)

    const wsUrl = buildWsUrl(projectId)
    doConnectRef.current(wsUrl, false)

    return () => { teardown() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return { connectionState, connectError, reconnectAttempt, rpc, subscribe, disconnect }
}
