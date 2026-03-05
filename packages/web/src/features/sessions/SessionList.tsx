import {
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react"
import type { Session, GranularAgentState, GatewayEvent, AgentEventPayload } from "@/lib/openclaw-types"
import { getSessionKey } from "@/lib/openclaw-types"
import { useOpenClaw } from "@/contexts/OpenClawContext"
import { buildSessionTree, flattenTree, getSessionType } from "./sessionTree"
import { SessionNode } from "./SessionNode"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, Plus, RefreshCw } from "lucide-react"
import { SpawnAgentDialog } from "./SpawnAgentDialog"

function SessionSkeletons({ count }: { count: number }) {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  )
}

interface SessionListProps {
  currentSession?: string
  onSelect?: (key: string) => void
  agentName?: string
  compact?: boolean
}

export function SessionList({
  currentSession = "",
  onSelect,
  agentName = "Agent",
  compact = false,
}: SessionListProps) {
  const { rpc, subscribe, connectionState } = useOpenClaw()
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyState, setBusyState] = useState<Record<string, boolean>>({})
  const [agentStatus, setAgentStatus] = useState<Record<string, GranularAgentState>>({})
  const [unreadSessions, setUnreadSessions] = useState<Record<string, boolean>>({})

  const [deleteTarget, setDeleteTarget] = useState<{
    key: string
    label: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({})

  const fetchSessions = useCallback(async () => {
    if (connectionState !== "connected") return
    try {
      const result = (await rpc("sessions.list", {
        activeMinutes: 120,
        limit: 50,
      })) as { sessions?: Session[] }
      setSessions(result.sessions ?? [])
    } catch (err) {
      console.error("Failed to fetch sessions:", err)
    } finally {
      setIsLoading(false)
    }
  }, [rpc, connectionState])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    if (connectionState !== "connected") return

    const unsub = subscribe((msg: GatewayEvent) => {
      const event = msg.event
      const payload = msg.payload as AgentEventPayload | undefined

      if (event === "session.created" || event === "session.updated") {
        fetchSessions()
      }

      if (event === "session.deleted" && payload?.sessionKey) {
        setSessions((prev) =>
          prev.filter((s) => getSessionKey(s) !== payload.sessionKey),
        )
      }

      if (
        (event === "agent.busy" || event === "agent.state") &&
        payload?.sessionKey
      ) {
        const sk = payload.sessionKey
        const busy =
          payload.state === "running" ||
          payload.agentState === "running"

        setBusyState((prev) => {
          if (prev[sk] === busy) return prev
          return { ...prev, [sk]: busy }
        })
      }

      if (event === "agent.status" && payload?.sessionKey) {
        const sk = payload.sessionKey
        const state = payload as unknown as GranularAgentState
        if (state.status) {
          setAgentStatus((prev) => ({ ...prev, [sk]: state }))
        }
      }

      if (
        event === "agent.message" &&
        payload?.sessionKey &&
        payload.sessionKey !== currentSession
      ) {
        setUnreadSessions((prev) => ({
          ...prev,
          [payload.sessionKey!]: true,
        }))
      }

      if (event === "agent.tokens" && payload?.sessionKey) {
        const sk = payload.sessionKey
        setSessions((prev) =>
          prev.map((s) => {
            if (getSessionKey(s) !== sk) return s
            return {
              ...s,
              totalTokens: payload.totalTokens ?? s.totalTokens,
              contextTokens: payload.contextTokens ?? s.contextTokens,
            }
          }),
        )
      }
    })

    return unsub
  }, [subscribe, connectionState, fetchSessions, currentSession])

  const handleSelect = useCallback(
    (key: string) => {
      setUnreadSessions((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      onSelect?.(key)
    },
    [onSelect],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await rpc("sessions.delete", { sessionKey: deleteTarget.key })
      setSessions((prev) =>
        prev.filter((s) => getSessionKey(s) !== deleteTarget.key),
      )
    } catch (err) {
      console.error("Failed to delete session:", err)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, rpc])

  const handleSpawn = useCallback(
    async (opts: {
      task: string
      label?: string
      model: string
      thinking: string
    }) => {
      await rpc("sessions.spawn", opts)
      await fetchSessions()
    },
    [rpc, fetchSessions],
  )

  const handleRename = useCallback(
    async (sessionKey: string, label: string) => {
      try {
        await rpc("sessions.rename", { sessionKey, label })
        setSessions((prev) =>
          prev.map((s) =>
            getSessionKey(s) === sessionKey ? { ...s, label } : s,
          ),
        )
      } catch (err) {
        console.error("Failed to rename session:", err)
      }
    },
    [rpc],
  )

  const handleAbort = useCallback(
    async (sessionKey: string) => {
      try {
        await rpc("sessions.abort", { sessionKey })
        setBusyState((prev) => ({ ...prev, [sessionKey]: false }))
      } catch (err) {
        console.error("Failed to abort session:", err)
      }
    },
    [rpc],
  )

  const startRename = useCallback(
    (sessionKey: string, currentLabel: string) => {
      setRenamingKey(sessionKey)
      setRenameValue(currentLabel)
      setTimeout(() => renameInputRef.current?.focus(), 0)
    },
    [],
  )

  const commitRename = useCallback(async () => {
    if (!renamingKey) return
    const trimmed = renameValue.trim()
    if (trimmed) {
      await handleRename(renamingKey, trimmed)
    }
    setRenamingKey(null)
  }, [renamingKey, renameValue, handleRename])

  const cancelRename = useCallback(() => {
    setRenamingKey(null)
  }, [])

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value)
  }, [])

  const handleToggleExpand = useCallback((key: string) => {
    setExpandedState((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))
  }, [])

  const handleSetDeleteTarget = useCallback(
    (key: string, label: string) => {
      setDeleteTarget({ key, label })
    },
    [],
  )

  const prevPercentsRef = useRef<Record<string, number>>({})
  const prevTokensRef = useRef<Record<string, number>>({})

  const growingSessions = useMemo(() => {
    const result: Record<string, boolean> = {}
    sessions.forEach((s) => {
      const sessionKey = getSessionKey(s)
      const used = s.totalTokens || 0
      const max = s.contextTokens || 200000
      const pct = Math.min(100, Math.round((used / max) * 100))
      const prevPct = prevPercentsRef.current[sessionKey]
      result[sessionKey] = prevPct !== undefined && pct > prevPct
    })
    return result
  }, [sessions])

  useEffect(() => {
    sessions.forEach((s) => {
      const sessionKey = getSessionKey(s)
      const used = s.totalTokens || 0
      const max = s.contextTokens || 200000
      const pct = Math.min(100, Math.round((used / max) * 100))
      prevPercentsRef.current[sessionKey] = pct
      if (used > 0) {
        prevTokensRef.current[sessionKey] = used
      }
    })
  }, [sessions])

  const tree = useMemo(() => buildSessionTree(sessions), [sessions])
  const flatNodes = useMemo(
    () => flattenTree(tree, expandedState),
    [tree, expandedState],
  )

  return (
    <div
      className={
        compact ? "flex flex-col max-h-[65vh]" : "h-full flex flex-col min-h-0"
      }
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
          Agents
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => setSpawnOpen(true)}
            aria-label="Launch subagent"
            title="Launch subagent"
            className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground rounded-sm"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={fetchSessions}
            aria-label="Refresh sessions"
            title="Refresh sessions"
            className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground rounded-sm"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className={compact ? "overflow-y-auto" : "flex-1 overflow-y-auto"}>
        {isLoading && !sessions.length ? (
          <SessionSkeletons count={4} />
        ) : !sessions.length ? (
          <div className="text-muted-foreground px-3 py-2 text-[11px]">
            {connectionState === "connected"
              ? "No active sessions"
              : "Connecting..."}
          </div>
        ) : (
          flatNodes.map((node) => {
            const sessionKey = node.key
            const sessionType = getSessionType(sessionKey)
            const isSubagent = sessionType === "subagent"
            const isCron = sessionType === "cron"
            const isCronRun = sessionType === "cron-run"
            const label =
              node.session.label ||
              (sessionKey === "agent:main:main"
                ? `${agentName} (main)`
                : isCron
                  ? `Cron ${sessionKey.split(":")[3]?.slice(0, 8) || ""}`
                  : isCronRun
                    ? `Run ${sessionKey.split(":").pop()?.slice(0, 8) || ""}`
                    : sessionKey.split(":").pop()?.slice(0, 10) || sessionKey)
            const isGrowing = growingSessions[sessionKey] ?? false
            const running =
              busyState[sessionKey] ||
              node.session.state === "running" ||
              node.session.agentState === "running" ||
              node.session.busy ||
              node.session.processing ||
              node.session.status === "running" ||
              node.session.status === "busy" ||
              (isGrowing && sessionKey.includes("subagent"))
            const isActive = sessionKey === currentSession
            const currentTokens = node.session.totalTokens || 0
            const prevTokens = prevTokensRef.current[sessionKey] || 0
            const displayTokens = Math.max(currentTokens, prevTokens)
            const isExpanded = expandedState[sessionKey] ?? !isCron

            return (
              <SessionNode
                key={sessionKey}
                node={node}
                isActive={isActive}
                isGrowing={isGrowing}
                running={!!running}
                displayTokens={displayTokens}
                label={label}
                isExpanded={isExpanded}
                hasChildren={node.children.length > 0}
                isSubagent={isSubagent}
                isCron={isCron}
                isCronRun={isCronRun}
                isUnread={unreadSessions[sessionKey] ?? false}
                isRenaming={renamingKey === sessionKey}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                agentName={agentName}
                granularStatus={agentStatus[sessionKey]}
                onSelect={handleSelect}
                onToggleExpand={handleToggleExpand}
                onDelete={handleSetDeleteTarget}
                onStartRename={startRename}
                onAbort={handleAbort}
                onRenameChange={handleRenameChange}
                onRenameCommit={commitRename}
                onRenameCancel={cancelRename}
                compact={compact}
              />
            )
          })
        )}
      </div>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
      >
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400 font-mono text-sm tracking-wider uppercase flex items-center gap-2">
              <AlertTriangle size={16} />
              Delete Session
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              This will permanently delete the session and archive its
              transcript.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-background border border-border/60 px-3 py-2 rounded-sm">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                Session:
              </p>
              <p className="text-[12px] text-foreground font-mono">
                {deleteTarget?.label}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono mt-1 break-all">
                {deleteTarget?.key}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="font-mono text-xs"
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SpawnAgentDialog
        open={spawnOpen}
        onOpenChange={setSpawnOpen}
        onSpawn={handleSpawn}
      />
    </div>
  )
}
