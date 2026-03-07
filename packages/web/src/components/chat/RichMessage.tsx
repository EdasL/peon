import { useState } from "react"
import type { ContentBlock } from "@/lib/api"
import { MarkdownMessage } from "./MarkdownMessage"
import { cn } from "@/lib/utils"
import { ChevronRight, Wrench, Brain, Loader2 } from "lucide-react"

function toolVerb(tool: string): string {
  switch (tool.toLowerCase()) {
    case "read": return "Read"
    case "write": return "Created"
    case "edit":
    case "multiedit":
    case "streplace": return "Edited"
    case "bash":
    case "exec":
    case "shell": return "Ran"
    case "grep": return "Searched"
    case "glob": return "Scanned files"
    case "webbrowser":
    case "webfetch": return "Fetched"
    case "websearch": return "Searched web"
    case "todowrite": return "Updated tasks"
    case "task": return "Launched task"
    case "delegatetoproject": return "Delegated to project team"
    case "createprojecttasks": return "Created tasks"
    case "updatetaskstatus": return "Updated task"
    case "listprojecttasks": return "Listed tasks"
    case "deletetask": return "Deleted task"
    case "checkteamstatus": return "Checked team status"
    case "getteamresult": return "Got team result"
    case "uploaduserfile": return "Shared file"
    case "schedulereminder": return "Scheduled reminder"
    case "cancelreminder": return "Cancelled reminder"
    case "listreminders": return "Listed reminders"
    case "searchextensions": return "Searched extensions"
    case "installextension": return "Installed extension"
    case "getsettingslink":
    case "getsettingslinkfordomain": return "Opened settings"
    case "generateaudio": return "Generated audio"
    case "getchannelhistory": return "Loaded chat history"
    case "askuserquestion": return "Asked question"
    default: return tool
  }
}

function describeToolUse(name: string, input: Record<string, unknown>): string {
  const verb = toolVerb(name)
  const filePath = input.file_path ?? input.path ?? input.filePath
  const command = input.command
  const query = input.pattern ?? input.query ?? input.search_term ?? input.glob_pattern

  switch (name.toLowerCase()) {
    case "delegatetoproject": {
      const task = input.task as string | undefined
      return task ? `Setting up project — ${task.length > 60 ? task.slice(0, 60) + "…" : task}` : "Setting up project with Claude Code team"
    }
    case "createprojecttasks": {
      const tasks = input.tasks as unknown[] | undefined
      return tasks?.length ? `Created ${tasks.length} task${tasks.length > 1 ? "s" : ""} on the board` : "Creating project tasks"
    }
    case "updatetaskstatus": {
      const status = input.status as string | undefined
      return status ? `Moved task to ${status.replace(/_/g, " ")}` : verb
    }
    case "uploaduserfile": {
      const fp = (input.file_path ?? input.path) as string | undefined
      const desc = input.description as string | undefined
      if (desc) return `Shared file — ${desc}`
      if (fp) return `Shared \`${fp}\``
      return "Sharing file"
    }
    case "schedulereminder": {
      const task = input.task as string | undefined
      return task ? `Scheduled — ${task.length > 50 ? task.slice(0, 50) + "…" : task}` : verb
    }
    case "generateaudio": {
      const text = input.text as string | undefined
      return text ? `Generated audio — "${text.length > 40 ? text.slice(0, 40) + "…" : text}"` : verb
    }
    case "searchextensions": {
      const q = input.query as string | undefined
      return q ? `Searched extensions for "${q}"` : verb
    }
    case "installextension": {
      const id = input.id as string | undefined
      return id ? `Installed extension \`${id}\`` : verb
    }
    case "askuserquestion": {
      const question = input.question as string | undefined
      return question ? `Asked — ${question.length > 50 ? question.slice(0, 50) + "…" : question}` : verb
    }
    case "getchannelhistory":
      return "Loaded previous messages"
    case "getsettingslink":
    case "getsettingslinkfordomain": {
      const reason = input.reason as string | undefined
      return reason ? `Opened settings — ${reason}` : verb
    }
  }

  if (typeof filePath === "string") return `${verb} \`${filePath}\``
  if (typeof command === "string") {
    const cmd = String(command).length > 60 ? `${String(command).slice(0, 60)}…` : command
    return `${verb} \`${cmd}\``
  }
  if (typeof query === "string") return `${verb} \`${query}\``
  if (typeof input._description === "string") return input._description as string
  return verb
}

function ToolCallCard({ block }: { block: ContentBlock }) {
  const [open, setOpen] = useState(false)
  const name = block.name ?? "tool"
  const input = block.input ?? {}
  const isLoading = block._loading === true
  const description = describeToolUse(name, input)

  return (
    <div className={cn(
      "my-1.5 rounded-md border overflow-hidden transition-colors",
      isLoading
        ? "border-primary/30 bg-primary/5 animate-pulse"
        : "border-border/50 bg-muted/30"
    )}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 text-primary shrink-0 animate-spin" />
        ) : (
          <ChevronRight className={cn(
            "h-3 w-3 text-muted-foreground shrink-0 transition-transform duration-150",
            open && "rotate-90"
          )} />
        )}
        <Wrench className={cn("h-3 w-3 shrink-0", isLoading ? "text-primary" : "text-muted-foreground")} />
        <span className={cn(
          "text-[11px] font-mono truncate",
          isLoading ? "text-foreground/70" : "text-muted-foreground"
        )}>
          {description}
        </span>
      </button>
      {open && !isLoading && (
        <div className="px-3 py-2 border-t border-border/30 bg-background/50">
          <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all overflow-x-auto max-h-[200px] overflow-y-auto">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function ToolGroupCard({ blocks }: { blocks: ContentBlock[] }) {
  const [open, setOpen] = useState(false)
  const anyLoading = blocks.some((b) => b._loading)

  return (
    <div className={cn(
      "my-1.5 rounded-md border overflow-hidden transition-colors",
      anyLoading
        ? "border-primary/30 bg-primary/5"
        : "border-border/50 bg-muted/30"
    )}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {anyLoading ? (
          <Loader2 className="h-3 w-3 text-primary shrink-0 animate-spin" />
        ) : (
          <ChevronRight className={cn(
            "h-3 w-3 text-muted-foreground shrink-0 transition-transform duration-150",
            open && "rotate-90"
          )} />
        )}
        <Wrench className={cn("h-3 w-3 shrink-0", anyLoading ? "text-primary" : "text-muted-foreground")} />
        <span className="text-[11px] font-mono text-muted-foreground">
          Used {blocks.length} tools
        </span>
      </button>
      {open && (
        <div className="border-t border-border/30">
          {blocks.map((block, i) => (
            <div key={block.id ?? i} className="flex items-center gap-1.5 px-3 py-1 border-b border-border/20 last:border-b-0">
              {block._loading && (
                <Loader2 className="h-2.5 w-2.5 text-primary shrink-0 animate-spin" />
              )}
              <span className="text-[11px] font-mono text-muted-foreground">
                {describeToolUse(block.name ?? "tool", block.input ?? {})}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ThinkingBlock({ block }: { block: ContentBlock }) {
  const [open, setOpen] = useState(false)
  const content = block.thinking ?? block.text ?? ""
  if (!content.trim()) return null

  return (
    <div className="my-1.5 rounded-md border border-border/50 bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <ChevronRight className={cn(
          "h-3 w-3 text-muted-foreground/60 shrink-0 transition-transform duration-150",
          open && "rotate-90"
        )} />
        <Brain className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <span className="text-[11px] text-muted-foreground/60 italic">
          Thought process
        </span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-border/30 bg-background/50 max-h-[300px] overflow-y-auto">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{content}</p>
        </div>
      )}
    </div>
  )
}

interface Segment {
  kind: "text" | "tool" | "tool_group" | "thinking"
  content?: string
  block?: ContentBlock
  blocks?: ContentBlock[]
}

function segmentBlocks(blocks: ContentBlock[]): Segment[] {
  const segments: Segment[] = []
  let toolBuffer: ContentBlock[] = []

  const flushTools = () => {
    if (toolBuffer.length === 0) return
    if (toolBuffer.length === 1) {
      segments.push({ kind: "tool", block: toolBuffer[0] })
    } else {
      segments.push({ kind: "tool_group", blocks: [...toolBuffer] })
    }
    toolBuffer = []
  }

  for (const block of blocks) {
    if (block.type === "tool_use") {
      toolBuffer.push(block)
    } else if (block.type === "tool_result") {
      // tool_result follows tool_use -- skip (tool inputs are more useful)
      continue
    } else {
      flushTools()
      if (block.type === "thinking") {
        segments.push({ kind: "thinking", block })
      } else if (block.type === "text" && block.text?.trim()) {
        segments.push({ kind: "text", content: block.text })
      }
    }
  }
  flushTools()

  return segments
}

export function RichMessage({ blocks }: { blocks: ContentBlock[] }) {
  const segments = segmentBlocks(blocks)

  if (segments.length === 0) return null

  return (
    <div className="space-y-0">
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case "text":
            return <MarkdownMessage key={i} content={seg.content!} />
          case "tool":
            return <ToolCallCard key={seg.block!.id ?? i} block={seg.block!} />
          case "tool_group":
            return <ToolGroupCard key={i} blocks={seg.blocks!} />
          case "thinking":
            return <ThinkingBlock key={i} block={seg.block!} />
          default:
            return null
        }
      })}
    </div>
  )
}
