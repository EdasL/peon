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
  started: "\u2192",
  completed: "\u2713",
  task_update: "~",
  status_change: "\u00b7",
  tool_use: "\u26a1",
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
      <code className="font-mono text-[10px] text-foreground bg-muted px-0.5 rounded-sm">
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
      isCompleted ? "border-l-emerald-600/60 bg-emerald-50" : "border-l-primary/40 bg-primary/5"
    )}>
      <span className="mt-px flex-shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums w-[54px]">
        {formatTime(event.timestamp)}
      </span>
      <span className={cn("text-[11px] font-mono leading-none mt-px flex-shrink-0", isCompleted ? "text-emerald-600" : "text-foreground")}>
        {isCompleted ? "\u2713" : "\u2192"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className={cn("text-[10px] font-semibold flex-shrink-0", agentTextColor)}>
            {event.agentName}
          </span>
          <span className={cn("text-[11px] leading-snug font-medium", isCompleted ? "text-emerald-700" : "text-foreground/80")}>
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

  const iconColor = isToolEnd ? "text-muted-foreground" : (
    event.type === "tool_use" ? "text-foreground" :
    event.type === "task_update" ? "text-amber-600" :
    "text-muted-foreground"
  )
  const icon = isToolEnd ? "\u2713" : (EVENT_ICONS[event.type] ?? "\u00b7")

  return (
    <div className="group flex items-start gap-2 px-3 py-1 hover:bg-muted/30 transition-colors">
      <span className="mt-px flex-shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums w-[54px]">
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
          <span className="text-[11px] text-muted-foreground leading-snug break-all min-w-0">
            {event.type === "task_update" && (
              <span className="text-foreground/70">{event.detail ?? event.taskSubject}</span>
            )}
            {event.type === "status_change" && (
              <span className="text-muted-foreground">{event.detail ?? "status changed"}</span>
            )}
            {event.type === "tool_use" && (
              <RichLabel
                text={event.detail ?? event.taskSubject}
                className={isToolEnd ? "text-muted-foreground" : "text-foreground/80"}
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
    ? "flex h-full flex-col bg-card"
    : "flex h-full w-[280px] flex-shrink-0 flex-col border-l border-border bg-card"

  return (
    <Wrapper className={wrapperClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activity
        </span>
        {events.length > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {filteredEvents.length !== events.length
              ? `${filteredEvents.length}/${events.length}`
              : events.length}
          </span>
        )}
      </div>

      {/* Agent filter chips */}
      {agentNames.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/60 flex-wrap">
          {agentNames.map((name) => {
            const bgColor = getAgentColor(name, teamMembers, templateId)
            const isActive = activeFilters.size === 0 || activeFilters.has(name)
            return (
              <button
                key={name}
                onClick={() => toggleFilter(name)}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-all",
                  isActive
                    ? "bg-muted text-foreground"
                    : "bg-muted/50 text-muted-foreground"
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
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
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
              <div className="px-3 py-2 text-center border-t border-border/60">
                <span className="text-[10px] text-muted-foreground">
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
