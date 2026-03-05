import { useState } from "react"
import { cn } from "@/lib/utils"
import { getAgentColor, getAgentDisplayName } from "@/lib/agent-utils"
import type { AgentState } from "@/hooks/use-agent-activity"
import type { TeamMember } from "@/lib/api"
import * as api from "@/lib/api"
import { useNavigate } from "react-router-dom"
import { Plus, X } from "lucide-react"
import { AddMemberForm } from "./AddMemberForm"

interface AgentSidebarProps {
  agents: AgentState[]
  loading: boolean
  connected: boolean
  currentToolAction: string | null
  templateId?: string
  teamMembers?: TeamMember[]
  teamId?: string | null
  onTeamChange?: () => void
  feedCount: number
}

function StatusPulse({ status }: { status: AgentState["status"] }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full flex-shrink-0",
        status === "working" && "bg-[#22C55E] animate-pulse",
        status === "idle" && "border border-[#C8C5BC]",
        status === "error" && "bg-[#EF4444]"
      )}
    />
  )
}

function AgentCard({
  agent,
  templateId,
  teamMembers,
  currentToolAction,
  memberId,
  teamId,
  onRemove,
}: {
  agent: AgentState
  templateId?: string
  teamMembers?: TeamMember[]
  currentToolAction: string | null
  memberId?: string
  teamId?: string | null
  onRemove?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const displayName = getAgentDisplayName(agent.name, teamMembers)
  const initials = displayName
    .split(/[-_\s]/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2)

  const avatarColor = getAgentColor(agent.name, teamMembers, templateId)

  const displayText =
    agent.activeForm ??
    (agent.status === "working" && currentToolAction ? currentToolAction : null) ??
    agent.currentTask

  const isToolAction =
    agent.status === "working" && currentToolAction != null && !agent.activeForm

  const handleRemoveClick = () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
      return
    }
    onRemove?.()
    setConfirming(false)
  }

  return (
    <div
      className={cn(
        "group rounded-sm border px-2.5 py-2 transition-colors relative",
        agent.status === "working"
          ? "border-emerald-300/60 bg-emerald-50"
          : agent.status === "error"
            ? "border-red-300/60 bg-red-50"
            : "border-border bg-card"
      )}
    >
      {memberId && teamId && onRemove && (
        <button
          onClick={handleRemoveClick}
          className={cn(
            "absolute top-1.5 right-1.5 size-4 rounded-full flex items-center justify-center transition-all",
            confirming
              ? "bg-red-600 text-white opacity-100"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500"
          )}
          title={confirming ? "Click again to confirm removal" : "Remove member"}
        >
          <X className="size-2.5" />
        </button>
      )}

      <div className="flex items-start gap-2">
        <div
          className={cn(
            "flex size-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white mt-px",
            avatarColor,
            agent.status !== "working" && "opacity-60"
          )}
        >
          {initials || "?"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusPulse status={agent.status} />
            <span className="text-xs font-medium leading-none text-foreground truncate flex-1 min-w-0">
              {displayName}
            </span>
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wider flex-shrink-0",
                agent.status === "working" && "text-emerald-600",
                agent.status === "idle" && "text-muted-foreground",
                agent.status === "error" && "text-red-500"
              )}
            >
              {agent.status}
            </span>
          </div>

          {displayText ? (
            <p
              className={cn(
                "mt-1 text-[11px] leading-tight line-clamp-2",
                isToolAction ? "text-foreground/70" : "text-muted-foreground"
              )}
            >
              {displayText}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">No active task</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentSidebar({
  agents,
  loading,
  connected,
  currentToolAction,
  templateId,
  teamMembers,
  teamId,
  onTeamChange,
  feedCount,
}: AgentSidebarProps) {
  const navigate = useNavigate()
  const [showAddForm, setShowAddForm] = useState(false)
  const workingCount = agents.filter((a) => a.status === "working").length
  const hasTeam = (teamMembers && teamMembers.length > 0) || !!templateId

  const handleRemoveMember = async (memberId: string) => {
    if (!teamId) return
    try {
      await api.deleteTeamMember(teamId, memberId)
      onTeamChange?.()
    } catch { /* silent */ }
  }

  const handleAddDone = () => {
    setShowAddForm(false)
    onTeamChange?.()
  }

  const memberMap = new Map(
    (teamMembers ?? []).map((m) => [m.roleName.toLowerCase(), m])
  )

  return (
    <aside className="flex h-full w-[220px] flex-shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Team
        </span>
        <div className="flex items-center gap-2">
          {!connected && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <span className="inline-block size-1.5 rounded-full bg-amber-500 animate-pulse" />
              offline
            </span>
          )}
          {loading && (
            <span className="text-[11px] text-muted-foreground">syncing</span>
          )}
          {connected && !loading && workingCount > 0 && (
            <span className="text-[11px] font-semibold text-emerald-600 tabular-nums">
              {workingCount} active
            </span>
          )}
          {teamId && (
            <button
              onClick={() => setShowAddForm(true)}
              className="size-5 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Add team member"
            >
              <Plus className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Agent cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {showAddForm && teamId && (
          <AddMemberForm
            teamId={teamId}
            existingColors={(teamMembers ?? []).map((m) => m.color)}
            onDone={handleAddDone}
          />
        )}

        {agents.length === 0 && !hasTeam ? (
          <div className="px-2 py-6 text-center space-y-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              No team configured yet
            </p>
            <button
              onClick={() => navigate("/onboarding")}
              className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Set up your team
            </button>
          </div>
        ) : agents.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Agents will appear once tasks are created
            </p>
          </div>
        ) : (
          agents.map((agent) => {
            const member = memberMap.get(agent.name.toLowerCase())
            return (
              <AgentCard
                key={agent.name}
                agent={agent}
                templateId={templateId}
                teamMembers={teamMembers}
                currentToolAction={currentToolAction}
                memberId={member?.id}
                teamId={teamId}
                onRemove={member ? () => handleRemoveMember(member.id) : undefined}
              />
            )
          })
        )}
      </div>

      {/* Footer: event count */}
      {feedCount > 0 && (
        <div className="border-t border-border px-3 py-2">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {feedCount} event{feedCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </aside>
  )
}
