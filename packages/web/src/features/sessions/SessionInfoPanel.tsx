import { memo, useState, useRef, useEffect, useCallback } from "react"
import type { Session } from "@/lib/openclaw-types"
import { getSessionKey } from "@/lib/openclaw-types"
import { getSessionType } from "./sessionTree"

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function relativeTime(timestamp: number | string | undefined): string {
  if (!timestamp) return "unknown"
  const ms =
    typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp
  const diff = Date.now() - ms
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function tokenPct(used: number | undefined, max: number | undefined): number {
  if (!used || !max || max === 0) return 0
  return Math.min(100, Math.round((used / max) * 100))
}

function barColor(pct: number): string {
  if (pct >= 80) return "bg-red-500"
  if (pct >= 50) return "bg-orange-400"
  return "bg-green-500"
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[2px]">
      <span className="text-muted-foreground text-[11px] shrink-0">
        {label}
      </span>
      <span className="text-foreground text-[11px] font-medium text-right truncate">
        {value}
      </span>
    </div>
  )
}

interface SessionInfoPanelProps {
  session: Session
  running?: boolean
  children: React.ReactNode
}

export const SessionInfoPanel = memo(function SessionInfoPanel({
  session,
  running: runningProp,
  children,
}: SessionInfoPanelProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const handleEnter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }, [])

  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }, [])

  const [actualModel, setActualModel] = useState<string | null>(null)
  const sessionKey = getSessionKey(session)
  const sessionType = getSessionType(sessionKey)

  useEffect(() => {
    if (!open) return
    if (sessionType === "main") return

    let cancelled = false

    if (sessionType === "cron") {
      const jobIdMatch = sessionKey.match(/:cron:([^:]+)$/)
      if (jobIdMatch) {
        fetch("/api/crons")
          .then((r) => r.json())
          .then(
            (data: {
              ok: boolean
              result?: {
                jobs?: Array<{
                  id: string
                  payload?: { model?: string }
                }>
                details?: {
                  jobs?: Array<{
                    id: string
                    payload?: { model?: string }
                  }>
                }
              }
            }) => {
              if (cancelled || !data.ok) return
              const jobs =
                data.result?.jobs || data.result?.details?.jobs || []
              const job = jobs.find((j) => j.id === jobIdMatch[1])
              if (job?.payload?.model) setActualModel(job.payload.model)
            },
          )
          .catch(() => {})
      }
    } else {
      const parts = sessionKey.split(":")
      const sessionId = parts[parts.length - 1]
      if (sessionId && /^[0-9a-f-]{36}$/.test(sessionId)) {
        fetch(`/api/sessions/${sessionId}/model`)
          .then((r) => r.json())
          .then((data: { ok: boolean; model?: string }) => {
            if (!cancelled && data.ok && data.model)
              setActualModel(data.model)
          })
          .catch(() => {})
      }
    }

    return () => {
      cancelled = true
    }
  }, [open, sessionKey, sessionType])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const model = actualModel ?? session.model ?? "unknown"
  const thinking = session.thinking ?? session.thinkingLevel
  const totalTok = session.totalTokens
  const ctxTok = session.contextTokens ?? 200_000
  const pct = tokenPct(totalTok, ctxTok)
  const barCls = barColor(pct)
  const running =
    runningProp ??
    (session.state === "running" ||
      session.agentState === "running" ||
      session.busy === true ||
      session.processing === true)
  const status = running ? "WORKING" : "IDLE"
  const lastActive = session.updatedAt ?? session.lastActivity

  return (
    <div
      className="relative flex-1 min-w-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div className="cursor-default min-w-0 overflow-hidden">{children}</div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded border border-border bg-card shadow-lg shadow-black/30">
          <div className="px-3 py-2.5 space-y-0.5">
            <InfoRow label="Model" value={model} />

            {thinking && <InfoRow label="Thinking" value={thinking} />}

            <div className="py-[2px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-[11px] shrink-0">
                  Tokens
                </span>
                <span className="text-foreground text-[11px] font-medium text-right">
                  {totalTok != null ? fmtK(totalTok) : "—"} / {fmtK(ctxTok)} (
                  {pct}%)
                </span>
              </div>
              <div className="mt-1 w-full h-1 bg-background border border-border/60 overflow-hidden rounded-sm">
                <div
                  className={`h-full ${barCls}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {(session.inputTokens != null ||
              session.outputTokens != null) && (
              <InfoRow
                label="In / Out"
                value={`${session.inputTokens != null ? fmtK(session.inputTokens) : "—"} / ${session.outputTokens != null ? fmtK(session.outputTokens) : "—"}`}
              />
            )}

            <InfoRow label="Last Active" value={relativeTime(lastActive)} />

            {session.channel && (
              <InfoRow label="Channel" value={session.channel} />
            )}

            <div className="flex items-center justify-between gap-3 py-[2px]">
              <span className="text-muted-foreground text-[11px] shrink-0">
                Status
              </span>
              <span
                className={`text-[11px] font-bold tracking-[1px] uppercase px-1.5 py-0.5 rounded-sm ${
                  running
                    ? "bg-green-500/20 text-green-400"
                    : "bg-muted-foreground/20 text-muted-foreground"
                }`}
              >
                {status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
