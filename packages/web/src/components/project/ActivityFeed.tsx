import { useRef, useEffect, useCallback, useState } from "react"
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

const EVENT_COLORS: Record<string, string> = {
  started: "text-blue-400",
  completed: "text-emerald-400",
  task_update: "text-yellow-400",
  status_change: "text-zinc-500",
  tool_use: "text-cyan-400",
}

const EVENT_ICONS: Record<string, string> = {
  started: "→",
  completed: "✓",
  task_update: "~",
  status_change: "·",
  tool_use: "⚡",
}

/**
 * Render a label that may contain a backtick-wrapped path/command.
 * e.g. "Reading `src/App.tsx`" → "Reading " + <mono>src/App.tsx</mono>
 */
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

function FeedRow({ event }: { event: ActivityEvent }) {
  const isToolEnd = event.type === "tool_use" && event.toolPhase === "end"
  const iconColor = isToolEnd ? "text-cyan-700" : (EVENT_COLORS[event.type] ?? "text-zinc-500")
  const icon = isToolEnd ? "✓" : (EVENT_ICONS[event.type] ?? "·")

  return (
    <div className="group flex items-start gap-2 px-3 py-1 hover:bg-white/[0.02] transition-colors">
      {/* Time */}
      <span className="mt-px flex-shrink-0 font-mono text-[10px] text-zinc-700 tabular-nums w-[54px]">
        {formatTime(event.timestamp)}
      </span>

      {/* Icon */}
      <div className="flex flex-col items-center flex-shrink-0">
        <span className={cn("text-[11px] font-mono leading-none mt-px", iconColor)}>
          {icon}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {/* Agent tag */}
          <span
            className={cn(
              "text-[10px] font-semibold flex-shrink-0",
              event.type === "tool_use" ? "text-cyan-700" : "text-zinc-500"
            )}
          >
            {event.agentName}
          </span>

          {/* Message */}
          <span className="text-[11px] text-zinc-400 leading-snug break-all min-w-0">
            {event.type === "started" && (
              <>started <span className="font-mono text-zinc-300">{event.taskSubject}</span></>
            )}
            {event.type === "completed" && (
              <>completed <span className="font-mono text-zinc-300">{event.taskSubject}</span></>
            )}
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

export function ActivityFeed({ events, maxEvents = 100 }: ActivityFeedProps) {
  const topRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)
  const prevCountRef = useRef(events.length)

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

  return (
    <aside className="flex h-full w-[280px] flex-shrink-0 flex-col border-l border-border/40 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Activity
        </span>
        {events.length > 0 && (
          <span className="text-[10px] text-zinc-700 tabular-nums">
            {events.length}
          </span>
        )}
      </div>

      <ScrollArea className="flex-1" ref={scrollAreaRef} onScrollCapture={handleScroll}>
        {events.length === 0 ? (
          <div className="flex items-center justify-center py-10 px-4">
            <p className="text-[11px] text-zinc-700 text-center leading-relaxed">
              Tool calls, file changes, and task transitions will appear here
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
                <span className="text-[10px] text-zinc-700">
                  Showing latest {maxEvents} events
                </span>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  )
}
