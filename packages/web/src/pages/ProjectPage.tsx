import { useParams, useNavigate } from "react-router-dom"
import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useAgentActivity } from "@/hooks/use-agent-activity"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { Board } from "@/components/board/Board"
import { AgentSidebar } from "@/components/project/AgentSidebar"
import { ActivityFeed } from "@/components/project/ActivityFeed"
import { ProvisioningOverlay } from "@/components/project/ProvisioningOverlay"
import type { Project, TeamMember } from "@/lib/api"
import * as api from "@/lib/api"
import { getTemplate } from "@/lib/templates"
import {
  ArrowLeft,
  AlertCircle,
  MessageSquare,
  LayoutGrid,
  Power,
  Settings,
  LogOut,
  RefreshCw,
} from "lucide-react"

function ProjectSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <header className="border-b border-border/40 px-4 py-2 flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-4 w-36" />
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="w-[220px] border-r border-border/40 p-2 space-y-2">
          <Skeleton className="h-3 w-16 mx-1 mt-1" />
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-4 gap-3 mt-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
        <div className="w-[280px] border-l border-border/40 p-2 space-y-2">
          <Skeleton className="h-3 w-16 mx-1 mt-1" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
      </div>
    </div>
  )
}

/** 3-column body — single useAgentActivity call, data passed to sidebars */
function ProjectBody({
  projectId,
  templateId,
  centerView,
  onCenterViewChange,
}: {
  projectId: string
  templateId?: string
  centerView: "board" | "chat"
  onCenterViewChange: (v: "board" | "chat") => void
}) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])

  useEffect(() => {
    api.getProjectTeams(projectId).then(({ teams }) => {
      const first = teams[0]
      if (first?.members.length) setTeamMembers(first.members)
    }).catch(() => {})
  }, [projectId])

  // Prefer DB team member names, fall back to template
  const agentNames = useMemo(() => {
    if (teamMembers.length > 0) {
      return teamMembers.map((m) => m.roleName.toLowerCase())
    }
    if (!templateId) return undefined
    const tmpl = getTemplate(templateId)
    return tmpl?.agents.map((a) => a.role.toLowerCase())
  }, [teamMembers, templateId])

  const { agents, feed, loading, connected, currentToolAction } = useAgentActivity(
    projectId,
    agentNames
  )

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left: Agent sidebar (220px) */}
      <AgentSidebar
        agents={agents}
        loading={loading}
        connected={connected}
        currentToolAction={currentToolAction}
        templateId={templateId}
        teamMembers={teamMembers}
        feedCount={feed.length}
      />

      {/* Center: Board / Chat */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border/40 px-3 py-1.5 bg-zinc-950 flex-shrink-0">
          <button
            onClick={() => onCenterViewChange("board")}
            className={[
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              centerView === "board"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            <LayoutGrid className="size-3.5" />
            Board
          </button>
          <button
            onClick={() => onCenterViewChange("chat")}
            className={[
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              centerView === "chat"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            <MessageSquare className="size-3.5" />
            Chat
          </button>
        </div>

        {/* Both panels always mounted to avoid remount on tab switch */}
        <div className="flex-1 min-h-0 relative">
          <div
            className={[
              "absolute inset-0",
              centerView === "board" ? "block" : "hidden",
            ].join(" ")}
          >
            <Board teamName={projectId} />
          </div>
          <div
            className={[
              "absolute inset-0",
              centerView === "chat" ? "block" : "hidden",
            ].join(" ")}
          >
            <ChatPanel projectId={projectId} />
          </div>
        </div>
      </div>

      {/* Right: Activity feed (280px) */}
      <ActivityFeed events={feed} />
    </div>
  )
}

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const initials =
    user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "?"

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<Project["status"] | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [centerView, setCenterView] = useState<"board" | "chat">("chat")
  const [headerTeamMembers, setHeaderTeamMembers] = useState<TeamMember[]>([])

  useEffect(() => {
    if (!id) return
    api
      .getProject(id)
      .then(({ project }) => {
        setProject(project)
        const ageMs = Date.now() - new Date(project.createdAt).getTime()
        const effectiveStatus =
          project.status === "creating" && ageMs > 2 * 60 * 1000
            ? "running"
            : project.status
        setStatus(effectiveStatus)
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!id || status !== "creating") return
    const interval = setInterval(() => {
      api
        .getProjectStatus(id)
        .then(({ status: s }) => setStatus(s))
        .catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [id, status])

  useEffect(() => {
    if (!id || status !== "creating") return
    const es = new EventSource(`/api/projects/${id}/chat/stream`, {
      withCredentials: true,
    })
    es.addEventListener("project_status", (e) => {
      try {
        const data = JSON.parse(e.data) as { status: Project["status"]; message?: string }
        setStatus(data.status)
        if (data.message) setStatusMessage(data.message)
      } catch {}
    })
    return () => es.close()
  }, [id, status])

  const handleProvisioningReady = useCallback(() => {
    setStatus("running")
  }, [])

  const handleRestart = useCallback(async () => {
    setStatus("creating")
    setStatusMessage(null)
    try {
      const { status: newStatus } = await api.restartProject(id!)
      setStatus(newStatus as Project["status"])
    } catch {
      setStatus("error")
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    api.getProjectTeams(id).then(({ teams }) => {
      const first = teams[0]
      if (first?.members.length) setHeaderTeamMembers(first.members)
    }).catch(() => {})
  }, [id])

  if (!id) return null
  if (loading || status === null) return <ProjectSkeleton />

  if (status === "creating") {
    return (
      <ProvisioningOverlay
        projectName={project?.name ?? "your project"}
        status={status}
        onReady={handleProvisioningReady}
        onBack={() => navigate("/dashboard")}
      />
    )
  }

  if (status === "error") {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-zinc-950 p-6">
        <div className="w-full max-w-md">
          <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-red-300">Project failed to start</h2>
                <p className="text-xs text-red-400/80 mt-1">
                  {statusMessage ?? "Check that your API key is valid and try again."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={handleRestart}
                className="bg-red-600 hover:bg-red-700 text-white border-0"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Restart
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/dashboard")}
                className="text-zinc-400 hover:text-zinc-200"
              >
                Back to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const tmpl = project?.templateId ? getTemplate(project.templateId) : null

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      {status === "stopped" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border-b border-amber-800/30 text-amber-400 text-xs flex-shrink-0">
          <Power className="h-3.5 w-3.5" />
          <span className="flex-1">
            {statusMessage ?? "Container is stopped. Activity data is from the last session."}
          </span>
          <button
            onClick={handleRestart}
            className="px-2 py-0.5 rounded bg-amber-800/50 hover:bg-amber-700/50 text-amber-300 font-medium transition-colors"
          >
            Restart
          </button>
        </div>
      )}

      {/* Header */}
      <header className="flex-shrink-0 border-b border-border/40 px-3 py-2 flex items-center gap-2 bg-zinc-950">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <h1 className="font-semibold text-sm text-zinc-100">
          {project?.name ?? "Project"}
        </h1>

        {status === "running" && (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Running
          </span>
        )}
        {status === "stopped" && (
          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            Stopped
          </span>
        )}

        {headerTeamMembers.length > 0 ? (
          <div className="flex items-center gap-1.5 ml-1">
            {headerTeamMembers.map((m) => (
              <span
                key={m.id}
                className={`size-2 rounded-full ${m.color} opacity-70`}
                title={m.displayName}
              />
            ))}
            <span className="text-[11px] text-zinc-600">{headerTeamMembers.length} members</span>
          </div>
        ) : tmpl ? (
          <div className="flex items-center gap-1.5 ml-1">
            {tmpl.agents.map((a) => (
              <span
                key={a.role}
                className={`size-2 rounded-full ${a.color} opacity-70`}
                title={a.role}
              />
            ))}
            <span className="text-[11px] text-zinc-600">{tmpl.name}</span>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-zinc-700">
                <Avatar size="sm">
                  {user?.avatarUrl && (
                    <AvatarImage src={user.avatarUrl} alt={user.name} />
                  )}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium">{user?.name}</div>
                <div className="text-xs text-muted-foreground">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <Settings />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* 3-column body */}
      <ProjectBody
        projectId={id}
        templateId={project?.templateId}
        centerView={centerView}
        onCenterViewChange={setCenterView}
      />
    </div>
  )
}

