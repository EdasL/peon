/**
 * OpenClaw context — provides the WS protocol client to all Nerve-style
 * feature components within a project view.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useOpenClawWs, type ConnectionState } from "@/hooks/use-openclaw-ws"
import type { GatewayEvent } from "@/lib/openclaw-types"

type EventHandler = (msg: GatewayEvent) => void

interface OpenClawContextValue {
  connectionState: ConnectionState
  connectError: string
  reconnectAttempt: number
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  subscribe: (handler: EventHandler) => () => void
  disconnect: () => void
}

const OpenClawCtx = createContext<OpenClawContextValue | null>(null)

export function OpenClawProvider({
  projectId,
  children,
}: {
  projectId: string | null
  children: ReactNode
}) {
  const ws = useOpenClawWs(projectId)

  const value = useMemo<OpenClawContextValue>(
    () => ({
      connectionState: ws.connectionState,
      connectError: ws.connectError,
      reconnectAttempt: ws.reconnectAttempt,
      rpc: ws.rpc,
      subscribe: ws.subscribe,
      disconnect: ws.disconnect,
    }),
    [ws.connectionState, ws.connectError, ws.reconnectAttempt, ws.rpc, ws.subscribe, ws.disconnect],
  )

  return <OpenClawCtx.Provider value={value}>{children}</OpenClawCtx.Provider>
}

export function useOpenClaw(): OpenClawContextValue {
  const ctx = useContext(OpenClawCtx)
  if (!ctx) throw new Error("useOpenClaw must be used within OpenClawProvider")
  return ctx
}
