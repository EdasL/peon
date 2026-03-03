import { getTemplate } from "@/lib/templates"
import { cn } from "@/lib/utils"
import type { AgentState } from "@/hooks/use-agent-activity"

interface AgentSidebarProps {
  agents: AgentState[]
  loading: boolean
  connected: boolean
  currentToolAction: string | null
  templateId?: string
  feedCount: number
}

function getAgentColor(agentName: string, templateId?: string): string {
  if (templateId) {
    const tmpl = getTemplate(templateId)
    if (tmpl) {
      const match = tmpl.agents.find(
        (a) => a.role.toLowerCase() === agentName.toLowerCase()
      )
      if (match) return match.color
    }
  }
  const colorMap: Record<string, string> = {
    lead: "bg-blue-500",
    "team-lead": "bg-blue-500",
    frontend: "bg-emerald-500",
    backend: "bg-violet-500",
    qa: "bg-amber-500",
    designer: "bg-pink-500",
    mobile: "bg-cyan-500",
  }
  return colorMap[agentName.toLowerCase()] ?? "bg-zinc-500"
}

function StatusPulse({ status }: { status: AgentState["status"] }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full flex-shrink-0",
        status === "working" && "bg-emerald-500 animate-pulse",
        status === "idle" && "bg-zinc-600",
        status === "error" && "bg-red-500"
      )}
    />
  )
}

function AgentCard({
  agent,
  templateId,
  currentToolAction,
}: {
  agent: AgentState
  templateId?: string
  currentToolAction: string | null
}) {
  const initials = agent.name
    .split(/[-_\s]/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2)

  const avatarColor = getAgentColor(agent.name, templateId)

  const displayText =
    agent.activeForm ??
    (agent.status === "working" && currentToolAction ? currentToolAction : null) ??
    agent.currentTask

  const isToolAction =
    agent.status === "working" && currentToolAction != null && !agent.activeForm

  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 transition-colors",
        agent.status === "working"
          ? "border-emerald-800/40 bg-emerald-950/20"
          : agent.status === "error"
            ? "border-red-800/40 bg-red-950/20"
            : "border-border/30 bg-zinc-900/40"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Colored avatar */}
        <div
          className={cn(
            "flex size-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white mt-px",
            avatarColor,
            agent.status !== "working" && "opacity-60"
          )}
        >
          {initials || "?"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusPulse status={agent.status} />
            <span className="text-xs font-medium leading-none text-zinc-200 truncate flex-1 min-w-0">
              {agent.name}
            </span>
            <span
              className={cn(
                "text-[9px] font-semibold uppercase tracking-wider flex-shrink-0",
                agent.status === "working" && "text-emerald-500",
                agent.status === "idle" && "text-zinc-600",
                agent.status === "error" && "text-red-400"
              )}
            >
              {agent.status}
            </span>
          </div>

          {displayText ? (
            <p
              className={cn(
                "mt-1 text-[11px] leading-tight line-clamp-2",
                isToolAction ? "text-cyan-500" : "text-zinc-500"
              )}
            >
              {displayText}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-zinc-700">No active task</p>
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
  feedCount,
}: AgentSidebarProps) {
  const workingCount = agents.filter((a) => a.status === "working").length

  return (
    <aside className="flex h-full w-[220px] flex-shrink-0 flex-col border-r border-border/40 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Agents
        </span>
        <div className="flex items-center gap-2">
          {!connected && (
            <span className="flex items-center gap-1 text-[9px] text-amber-500">
              <span className="inline-block size-1.5 rounded-full bg-amber-500 animate-pulse" />
              offline
            </span>
          )}
          {loading && (
            <span className="text-[9px] text-zinc-700">syncing</span>
          )}
          {connected && !loading && workingCount > 0 && (
            <span className="text-[9px] font-semibold text-emerald-500 tabular-nums">
              {workingCount} active
            </span>
          )}
        </div>
      </div>

      {/* Agent cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {agents.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-[11px] text-zinc-700 leading-relaxed">
              Agents will appear once tasks are created
            </p>
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              templateId={templateId}
              currentToolAction={currentToolAction}
            />
          ))
        )}
      </div>

      {/* Footer: event count */}
      {feedCount > 0 && (
        <div className="border-t border-border/40 px-3 py-2">
          <span className="text-[10px] text-zinc-700 tabular-nums">
            {feedCount} event{feedCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </aside>
  )
}
