import { useState } from "react"
import { useAgentActivity } from "@/hooks/use-agent-activity"
import { AgentStatusCards } from "./AgentStatusCards"
import { ActivityFeed } from "./ActivityFeed"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Activity } from "lucide-react"

interface AgentDashboardProps {
  projectId: string
  onSwitchToBoard: () => void
}

export function AgentDashboard({ projectId, onSwitchToBoard }: AgentDashboardProps) {
  const { agents, feed, loading } = useAgentActivity(projectId)
  const [view, setView] = useState<"dashboard" | "feed">("dashboard")

  const workingCount = agents.filter((a) => a.status === "working").length

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Sub-header */}
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setView("dashboard")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              view === "dashboard"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Agents
          </button>
          <button
            onClick={() => setView("feed")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              view === "feed"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Activity
            {feed.length > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-700 px-1.5 py-px text-[10px]">
                {feed.length}
              </span>
            )}
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loading && (
            <span className="text-[10px] text-zinc-600">syncing...</span>
          )}
          {!loading && workingCount > 0 && (
            <span className="text-[10px] font-medium text-emerald-500">
              {workingCount} agent{workingCount !== 1 ? "s" : ""} working
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onSwitchToBoard}
            className="h-7 gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <LayoutGrid className="size-3.5" />
            Board
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === "dashboard" ? (
          <div className="h-full overflow-y-auto p-4">
            <div className="mx-auto max-w-2xl space-y-6">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                <StatTile
                  label="Active agents"
                  value={workingCount}
                  accent={workingCount > 0}
                />
                <StatTile label="Events" value={feed.length} />
                <StatTile
                  label="Idle"
                  value={agents.filter((a) => a.status === "idle").length}
                />
              </div>

              {/* Agent cards */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Agent Status
                </h3>
                <AgentStatusCards agents={agents} />
              </section>

              {/* Mini feed preview */}
              {feed.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Recent Activity
                    </h3>
                    <button
                      onClick={() => setView("feed")}
                      className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      View all
                    </button>
                  </div>
                  <div className="rounded-lg border border-border/40 bg-zinc-950/50 overflow-hidden">
                    {feed.slice(0, 5).map((e) => (
                      <MiniEventRow key={e.id} event={e} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full">
            <ActivityFeed events={feed} />
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  accent = false,
}: {
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-emerald-400" : "text-zinc-200"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{label}</p>
    </div>
  )
}

function MiniEventRow({ event }: { event: import("@/hooks/use-agent-activity").ActivityEvent }) {
  const icons: Record<string, string> = {
    started: "→",
    completed: "✓",
    task_update: "~",
    status_change: "·",
  }
  const colors: Record<string, string> = {
    started: "text-blue-400",
    completed: "text-emerald-400",
    task_update: "text-yellow-400",
    status_change: "text-zinc-500",
  }

  const t = new Date(event.timestamp)
  const time = `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 last:border-0">
      <span className="font-mono text-[10px] text-zinc-600 tabular-nums flex-shrink-0">
        {time}
      </span>
      <span className={`text-xs flex-shrink-0 ${colors[event.type] ?? "text-zinc-500"}`}>
        {icons[event.type] ?? "·"}
      </span>
      <span className="text-[11px] text-zinc-400 flex-shrink-0">{event.agentName}</span>
      <span className="text-[11px] text-zinc-300 truncate min-w-0">
        {event.type === "started" ? "started " : event.type === "completed" ? "completed " : ""}
        <span className="text-zinc-500 italic">{event.taskSubject}</span>
      </span>
    </div>
  )
}
