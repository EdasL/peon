/**
 * StatusBar — Compact bottom bar showing connection state, model, cost,
 * session count, and context-window usage.
 *
 * Self-contained: fetches its own data via OpenClaw RPC and event subscriptions.
 */

import { useState, useEffect, useCallback } from "react"
import { useOpenClaw } from "@/contexts/OpenClawContext"
import { ContextMeterBar } from "./ContextMeter"
import { fmtCost } from "@/lib/formatting"
import type { GatewayEvent, Session } from "@/lib/openclaw-types"

const DEFAULT_CONTEXT_LIMIT = 200_000

interface StatusData {
  sessionCount: number
  contextTokens: number
  contextLimit: number
  model: string | null
  totalCost: number
}

export function StatusBar() {
  const { connectionState, rpc, subscribe } = useOpenClaw()
  const [data, setData] = useState<StatusData>({
    sessionCount: 0,
    contextTokens: 0,
    contextLimit: DEFAULT_CONTEXT_LIMIT,
    model: null,
    totalCost: 0,
  })

  // Fetch initial session data
  const fetchSessions = useCallback(async () => {
    try {
      const result = (await rpc("sessions.list")) as { sessions?: Session[] } | null
      if (!result?.sessions) return
      const sessions = result.sessions
      const main = sessions[0]
      const tokens =
        (main?.contextTokens ?? main?.totalTokens
          ?? ((main?.inputTokens ?? 0) + (main?.outputTokens ?? 0))) || undefined
      setData((prev) => ({
        sessionCount: sessions.length,
        contextTokens: tokens || prev.contextTokens,
        contextLimit: prev.contextLimit,
        model: main?.model ?? prev.model,
        totalCost: prev.totalCost,
      }))
    } catch {
      /* not connected yet */
    }
  }, [rpc])

  useEffect(() => {
    if (connectionState !== "connected") return
    fetchSessions()
  }, [connectionState, fetchSessions])

  // Subscribe to live updates
  useEffect(() => {
    return subscribe((msg: GatewayEvent) => {
      const p = msg.payload as Record<string, unknown> | undefined
      if (!p) return

      if (msg.event === "session.update" || msg.event === "agent.status") {
        const tokens =
          ((p.contextTokens as number) ?? (p.totalTokens as number)
            ?? (((p.inputTokens as number) ?? 0) + ((p.outputTokens as number) ?? 0))) || undefined
        setData((prev) => ({
          ...prev,
          contextTokens: tokens ?? prev.contextTokens,
          contextLimit: (p.contextLimit as number) ?? prev.contextLimit,
          model: (p.model as string) ?? prev.model,
          totalCost: (p.totalCost as number) ?? prev.totalCost,
        }))
      }

      if (msg.event === "sessions.changed") {
        const sessions = p.sessions as Session[] | undefined
        if (sessions) {
          setData((prev) => ({ ...prev, sessionCount: sessions.length }))
        }
      }

      if (msg.event === "tokens.update") {
        setData((prev) => ({
          ...prev,
          totalCost: (p.totalCost as number) ?? prev.totalCost,
        }))
      }
    })
  }, [subscribe])

  const statusColor =
    connectionState === "connected"
      ? "text-green-500"
      : connectionState === "connecting" || connectionState === "reconnecting"
        ? "text-orange-500 animate-pulse"
        : "text-red-500"

  const statusLabel =
    connectionState === "connected"
      ? "CONNECTED"
      : connectionState === "connecting"
        ? "CONNECTING"
        : connectionState === "reconnecting"
          ? "RECONNECTING"
          : "OFFLINE"

  return (
    <div className="h-6 bg-muted/30 border-t border-border flex items-center px-2 sm:px-3 text-[11px] font-mono uppercase tracking-wide text-muted-foreground shrink-0 select-none">
      <div className="flex items-center gap-0 flex-1 min-w-0 overflow-hidden whitespace-nowrap">
        {/* Connection status */}
        <span className={`flex items-center gap-1.5 ${statusColor} shrink-0`}>
          <span className="text-[8px]" aria-hidden="true">
            ●
          </span>
          <span>{statusLabel}</span>
        </span>

        <span className="text-border mx-2">│</span>

        {/* Session count */}
        <span className="text-foreground/70 shrink-0">{data.sessionCount} SESSIONS</span>

        {/* Model */}
        {data.model && (
          <>
            <span className="text-border mx-2 hidden md:inline">│</span>
            <span className="text-foreground/70 truncate hidden md:inline">{data.model}</span>
          </>
        )}

        {/* Cost */}
        {data.totalCost > 0 && (
          <>
            <span className="text-border mx-2 hidden lg:inline">│</span>
            <span className="text-foreground/70 tabular-nums hidden lg:inline">
              {fmtCost(data.totalCost)}
            </span>
          </>
        )}

        {/* Context Meter */}
        {data.contextTokens > 0 && data.contextLimit > 0 && (
          <>
            <span className="text-border mx-2">│</span>
            <span className="inline-flex shrink-0">
              <ContextMeterBar used={data.contextTokens} limit={data.contextLimit} />
            </span>
          </>
        )}
      </div>
    </div>
  )
}
