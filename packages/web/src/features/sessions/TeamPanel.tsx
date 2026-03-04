import { useState, useEffect, useCallback } from "react"
import { useParams } from "react-router-dom"
import { Plus, RefreshCw } from "lucide-react"
import type { TeamMember } from "@/lib/api"
import * as api from "@/lib/api"
import { SpawnAgentDialog } from "./SpawnAgentDialog"
import { useOpenClaw } from "@/contexts/OpenClawContext"
import type { GatewayEvent } from "@/lib/openclaw-types"

export type AgentStatus = "working" | "idle" | "error"

interface AgentState {
  status: AgentStatus
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "working") {
    return (
      <span
        className="inline-block size-2 rounded-full bg-emerald-500 shrink-0"
        title="Working"
      />
    )
  }
  if (status === "error") {
    return (
      <span
        className="inline-block size-2 rounded-full bg-red-500 shrink-0"
        title="Error"
      />
    )
  }
  // idle
  return (
    <span
      className="inline-block size-2 rounded-full border border-emerald-500 shrink-0"
      title="Idle"
    />
  )
}

interface TeamPanelProps {
  compact?: boolean
}

export function TeamPanel({ compact = false }: TeamPanelProps) {
  const { id: projectId } = useParams<{ id: string }>()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const [loading, setLoading] = useState(true)
  const [spawnOpen, setSpawnOpen] = useState(false)

  const ocContext = useOpenClaw()

  const fetchMembers = useCallback(async () => {
    if (!projectId) return
    try {
      const { teams } = await api.getProjectTeams(projectId)
      const first = teams[0]
      if (first?.members.length) {
        setMembers(first.members)
      }
    } catch (err) {
      console.error("Failed to fetch team members:", err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  // Listen for agent_status SSE events
  useEffect(() => {
    if (!projectId) return

    const es = new EventSource(`/api/projects/${projectId}/chat/stream`, {
      withCredentials: true,
    })

    es.addEventListener("agent_status", (e) => {
      try {
        const data = JSON.parse(e.data) as {
          agentId: string
          status: AgentStatus
        }
        setAgentStates((prev) => ({
          ...prev,
          [data.agentId]: { status: data.status },
        }))
      } catch {}
    })

    return () => es.close()
  }, [projectId])

  // Also listen via OpenClaw subscribe for agent.state events
  useEffect(() => {
    if (!ocContext.subscribe || ocContext.connectionState !== "connected") return

    const unsub = ocContext.subscribe((msg: GatewayEvent) => {
      if (msg.event === "agent.status" && msg.payload) {
        const p = msg.payload as { agentId?: string; sessionKey?: string; status?: string }
        const agentId = p.agentId || p.sessionKey
        if (agentId && p.status) {
          setAgentStates((prev) => ({
            ...prev,
            [agentId]: { status: p.status as AgentStatus },
          }))
        }
      }
    })

    return unsub
  }, [ocContext.subscribe, ocContext.connectionState])

  const handleSpawn = useCallback(
    async (opts: { task: string; label?: string; model: string; thinking: string }) => {
      if (ocContext.rpc) {
        await ocContext.rpc("sessions.spawn", opts)
        await fetchMembers()
      }
    },
    [ocContext.rpc, fetchMembers],
  )

  const getStatus = (member: TeamMember): AgentStatus => {
    // Check by roleName (lowercase)
    const byRole = agentStates[member.roleName.toLowerCase()]
    if (byRole) return byRole.status
    // Check by id
    const byId = agentStates[member.id]
    if (byId) return byId.status
    return "idle"
  }

  return (
    <div
      className={
        compact ? "flex flex-col max-h-[65vh]" : "h-full flex flex-col min-h-0"
      }
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground">
          Team
        </span>
      </div>

      <div className={compact ? "overflow-y-auto" : "flex-1 overflow-y-auto"}>
        {loading && !members.length ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-7 bg-zinc-800/50 rounded animate-pulse" />
            ))}
          </div>
        ) : !members.length ? (
          <div className="text-muted-foreground px-3 py-2 text-[11px]">
            No team members
          </div>
        ) : (
          <div className="py-1">
            {members.map((member) => {
              const status = getStatus(member)
              return (
                <div
                  key={member.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-300"
                >
                  <StatusDot status={status} />
                  <span className="truncate font-mono text-[11px]">
                    {member.displayName || member.roleName}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer: [+] and [↻] */}
      <div className="flex items-center justify-end gap-1 px-3 py-2 border-t border-border/60 mt-auto">
        <button
          type="button"
          onClick={() => setSpawnOpen(true)}
          aria-label="Add agent"
          title="Add agent"
          className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground rounded-sm"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={fetchMembers}
          aria-label="Refresh team"
          title="Refresh team"
          className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground rounded-sm"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <SpawnAgentDialog
        open={spawnOpen}
        onOpenChange={setSpawnOpen}
        onSpawn={handleSpawn}
      />
    </div>
  )
}
