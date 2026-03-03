import { useRef, useEffect } from "react"
import type { ActivityEvent } from "@/hooks/use-agent-activity"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface ActivityFeedProps {
  events: ActivityEvent[]
  maxEvents?: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  const s = d.getSeconds().toString().padStart(2, "0")
  return `${h}:${m}:${s}`
}

function EventIcon({ type, toolPhase }: { type: ActivityEvent["type"]; toolPhase?: "start" | "end" }) {
  const base = "text-xs font-mono leading-none select-none"
  switch (type) {
    case "started":
      return <span className={cn(base, "text-blue-400")}>→</span>
    case "completed":
      return <span className={cn(base, "text-emerald-400")}>✓</span>
    case "task_update":
      return <span className={cn(base, "text-yellow-400")}>~</span>
    case "status_change":
      return <span className={cn(base, "text-zinc-400")}>·</span>
    case "tool_use":
      return (
        <span className={cn(base, toolPhase === "end" ? "text-cyan-600" : "text-cyan-400")}>
          {toolPhase === "end" ? "✓" : "⚡"}
        </span>
      )
    default:
      return <span className={cn(base, "text-zinc-500")}>·</span>
  }
}

function FeedRow({ event }: { event: ActivityEvent }) {
  const isToolUse = event.type === "tool_use"

  return (
    <div className="flex items-start gap-2.5 px-3 py-1.5 hover:bg-white/[0.02] transition-colors">
      {/* Timestamp */}
      <span className="mt-px flex-shrink-0 font-mono text-[10px] text-zinc-600 tabular-nums">
        {formatTime(event.timestamp)}
      </span>

      {/* Icon */}
      <span className="mt-px flex-shrink-0 w-3 text-center">
        <EventIcon type={event.type} toolPhase={event.toolPhase} />
      </span>

      {/* Agent name */}
      <span className={cn("flex-shrink-0 text-[11px] font-medium", isToolUse ? "text-cyan-600" : "text-zinc-400")}>
        {event.agentName}
      </span>

      {/* Message */}
      <span className="min-w-0 text-[11px] text-zinc-300 truncate">
        {event.type === "started" && "started"}
        {event.type === "completed" && "completed"}
        {event.type === "task_update" && (event.detail ?? "updated")}
        {event.type === "status_change" && (event.detail ?? "status changed")}
        {event.type === "tool_use" && (
          <span className={event.toolPhase === "end" ? "text-cyan-700" : "text-cyan-300"}>
            {event.taskSubject}
            {event.detail && event.detail !== event.taskSubject && (
              <span className="text-zinc-500"> — {event.detail}</span>
            )}
          </span>
        )}
        {event.type !== "tool_use" && (
          <>{" "}<span className="text-zinc-500 italic">{event.taskSubject}</span></>
        )}
      </span>
    </div>
  )
}

export function ActivityFeed({ events, maxEvents = 100 }: ActivityFeedProps) {
  const topRef = useRef<HTMLDivElement>(null)

  // Scroll to top whenever new events arrive (newest is at top)
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [events.length])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Activity
        </span>
        <span className="text-[10px] text-zinc-600">{events.length} events</span>
      </div>

      <ScrollArea className="flex-1">
        {events.length === 0 ? (
          <div className="flex items-center justify-center py-10 px-3">
            <p className="text-xs text-zinc-600 text-center">
              Waiting for agent activity...
            </p>
          </div>
        ) : (
          <div className="py-1">
            <div ref={topRef} />
            {events.map((e) => (
              <FeedRow key={e.id} event={e} />
            ))}
            {events.length >= maxEvents && (
              <div className="px-3 py-2 text-center border-t border-border/20">
                <span className="text-[10px] text-zinc-600">
                  Showing latest {maxEvents} events
                </span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
