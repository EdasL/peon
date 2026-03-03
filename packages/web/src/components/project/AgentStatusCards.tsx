import type { AgentState } from "@/hooks/use-agent-activity"
import { cn } from "@/lib/utils"

interface AgentStatusCardsProps {
  agents: AgentState[]
  /** Current tool action text from a recent tool_start event (within 10s), if any */
  currentToolAction?: string | null
}

function StatusDot({ status }: { status: AgentState["status"] }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full flex-shrink-0",
        status === "working" && "bg-emerald-500 animate-pulse",
        status === "idle" && "bg-zinc-500",
        status === "error" && "bg-red-500"
      )}
    />
  )
}

function AgentCard({ agent, currentToolAction }: { agent: AgentState; currentToolAction?: string | null }) {
  const initials = agent.name
    .split(/[-_\s]/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2)

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/60 px-4 py-3">
      {/* Avatar */}
      <div
        className={cn(
          "flex size-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          agent.status === "working"
            ? "bg-emerald-900/60 text-emerald-300"
            : "bg-zinc-800 text-zinc-400"
        )}
      >
        {initials || "?"}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusDot status={agent.status} />
          <span className="text-sm font-medium leading-none">{agent.name}</span>
          <span
            className={cn(
              "ml-auto text-[10px] font-medium uppercase tracking-wide",
              agent.status === "working" && "text-emerald-400",
              agent.status === "idle" && "text-zinc-500",
              agent.status === "error" && "text-red-400"
            )}
          >
            {agent.status}
          </span>
        </div>

        {(() => {
          const displayText =
            agent.activeForm ??
            (agent.status === "working" && currentToolAction ? currentToolAction : null) ??
            agent.currentTask
          return displayText ? (
            <p className={cn(
              "mt-1.5 truncate text-xs",
              agent.status === "working" && currentToolAction && !agent.activeForm
                ? "text-cyan-500"
                : "text-muted-foreground"
            )}>
              {displayText}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-zinc-600">No active task</p>
          )
        })()}
      </div>
    </div>
  )
}

export function AgentStatusCards({ agents, currentToolAction }: AgentStatusCardsProps) {
  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 px-4 py-5 text-center">
        <p className="text-xs text-muted-foreground">
          No agents active yet. Tasks will appear when agents start working.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {agents.map((agent) => (
        <AgentCard key={agent.name} agent={agent} currentToolAction={currentToolAction} />
      ))}
    </div>
  )
}
