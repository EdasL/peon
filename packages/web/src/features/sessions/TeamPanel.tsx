import { useState, useEffect, useCallback } from "react"
import { useParams } from "react-router-dom"
import { Plus, RefreshCw } from "lucide-react"
import type { TeamMember } from "@/lib/api"
import * as api from "@/lib/api"
import { AddMemberForm } from "@/components/project/AddMemberForm"
import { useOpenClaw } from "@/contexts/OpenClawContext"
import type { GatewayEvent } from "@/lib/openclaw-types"

export type AgentStatus = "working" | "idle" | "error"

interface AgentState {
  status: AgentStatus
  currentAction?: string | null
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "working") {
    return (
      <span
        className="inline-block size-[6px] rounded-full bg-[#22C55E] shrink-0"
        title="Working"
      />
    )
  }
  if (status === "error") {
    return (
      <span
        className="inline-block size-[6px] rounded-full bg-[#EF4444] shrink-0"
        title="Error"
      />
    )
  }
  return (
    <span
      className="inline-block size-[6px] rounded-full border border-[#C8C5BC] shrink-0"
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
  const [teamId, setTeamId] = useState<string | null>(null)
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({})
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)

  const ocContext = useOpenClaw()

  const fetchMembers = useCallback(async () => {
    if (!projectId) return
    try {
      const { teams } = await api.getProjectTeams(projectId)
      const first = teams[0]
      setMembers(first?.members ?? [])
      setTeamId(first?.id ?? null)
    } catch (err) {
      console.error("Failed to fetch team members:", err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

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
          [data.agentId]: { ...prev[data.agentId], status: data.status },
        }))
      } catch {}
    })

    es.addEventListener("agent_activity", (e) => {
      try {
        const data = JSON.parse(e.data) as {
          type: string
          tool?: string
          text?: string
          agentName?: string
        }
        const agentId = data.agentName
        if (!agentId) return

        if (data.type === "tool_start" && data.tool) {
          const label = data.text ?? data.tool
          setAgentStates((prev) => ({
            ...prev,
            [agentId]: { status: "working", currentAction: label },
          }))
        } else if (data.type === "tool_end") {
          setAgentStates((prev) => {
            const existing = prev[agentId]
            if (!existing) return prev
            return { ...prev, [agentId]: { ...existing, currentAction: null } }
          })
        } else if (data.type === "turn_end") {
          setAgentStates((prev) => {
            const existing = prev[agentId]
            if (!existing) return prev
            return { ...prev, [agentId]: { status: "idle", currentAction: null } }
          })
        }
      } catch {}
    })

    return () => es.close()
  }, [projectId])

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

  const handleAddDone = useCallback(() => {
    setShowAddForm(false)
    fetchMembers()
  }, [fetchMembers])

  const getStatus = (member: TeamMember): AgentStatus => {
    const byRole = agentStates[member.roleName.toLowerCase()]
    if (byRole) return byRole.status
    const byId = agentStates[member.id]
    if (byId) return byId.status
    return "idle"
  }

  const getAction = (member: TeamMember): string | null => {
    const byRole = agentStates[member.roleName.toLowerCase()]
    if (byRole?.currentAction) return byRole.currentAction
    const byId = agentStates[member.id]
    if (byId?.currentAction) return byId.currentAction
    return null
  }

  return (
    <div
      className={
        compact ? "flex flex-col max-h-[65vh]" : "h-full flex flex-col min-h-0"
      }
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
          Team
        </span>
      </div>

      <div className={compact ? "overflow-y-auto" : "flex-1 overflow-y-auto"}>
        {showAddForm && teamId && (
          <div className="p-2">
            <AddMemberForm
              teamId={teamId}
              existingColors={members.map((m) => m.color)}
              onDone={handleAddDone}
            />
          </div>
        )}

        {loading && !members.length ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-8 bg-muted rounded-sm animate-pulse" />
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
              const action = getAction(member)
              return (
                <div
                  key={member.id}
                  className="flex items-start gap-2.5 px-3 py-1.5 text-xs"
                >
                  <StatusDot status={status} />
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-mono text-[11px] block">
                      {member.displayName || member.roleName}
                    </span>
                    {action && (
                      <span className="text-[10px] text-muted-foreground truncate block mt-0.5">
                        {action}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-1 px-3 py-2 border-t border-border mt-auto">
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          disabled={!teamId}
          aria-label="Add team member"
          title="Add team member"
          className="bg-transparent border border-border text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-[#C8C5BC] rounded-sm disabled:opacity-40 disabled:cursor-default"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={fetchMembers}
          aria-label="Refresh team"
          title="Refresh team"
          className="bg-transparent border border-border text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-[#C8C5BC] rounded-sm"
        >
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  )
}
