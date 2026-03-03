import { useEffect, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AuthLayout } from "@/components/layout/AuthLayout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Trash2,
  Loader2,
  Send,
  Plus,
  FolderOpen,
  Bot,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react"
import { MarkdownMessage } from "@/components/chat/MarkdownMessage"
import { useMasterChat } from "@/hooks/use-master-chat"
import { cn } from "@/lib/utils"
import * as api from "@/lib/api"
import { getTemplate } from "@/lib/templates"
import type { Team, MasterChatMessage } from "@/lib/api"

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return "Just now"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function statusColor(status: api.Project["status"]): string {
  switch (status) {
    case "running":
      return "bg-emerald-600 text-white hover:bg-emerald-600"
    case "creating":
      return "bg-amber-500 text-white hover:bg-amber-500"
    case "error":
      return "bg-red-600 text-white hover:bg-red-600"
    default:
      return ""
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  } catch {
    return ""
  }
}

function MasterChatPanel() {
  const { messages, send, sending, streamingContent, loading, error, connected } =
    useMasterChat()
  const [input, setInput] = useState("")
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (connected) setHasConnectedOnce(true)
  }, [connected])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streamingContent])

  const handleSend = () => {
    if (!input.trim()) return
    send(input.trim())
    setInput("")
  }

  const visibleError = error && error !== dismissedError ? error : null

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-lg border border-border/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-blue-600/20">
            <Bot className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-zinc-100">Peon</h3>
            <p className="text-[10px] text-zinc-500 leading-tight">Orchestrator</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {connected ? (
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            </span>
          )}
        </div>
      </div>

      {visibleError && (
        <div className="flex items-start gap-2 bg-red-950/30 border-b border-red-800/30 px-4 py-2 text-xs text-red-400">
          <span className="flex-1">{visibleError}</span>
          <button
            onClick={() => setDismissedError(visibleError)}
            className="shrink-0 text-red-500 hover:text-red-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {hasConnectedOnce && !connected && (
        <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 text-xs text-amber-400">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>Reconnecting...</span>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-700" />
          </div>
        ) : (
          <div className="px-4 py-3 space-y-4">
            {messages.length === 0 && !streamingContent && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Bot className="h-10 w-10 text-zinc-800 mb-3" />
                <p className="text-sm text-zinc-500 font-medium">
                  Talk to your orchestrator
                </p>
                <p className="text-xs text-zinc-600 mt-1 max-w-[260px]">
                  Manage projects, get status updates, assign work, or start something new.
                </p>
              </div>
            )}
            {messages.map((msg: MasterChatMessage) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2.5",
                  msg.role === "user" ? "flex-row-reverse" : "flex-row"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-[10px] font-bold text-blue-400 mt-0.5">
                    <Bot className="h-3 w-3" />
                  </div>
                )}
                <div
                  className={cn(
                    "flex flex-col max-w-[80%]",
                    msg.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2 text-sm leading-relaxed",
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-zinc-800/80 text-zinc-100 rounded-bl-sm"
                    )}
                  >
                    {msg.role === "assistant" ? (
                      <MarkdownMessage content={msg.content} />
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.createdAt && (
                    <span className="mt-1 text-[10px] text-zinc-600 px-1">
                      {formatTime(msg.createdAt)}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {streamingContent && (
              <div className="flex gap-2.5">
                <div className="flex size-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-[10px] font-bold text-blue-400 mt-0.5">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="flex flex-col items-start max-w-[80%]">
                  <div className="rounded-xl rounded-bl-sm px-3.5 py-2 text-sm bg-zinc-800/80 text-zinc-100 leading-relaxed">
                    <MarkdownMessage content={streamingContent + "▍"} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border/40">
        <div className="flex gap-2 items-start">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = "auto"
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Message orchestrator..."
              disabled={sending}
              rows={1}
              className={cn(
                "w-full resize-none rounded-lg border border-border/40 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600",
                "focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-zinc-600",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "min-h-[36px] max-h-[120px] leading-relaxed"
              )}
            />
          </div>
          <Button
            size="icon"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="h-[36px] min-h-[36px] w-[36px] flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-zinc-700">
          Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

function ProjectCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/30">
      <Skeleton className="h-4 w-4 rounded" />
      <div className="flex-1">
        <Skeleton className="h-4 w-28 mb-1" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full" />
    </div>
  )
}

function ProjectsSidebar() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<api.Project[]>([])
  const [projectTeams, setProjectTeams] = useState<Map<string, Team[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    api.getProjects()
      .then(async (d) => {
        setProjects(d.projects)
        const entries = await Promise.all(
          d.projects.map(async (p) => {
            try {
              const { teams } = await api.getProjectTeams(p.id)
              return [p.id, teams] as [string, Team[]]
            } catch {
              return [p.id, []] as [string, Team[]]
            }
          })
        )
        setProjectTeams(new Map(entries))
      })
      .finally(() => setLoading(false))

    const interval = setInterval(() => {
      api.getProjects()
        .then((d) => setProjects(d.projects))
        .catch(() => {})
    }, 10_000)

    return () => clearInterval(interval)
  }, [])

  const handleDelete = async () => {
    if (!deletingId) return
    setDeleteLoading(true)
    try {
      await api.deleteProject(deletingId)
      setProjects((prev) => prev.filter((p) => p.id !== deletingId))
      setDeletingId(null)
      toast.success("Project deleted")
    } catch {
      // toast shown by api layer
    } finally {
      setDeleteLoading(false)
    }
  }

  const deletingProject = projects.find((p) => p.id === deletingId)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-1 mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Projects</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
          onClick={() => navigate("/onboarding")}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        {loading ? (
          <>
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-zinc-800 mb-3">
              <FolderOpen className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="text-sm text-zinc-500 mb-1">No projects yet</p>
            <p className="text-xs text-zinc-600 mb-4">
              Create your first project to get started.
            </p>
            <Button
              size="sm"
              onClick={() => navigate("/onboarding")}
              className="h-8 text-xs"
            >
              Create project
            </Button>
          </div>
        ) : (
          projects.map((p) => {
            const teams = projectTeams.get(p.id)
            const memberCount = teams?.[0]?.members?.length ?? 0
            const tmpl = !memberCount ? getTemplate(p.templateId) : null

            return (
              <Card
                key={p.id}
                className={cn(
                  "cursor-pointer transition-colors relative group px-3 py-2.5",
                  "hover:border-primary/40 hover:bg-zinc-900/50",
                  p.status === "running" && "border-emerald-800/40 bg-emerald-950/10"
                )}
                onClick={() => navigate(`/project/${p.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-200 truncate">
                      {p.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant={p.status === "stopped" ? "secondary" : "default"}
                        className={cn("text-[10px] h-4 px-1.5", statusColor(p.status))}
                      >
                        {p.status}
                      </Badge>
                      {memberCount > 0 && (
                        <span className="text-[10px] text-zinc-600">
                          {memberCount} member{memberCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {!memberCount && tmpl && (
                        <span className="text-[10px] text-zinc-600">{tmpl.name}</span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {timeAgo(p.updatedAt)}
                    </p>
                  </div>

                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-zinc-600 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingId(p.id)
                    }}
                    title="Delete project"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {p.status === "running" && (
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-emerald-500/70">
                    <MessageSquare className="h-2.5 w-2.5" />
                    <span>Active</span>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

      <Dialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <span className="font-medium">{deletingProject?.name}</span> and all
              associated data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function DashboardPage() {
  return (
    <AuthLayout>
      <main className="flex-1 flex min-h-0 p-4 gap-4 max-w-7xl mx-auto w-full max-h-[calc(100dvh-4rem)]">
        {/* Master chat — main area */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <MasterChatPanel />
        </div>

        {/* Projects sidebar */}
        <div className="w-[300px] flex-shrink-0 min-h-0 flex flex-col">
          <ProjectsSidebar />
        </div>
      </main>
    </AuthLayout>
  )
}
