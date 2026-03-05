/**
 * ContextMeter — Compact progress bar showing context-window token usage.
 *
 * Transitions through green → orange → red as usage crosses warning/critical
 * thresholds. Includes an animated token counter and glow effects.
 */

import { useRef, useEffect, useState, useCallback } from "react"
import { AlertTriangle } from "lucide-react"
import { fmtK } from "@/lib/formatting"
import { AnimatedNumber } from "@/components/ui/AnimatedNumber"
import { useOpenClaw } from "@/contexts/OpenClawContext"
import type { GatewayEvent, Session } from "@/lib/openclaw-types"

const CONTEXT_WARNING_THRESHOLD = 75
const CONTEXT_CRITICAL_THRESHOLD = 90
const DEFAULT_CONTEXT_LIMIT = 200_000

const PROGRESS_BAR_TRANSITION =
  "width 700ms cubic-bezier(0.25, 0.46, 0.45, 0.94), box-shadow 500ms ease-out, background-color 300ms ease-out"

const COLOR_CRITICAL = {
  bar: "bg-red-500",
  glow: "rgba(231, 76, 60, 0.4)",
  growGlow: "rgba(231, 76, 60, 0.6)",
  text: "text-red-500",
} as const

const COLOR_WARNING = {
  bar: "bg-orange-500",
  glow: "rgba(232, 168, 56, 0.4)",
  growGlow: "rgba(232, 168, 56, 0.6)",
  text: "text-orange-500",
} as const

const COLOR_NORMAL = {
  bar: "bg-green-500",
  glow: "rgba(76, 175, 80, 0.3)",
  growGlow: "rgba(76, 175, 80, 0.5)",
  text: "text-muted-foreground",
} as const

interface ContextMeterData {
  contextTokens: number
  contextLimit: number
  model: string | null
  totalCost: number
}

/**
 * Self-contained ContextMeter that fetches its own data from the
 * OpenClaw gateway via RPC and event subscriptions.
 */
export function ContextMeter() {
  const { rpc, subscribe, connectionState } = useOpenClaw()
  const [data, setData] = useState<ContextMeterData>({
    contextTokens: 0,
    contextLimit: DEFAULT_CONTEXT_LIMIT,
    model: null,
    totalCost: 0,
  })

  // Fetch initial session info
  useEffect(() => {
    if (connectionState !== "connected") return
    let cancelled = false

    async function fetchStatus() {
      try {
        const result = (await rpc("sessions.list")) as { sessions?: Session[] } | null
        if (cancelled || !result?.sessions?.length) return
        const main = result.sessions[0]
        const tokens = main.contextTokens ?? main.totalTokens
          ?? (((main.inputTokens ?? 0) + (main.outputTokens ?? 0)) || undefined)
        setData((prev) => ({
          ...prev,
          contextTokens: tokens || prev.contextTokens,
          model: main.model ?? prev.model,
        }))
      } catch {
        /* RPC not available yet — ignore */
      }
    }

    fetchStatus()
    return () => {
      cancelled = true
    }
  }, [connectionState, rpc])

  // Subscribe to live session events
  useEffect(() => {
    return subscribe((msg: GatewayEvent) => {
      if (msg.event === "session.update" || msg.event === "agent.status") {
        const p = msg.payload as Record<string, unknown> | undefined
        if (!p) return
        const tokens = (p.contextTokens as number) ?? (p.totalTokens as number)
          ?? ((((p.inputTokens as number) ?? 0) + ((p.outputTokens as number) ?? 0)) || undefined)
        setData((prev) => ({
          contextTokens: tokens ?? prev.contextTokens,
          contextLimit: (p.contextLimit as number) ?? prev.contextLimit,
          model: (p.model as string) ?? prev.model,
          totalCost: (p.totalCost as number) ?? prev.totalCost,
        }))
      }
    })
  }, [subscribe])

  return <ContextMeterBar used={data.contextTokens} limit={data.contextLimit} />
}

/** Pure display component for the progress bar (testable without context). */
export function ContextMeterBar({ used, limit }: { used: number; limit: number }) {
  const percent = Math.min(100, (used / limit) * 100)
  const [isGrowing, setIsGrowing] = useState(false)
  const prevPercentRef = useRef(percent)

  const handleGrowCheck = useCallback(() => {
    setIsGrowing(percent > prevPercentRef.current)
    prevPercentRef.current = percent
  }, [percent])

  useEffect(handleGrowCheck, [handleGrowCheck])

  const isWarning = percent >= CONTEXT_WARNING_THRESHOLD
  const isCritical = percent >= CONTEXT_CRITICAL_THRESHOLD
  const colors = isCritical ? COLOR_CRITICAL : isWarning ? COLOR_WARNING : COLOR_NORMAL

  const boxShadow = isGrowing
    ? `0 0 8px ${colors.growGlow}, 0 0 4px ${colors.glow}`
    : `0 0 4px ${colors.glow}`

  const tooltipText = `Context: ${fmtK(used)} / ${fmtK(limit)} tokens (${percent.toFixed(0)}%)${
    isCritical
      ? " — CRITICAL: Consider starting a new session"
      : isWarning
        ? " — Warning: Approaching context limit"
        : ""
  }`

  return (
    <div className="flex items-center gap-1.5 cursor-default" title={tooltipText}>
      {(isWarning || isCritical) && (
        <AlertTriangle
          size={10}
          className={`${colors.text} ${isCritical ? "animate-pulse" : ""}`}
        />
      )}

      <div className="w-12 h-1.5 bg-background border border-border/60 overflow-hidden rounded-sm">
        <div
          className={`h-full ${colors.bar}`}
          style={{
            width: `${percent}%`,
            boxShadow,
            transition: PROGRESS_BAR_TRANSITION,
          }}
        />
      </div>

      <AnimatedNumber
        value={used}
        format={fmtK}
        className={`text-[11px] ${colors.text}`}
        duration={700}
      />

      <span className={`text-[8px] uppercase tracking-wider ${colors.text}`}>CTX</span>
    </div>
  )
}
