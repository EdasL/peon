import { useMemo, useRef, useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { getAgentColor, getAgentDisplayName, bgToText } from "@/lib/agent-utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ActivityEvent } from "@/hooks/use-agent-activity"
import type { TeamMember } from "@/lib/api"
import {
  FileEdit,
  FilePlus,
  Eye,
  Terminal,
  Search,
  Globe,
  ChevronRight,
  FolderOpen,
} from "lucide-react"

interface AgentTimelineProps {
  events: ActivityEvent[]
  teamMembers?: TeamMember[]
  templateId?: string
}

type FileOp = "created" | "edited" | "read"

interface FileAction {
  id: string
  timestamp: number
  agentName: string
  op: FileOp
  detail?: string
}

interface FileEntry {
  filePath: string
  shortPath: string
  directory: string
  fileName: string
  actions: FileAction[]
  lastTouched: number
  highestOp: FileOp
}

interface CommandEntry {
  id: string
  timestamp: number
  agentName: string
  command: string
  detail?: string
}

interface SearchEntry {
  id: string
  timestamp: number
  agentName: string
  detail: string
}

function classifyOp(tool: string): FileOp | null {
  switch (tool.toLowerCase()) {
    case "write":
      return "created"
    case "edit":
    case "multiedit":
      return "edited"
    case "read":
      return "read"
    default:
      return null
  }
}

const OP_PRIORITY: Record<FileOp, number> = { created: 3, edited: 2, read: 1 }

function buildFileEntries(events: ActivityEvent[]): FileEntry[] {
  const map = new Map<string, FileEntry>()

  const chronological = [...events].reverse()
  for (const ev of chronological) {
    if (ev.type !== "tool_use" || ev.toolPhase !== "start") continue
    if (!ev.tool) continue

    const op = classifyOp(ev.tool)
    if (!op) continue

    const path = ev.filePath
    if (!path) continue

    const segments = path.split("/")
    const fileName = segments.at(-1) ?? path
    const shortPath = segments.length > 2 ? segments.slice(-3).join("/") : path
    const directory = segments.length > 1 ? segments.slice(0, -1).join("/") : "."

    let entry = map.get(path)
    if (!entry) {
      entry = {
        filePath: path,
        shortPath,
        directory,
        fileName,
        actions: [],
        lastTouched: ev.timestamp,
        highestOp: op,
      }
      map.set(path, entry)
    }

    entry.actions.push({
      id: ev.id,
      timestamp: ev.timestamp,
      agentName: ev.agentName,
      op,
      detail: ev.detail,
    })

    if (ev.timestamp > entry.lastTouched) entry.lastTouched = ev.timestamp
    if (OP_PRIORITY[op] > OP_PRIORITY[entry.highestOp]) entry.highestOp = op
  }

  return Array.from(map.values()).sort((a, b) => b.lastTouched - a.lastTouched)
}

function buildCommandEntries(events: ActivityEvent[]): CommandEntry[] {
  const entries: CommandEntry[] = []
  const chronological = [...events].reverse()
  for (const ev of chronological) {
    if (ev.type !== "tool_use" || ev.toolPhase !== "start") continue
    if (ev.tool?.toLowerCase() !== "bash") continue

    const cmd = ev.command ?? ev.detail ?? "command"
    entries.push({
      id: ev.id,
      timestamp: ev.timestamp,
      agentName: ev.agentName,
      command: cmd,
      detail: ev.detail,
    })
  }
  return entries.reverse()
}

function buildSearchEntries(events: ActivityEvent[]): SearchEntry[] {
  const entries: SearchEntry[] = []
  const chronological = [...events].reverse()
  for (const ev of chronological) {
    if (ev.type !== "tool_use" || ev.toolPhase !== "start") continue
    const t = ev.tool?.toLowerCase()
    if (t !== "grep" && t !== "glob" && t !== "websearch" && t !== "webfetch") continue

    entries.push({
      id: ev.id,
      timestamp: ev.timestamp,
      agentName: ev.agentName,
      detail: ev.detail ?? ev.tool ?? "search",
    })
  }
  return entries.reverse()
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 5_000) return "just now"
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
}

function formatAbsoluteTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`
}

const OP_STYLES: Record<FileOp, { icon: typeof FileEdit; label: string; color: string; bg: string; border: string }> = {
  created: { icon: FilePlus, label: "Created", color: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-800/40" },
  edited: { icon: FileEdit, label: "Edited", color: "text-amber-400", bg: "bg-amber-950/40", border: "border-amber-800/40" },
  read: { icon: Eye, label: "Read", color: "text-zinc-500", bg: "bg-zinc-900/40", border: "border-zinc-800/40" },
}

function AgentBadge({
  agentName,
  teamMembers,
  templateId,
}: {
  agentName: string
  teamMembers?: TeamMember[]
  templateId?: string
}) {
  const bg = getAgentColor(agentName, teamMembers, templateId)
  const text = bgToText(bg)
  const display = getAgentDisplayName(agentName, teamMembers)
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", "bg-zinc-800/80")}>
      <span className={cn("size-1.5 rounded-full flex-shrink-0", bg)} />
      <span className={text}>{display}</span>
    </span>
  )
}

function FileRow({
  entry,
  teamMembers,
  templateId,
}: {
  entry: FileEntry
  teamMembers?: TeamMember[]
  templateId?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const style = OP_STYLES[entry.highestOp]
  const Icon = style.icon
  const uniqueAgents = [...new Set(entry.actions.map((a) => a.agentName))]
  const writeActions = entry.actions.filter((a) => a.op !== "read")
  const displayActions = writeActions.length > 0 ? writeActions : entry.actions
  const hasMultiple = displayActions.length > 1

  return (
    <div className={cn("border-b border-zinc-800/40 last:border-b-0")}>
      <button
        onClick={() => hasMultiple && setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
          hasMultiple ? "hover:bg-white/[0.02] cursor-pointer" : "cursor-default",
        )}
      >
        <div className={cn("flex items-center justify-center size-6 rounded", style.bg, style.border, "border flex-shrink-0")}>
          <Icon className={cn("size-3.5", style.color)} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-mono text-zinc-200 truncate">{entry.fileName}</span>
            <span className={cn("text-[10px] font-medium uppercase tracking-wide", style.color)}>
              {style.label}
            </span>
            {hasMultiple && (
              <span className="text-[10px] text-zinc-600 tabular-nums">
                x{displayActions.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] text-zinc-600 font-mono truncate">
              {entry.shortPath}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {uniqueAgents.map((name) => (
            <AgentBadge key={name} agentName={name} teamMembers={teamMembers} templateId={templateId} />
          ))}
        </div>

        <span className="text-[10px] text-zinc-600 tabular-nums flex-shrink-0 w-[52px] text-right">
          {formatRelativeTime(entry.lastTouched)}
        </span>

        {hasMultiple && (
          <ChevronRight className={cn(
            "size-3.5 text-zinc-600 flex-shrink-0 transition-transform",
            expanded && "rotate-90",
          )} />
        )}
      </button>

      {expanded && hasMultiple && (
        <div className="pl-11 pr-3 pb-2 space-y-0.5">
          {displayActions.map((action) => {
            const aStyle = OP_STYLES[action.op]
            const AIcon = aStyle.icon
            return (
              <div key={action.id} className="flex items-center gap-2 py-0.5">
                <AIcon className={cn("size-3", aStyle.color, "flex-shrink-0")} />
                <span className={cn("text-[10px]", aStyle.color)}>{aStyle.label}</span>
                <AgentBadge agentName={action.agentName} teamMembers={teamMembers} templateId={templateId} />
                <span className="text-[10px] text-zinc-700 tabular-nums ml-auto">
                  {formatAbsoluteTime(action.timestamp)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CommandRow({
  entry,
  teamMembers,
  templateId,
}: {
  entry: CommandEntry
  teamMembers?: TeamMember[]
  templateId?: string
}) {
  const cmd = entry.command.length > 80 ? `${entry.command.slice(0, 80)}...` : entry.command
  const cleanCmd = cmd.replace(/^Running\s+/, "").replace(/`/g, "")

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 border-b border-zinc-800/40 last:border-b-0">
      <div className="flex items-center justify-center size-6 rounded bg-violet-950/40 border border-violet-800/40 flex-shrink-0">
        <Terminal className="size-3.5 text-violet-400" />
      </div>
      <code className="text-[11px] font-mono text-zinc-400 truncate flex-1 min-w-0">
        {cleanCmd}
      </code>
      <AgentBadge agentName={entry.agentName} teamMembers={teamMembers} templateId={templateId} />
      <span className="text-[10px] text-zinc-600 tabular-nums flex-shrink-0 w-[52px] text-right">
        {formatRelativeTime(entry.timestamp)}
      </span>
    </div>
  )
}

type ViewFilter = "files" | "commands" | "all"

export function AgentTimeline({ events, teamMembers, templateId }: AgentTimelineProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const [userScrolled, setUserScrolled] = useState(false)
  const prevCountRef = useRef(events.length)
  const [viewFilter, setViewFilter] = useState<ViewFilter>("files")
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set())
  const [, setTick] = useState(0)

  // Re-render every 30s to update relative timestamps
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const filteredEvents = useMemo(() => {
    if (agentFilter.size === 0) return events
    return events.filter((e) => agentFilter.has(e.agentName))
  }, [events, agentFilter])

  const fileEntries = useMemo(() => buildFileEntries(filteredEvents), [filteredEvents])
  const commandEntries = useMemo(() => buildCommandEntries(filteredEvents), [filteredEvents])
  const searchEntries = useMemo(() => buildSearchEntries(filteredEvents), [filteredEvents])

  const agentNames = useMemo(() => {
    const names = new Set<string>()
    for (const e of events) names.add(e.agentName)
    return Array.from(names)
  }, [events])

  const toggleAgent = useCallback((name: string) => {
    setAgentFilter((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const handleScroll = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector("[data-slot='scroll-area-viewport']")
    if (!viewport) return
    setUserScrolled(viewport.scrollTop > 100)
  }, [])

  useEffect(() => {
    if (events.length > prevCountRef.current && !userScrolled) {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    prevCountRef.current = events.length
  }, [events.length, userScrolled])

  const editedCount = fileEntries.filter((f) => f.highestOp === "edited" || f.highestOp === "created").length
  const commandCount = commandEntries.length

  const isEmpty = fileEntries.length === 0 && commandEntries.length === 0 && searchEntries.length === 0

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/40 flex-shrink-0">
        <div className="flex items-center gap-1 flex-1">
          {(["files", "commands", "all"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setViewFilter(filter)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                viewFilter === filter
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {filter === "files" && <FolderOpen className="size-3" />}
              {filter === "commands" && <Terminal className="size-3" />}
              {filter === "all" && <Search className="size-3" />}
              {filter === "files" && `Files${editedCount > 0 ? ` (${editedCount})` : ""}`}
              {filter === "commands" && `Commands${commandCount > 0 ? ` (${commandCount})` : ""}`}
              {filter === "all" && "All"}
            </button>
          ))}
        </div>

        {agentNames.length > 1 && (
          <div className="flex items-center gap-1">
            {agentNames.map((name) => {
              const bg = getAgentColor(name, teamMembers, templateId)
              const isActive = agentFilter.size === 0 || agentFilter.has(name)
              return (
                <button
                  key={name}
                  onClick={() => toggleAgent(name)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-all",
                    isActive ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900/50 text-zinc-700",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full flex-shrink-0", bg, !isActive && "opacity-40")} />
                  {getAgentDisplayName(name, teamMembers)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1" ref={scrollAreaRef} onScrollCapture={handleScroll}>
        {isEmpty ? (
          <div className="flex items-center justify-center py-16 px-6">
            <p className="text-xs text-zinc-700 text-center leading-relaxed">
              File changes and commands will appear here as agents work on your project
            </p>
          </div>
        ) : (
          <div>
            <div ref={topRef} />

            {(viewFilter === "files" || viewFilter === "all") && fileEntries.length > 0 && (
              <div>
                {viewFilter === "all" && (
                  <div className="px-3 py-1.5 border-b border-zinc-800/60">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                      Files ({fileEntries.length})
                    </span>
                  </div>
                )}
                {fileEntries.map((entry) => (
                  <FileRow
                    key={entry.filePath}
                    entry={entry}
                    teamMembers={teamMembers}
                    templateId={templateId}
                  />
                ))}
              </div>
            )}

            {(viewFilter === "commands" || viewFilter === "all") && commandEntries.length > 0 && (
              <div>
                {viewFilter === "all" && (
                  <div className="px-3 py-1.5 border-b border-zinc-800/60">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                      Commands ({commandEntries.length})
                    </span>
                  </div>
                )}
                {commandEntries.map((entry) => (
                  <CommandRow
                    key={entry.id}
                    entry={entry}
                    teamMembers={teamMembers}
                    templateId={templateId}
                  />
                ))}
              </div>
            )}

            {viewFilter === "all" && searchEntries.length > 0 && (
              <div>
                <div className="px-3 py-1.5 border-b border-zinc-800/60">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    Searches ({searchEntries.length})
                  </span>
                </div>
                {searchEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2.5 px-3 py-1.5 border-b border-zinc-800/40 last:border-b-0">
                    <div className="flex items-center justify-center size-6 rounded bg-cyan-950/40 border border-cyan-800/40 flex-shrink-0">
                      {entry.detail.toLowerCase().includes("web") || entry.detail.toLowerCase().includes("fetch")
                        ? <Globe className="size-3.5 text-cyan-400" />
                        : <Search className="size-3.5 text-cyan-400" />}
                    </div>
                    <span className="text-[11px] text-zinc-400 truncate flex-1 min-w-0">
                      {entry.detail}
                    </span>
                    <AgentBadge agentName={entry.agentName} teamMembers={teamMembers} templateId={templateId} />
                    <span className="text-[10px] text-zinc-600 tabular-nums flex-shrink-0 w-[52px] text-right">
                      {formatRelativeTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
