import { useRef, useEffect, useCallback, useState, useMemo } from "react"
import type { ActivityEvent } from "@/hooks/use-agent-activity"
import type { TeamMember } from "@/lib/api"
import { getAgentColor, bgToText } from "@/lib/agent-utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface ActivityFeedProps {
  events: ActivityEvent[]
  teamMembers?: TeamMember[]
  templateId?: string
  maxEvents?: number
  /** When true, renders without the outer aside wrapper (parent controls sizing) */
  embedded?: boolean
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  const s = d.getSeconds().toString().padStart(2, "0")
  return `${h}:${m}:${s}`
}

const EVENT_ICONS: Record<string, string> = {
  started: "→",
  completed: "✓",
  task_update: "~",
  status_change: "·",
  tool_use: "⚡",
}

function RichLabel({ text, className }: { text: string; className?: string }) {
  const backtickRe = /`([^`]+)`/
  const match = backtickRe.exec(text)
  if (!match) {
    return <span className={className}>{text}</span>
  }
  const before = text.slice(0, match.index)
  const inner = match[1]
  const after = text.slice(match.index + match[0].length)
  return (
    <span className={className}>
      {before}
      <code className="font-mono text-[10px] text-cyan-300 bg-cyan-950/40 px-0.5 rounded">
        {inner}
      </code>
      {after}
    </span>
  )
}

function MilestoneRow({
  event,
  agentTextColor,
}: {
  event: ActivityEvent
  agentTextColor: string
}) {
  const isCompleted = event.type === "completed"
  return (
    <div className={cn(
      "flex items-start gap-2 px-3 py-1.5 border-l-2",
      isCompleted ? "border-l-emerald-600/60 bg-emerald-950/10" : "border-l-blue-600/60 bg-blue-950/10"
    )}>
      <span className="mt-px flex-shrink-0 font-mono text-[10px] text-zinc-700 tabular-nums w-[54px]">
        {formatTime(event.timestamp)}
      </span>
      <span className={cn("text-[11px] font-mono leading-none mt-px flex-shrink-0", isCompleted ? "text-emerald-500" : "text-blue-400")}>
        {isCompleted ? "✓" : "→"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={cn("text-[10px] font-semibold flex-shrink-0", agentTextColor)}>
            {event.agentName}
          </span>
          <span className={cn("text-[11px] leading-snug font-medium", isCompleted ? "text-emerald-400" : "text-blue-300")}>
            {isCompleted ? "completed" : "started"}{" "}
            <span className="font-mono">{event.taskSubject}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function FeedRow({
  event,
  agentTextColor,
}: {
  event: ActivityEvent
  agentTextColor: string
}) {
  const isToolEnd = event.type === "tool_use" && event.toolPhase === "end"
  const isMilestone = event.type === "started" || event.type === "completed"

  if (isMilestone) {
    return <MilestoneRow event={event} agentTextColor={agentTextColor} />
  }

  const iconColor = isToolEnd ? "text-cyan-700" : (
    event.type === "tool_use" ? "text-cyan-400" :
    event.type === "task_update" ? "text-yellow-400" :
    "text-zinc-500"
  )
  const icon = isToolEnd ? "✓" : (EVENT_ICONS[event.type] ?? "·")

  return (
    <div className="group flex items-start gap-2 px-3 py-1 hover:bg-white/[0.02] transition-colors">
      <span className="mt-px flex-shrink-0 font-mono text-[10px] text-zinc-700 tabular-nums w-[54px]">
        {formatTime(event.timestamp)}
      </span>
      <div className="flex flex-col items-center flex-shrink-0">
        <span className={cn("text-[11px] font-mono leading-none mt-px", iconColor)}>
          {icon}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={cn("text-[10px] font-semibold flex-shrink-0", agentTextColor)}>
            {event.agentName}
          </span>
          <span className="text-[11px] text-zinc-400 leading-snug break-all min-w-0">
            {event.type === "task_update" && (
              <span className="text-zinc-500">{event.detail ?? event.taskSubject}</span>
            )}
            {event.type === "status_change" && (
              <span className="text-zinc-600">{event.detail ?? "status changed"}</span>
            )}
            {event.type === "tool_use" && (
              <RichLabel
                text={event.detail ?? event.taskSubject}
                className={isToolEnd ? "text-zinc-600" : "text-cyan-400"}
              />
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ActivityFeed({ events, teamMembers, templateId, maxEvents = 100, embedded = false }: ActivityFeedProps) {
  const topRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const prevCountRef = useRef(events.length)

  const agentNames = useMemo(() => {
    const names = new Set<string>()
    for (const e of events) names.add(e.agentName)
    return Array.from(names)
  }, [events])

  const filteredEvents = useMemo(() => {
    if (activeFilters.size === 0) return events
    return events.filter((e) => activeFilters.has(e.agentName))
  }, [events, activeFilters])

  const toggleFilter = useCallback((name: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const handleScroll = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
    if (!viewport) return
    setUserScrolled(viewport.scrollTop > 200)
  }, [])

  useEffect(() => {
    if (events.length > prevCountRef.current && !userScrolled) {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    prevCountRef.current = events.length
  }, [events.length, userScrolled])

  const Wrapper = embedded ? "div" : "aside"
  const wrapperClass = embedded
    ? "flex h-full flex-col bg-zinc-950"
    : "flex h-full w-[280px] flex-shrink-0 flex-col border-l border-border/40 bg-zinc-950"

  return (
    <Wrapper className={wrapperClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Activity
        </span>
        {events.length > 0 && (
          <span className="text-[10px] text-zinc-700 tabular-nums">
            {filteredEvents.length !== events.length
              ? `${filteredEvents.length}/${events.length}`
              : events.length}
          </span>
        )}
      </div>

      {/* Agent filter chips */}
      {agentNames.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/20 flex-wrap">
          {agentNames.map((name) => {
            const bgColor = getAgentColor(name, teamMembers, templateId)
            const isActive = activeFilters.size === 0 || activeFilters.has(name)
            return (
              <button
                key={name}
                onClick={() => toggleFilter(name)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-all",
                  isActive
                    ? "bg-zinc-800 text-zinc-300"
                    : "bg-zinc-900/50 text-zinc-700"
                )}
              >
                <span className={cn("size-1.5 rounded-full flex-shrink-0", bgColor, !isActive && "opacity-40")} />
                {name}
              </button>
            )
          })}
        </div>
      )}

      <ScrollArea className="flex-1" ref={scrollAreaRef} onScrollCapture={handleScroll}>
        {filteredEvents.length === 0 ? (
          <div className="flex items-center justify-center py-10 px-4">
            <p className="text-[11px] text-zinc-700 text-center leading-relaxed">
              {events.length === 0
                ? "Tool calls, file changes, and task transitions will appear here"
                : "No events match the selected filters"}
            </p>
          </div>
        ) : (
          <div className="py-1">
            <div ref={topRef} />
            {filteredEvents.map((e) => {
              const bgColor = getAgentColor(e.agentName, teamMembers, templateId)
              const textColor = bgToText(bgColor)
              return <FeedRow key={e.id} event={e} agentTextColor={textColor} />
            })}
            {filteredEvents.length >= maxEvents && (
              <div className="px-3 py-2 text-center border-t border-border/20">
                <span className="text-[10px] text-zinc-700">
                  Showing latest {maxEvents} events
                </span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </Wrapper>
  )
}
