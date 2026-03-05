import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/hooks/use-auth"
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
import { ProvisioningOverlay } from "@/components/project/ProvisioningOverlay"
import { ActivityFeed } from "@/components/project/ActivityFeed"
import { useAgentActivity } from "@/hooks/use-agent-activity"
import { OpenClawProvider, useOpenClaw } from "@/contexts/OpenClawContext"
import { TeamPanel } from "@/features/sessions"
import { KanbanPanel } from "@/features/kanban"
import type { Project, TeamMember } from "@/lib/api"
import * as api from "@/lib/api"
import { getTemplate } from "@/lib/templates"
import {
  ArrowLeft,
  AlertCircle,
  MessageSquare,
  LayoutGrid,
  Activity,
  Power,
  Settings,
  LogOut,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react"

function ProjectSkeleton() {
  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b border-border px-4 py-2 flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-sm" />
        <Skeleton className="h-4 w-36" />
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="w-[220px] border-r border-border p-2 space-y-2">
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
      </div>
    </div>
  )
}

type CenterView = "chat" | "board"

function ProjectBody({
  projectId,
  chatDisabled,
  templateId,
  teamMembers,
}: {
  projectId: string
  chatDisabled?: boolean
  templateId?: string
  teamMembers?: TeamMember[]
}) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  const [searchParams, setSearchParams] = useSearchParams()
  const centerView = (searchParams.get("view") as CenterView) || "chat"

  const setCenterView = useCallback(
    (v: CenterView) => setSearchParams({ view: v }, { replace: true }),
    [setSearchParams],
  )

  const templateAgentNames = useMemo(() => {
    if (!templateId) return undefined
    const tmpl = getTemplate(templateId)
    return tmpl?.agents.map((a) => a.role.toLowerCase())
  }, [templateId])

  const { feed, connected: activityConnected } = useAgentActivity(projectId, templateAgentNames)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel: Sessions */}
        {leftOpen && (
          <div className="w-[240px] flex-shrink-0 border-r border-border flex flex-col min-h-0 bg-background">
            <div className="flex-1 min-h-0 overflow-auto">
              <TeamPanel />
            </div>
          </div>
        )}

        {/* Center content area */}
        <div className="flex flex-col flex-1 min-w-0 h-full">
          <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 bg-background flex-shrink-0">
            <button
              onClick={() => setLeftOpen(!leftOpen)}
              className="text-muted-foreground hover:text-foreground p-1 rounded-sm transition-colors mr-1"
              title={leftOpen ? "Close left panel" : "Open left panel"}
            >
              {leftOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            </button>

            <button
              onClick={() => setCenterView("chat")}
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                centerView === "chat"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <MessageSquare className="size-3.5" />
              Chat
            </button>
            <button
              onClick={() => setCenterView("board")}
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                centerView === "board"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="size-3.5" />
              Board
            </button>

            <div className="ml-auto flex items-center gap-1">
              {feed.length > 0 && !rightOpen && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {feed.length}
                </span>
              )}
              <button
                onClick={() => setRightOpen(!rightOpen)}
                className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                  rightOpen
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={rightOpen ? "Close activity panel" : "Open activity panel"}
              >
                <Activity className="size-3.5" />
                {rightOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-w-0 relative">
              <div className={`absolute inset-0 ${centerView === "chat" ? "" : "hidden"}`}>
                <ChatPanel projectId={projectId} disabled={chatDisabled} />
              </div>
              <div className={`absolute inset-0 ${centerView === "board" ? "" : "hidden"}`}>
                <KanbanPanel projectId={projectId} />
              </div>
            </div>

            {/* Right panel: Activity Feed */}
            {rightOpen && (
              <div className="w-[280px] flex-shrink-0 border-l border-border min-h-0">
                <ActivityFeed
                  events={feed}
                  teamMembers={teamMembers}
                  templateId={templateId}
                  embedded
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

const connectionMeta: Record<string, { dot: string; text: string; bg: string; fg: string; pulse?: boolean }> = {
  connected:    { dot: "bg-status-success", text: "Connected",    bg: "bg-status-success/10", fg: "text-status-success-text" },
  connecting:   { dot: "bg-status-warning-text",  text: "Connecting",   bg: "bg-status-warning-bg",  fg: "text-status-warning-text", pulse: true },
  reconnecting: { dot: "bg-status-warning-text",  text: "Reconnecting", bg: "bg-status-warning-bg",  fg: "text-status-warning-text", pulse: true },
}
const offlineMeta = { dot: "bg-destructive", text: "Offline", bg: "bg-destructive/10", fg: "text-destructive" }

function ConnectionBadge() {
  const { connectionState } = useOpenClaw()
  const m = connectionMeta[connectionState] ?? offlineMeta
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${m.bg} ${m.fg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-pulse" : ""}`} />
      {m.text}
    </span>
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
  const [bootStep, setBootStep] = useState<string | null>(null)
  const [setupActivity, setSetupActivity] = useState<string | null>(null)
  const [headerTeamMembers, setHeaderTeamMembers] = useState<TeamMember[]>([])

  useEffect(() => {
    if (!id) return
    api
      .getProject(id)
      .then(({ project }) => {
        setProject(project)
        const ageMs = Date.now() - new Date(project.createdAt).getTime()
        const effectiveStatus =
          project.status === "creating" && ageMs > 3 * 60 * 1000
            ? "initializing"
            : project.status
        setStatus(effectiveStatus)
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!id || !status || status === "error") return
    const intervalMs = (status === "creating" || status === "initializing") ? 3_000 : 30_000
    const interval = setInterval(() => {
      api
        .getProjectStatus(id)
        .then(({ status: s }) => {
          const mapped = s === ("starting" as string) ? "creating" : s
          setStatus(mapped as Project["status"])
        })
        .catch(() => {})
    }, intervalMs)
    return () => clearInterval(interval)
  }, [id, status])

  useEffect(() => {
    if (!id) return
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
    es.addEventListener("boot_progress", (e) => {
      try {
        const data = JSON.parse(e.data) as { step: string; label: string }
        setBootStep(data.step)
      } catch {}
    })
    es.addEventListener("agent_activity", (e) => {
      try {
        const data = JSON.parse(e.data) as { type: string; tool?: string; text?: string; filePath?: string; command?: string }
        if (data.type === "tool_start" && data.tool) {
          const label = data.text ?? data.filePath ?? data.command ?? data.tool
          setSetupActivity(label)
        } else if (data.type === "turn_end") {
          setSetupActivity(null)
        }
      } catch {}
    })
    return () => es.close()
  }, [id])

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

  if (status === "creating" || status === "initializing") {
    return (
      <ProvisioningOverlay
        projectName={project?.name ?? "your project"}
        status={status}
        bootStep={bootStep}
        activityText={setupActivity}
        onReady={handleProvisioningReady}
        onBack={() => navigate("/dashboard")}
      />
    )
  }

  if (status === "error") {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-md">
          <div className="bg-status-error-bg border border-status-error-border rounded-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-destructive">Project failed to start</h2>
                <p className="text-xs text-destructive/80 mt-1">
                  {statusMessage ?? "Check that your API key is valid and try again."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={handleRestart}
                className="bg-destructive hover:bg-destructive/90 text-white border-0"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Restart
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/dashboard")}
                className="text-muted-foreground hover:text-foreground"
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
  const isRunning = status === "running"

  return (
    <OpenClawProvider projectId={isRunning ? id : null}>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {status === "stopped" && (
          <div className="flex items-center gap-2 px-4 py-2 bg-status-warning-bg border-b border-status-warning-border text-status-warning-text text-xs flex-shrink-0">
            <Power className="h-3.5 w-3.5" />
            <span className="flex-1">
              {statusMessage ?? "Container is stopped. Activity data is from the last session."}
            </span>
            <button
              onClick={handleRestart}
              className="px-2 py-0.5 rounded-sm bg-status-warning-border/40 hover:bg-status-warning-border/60 text-status-warning-text font-medium transition-colors cursor-pointer"
            >
              Restart
            </button>
          </div>
        )}

        {/* Header */}
        <header className="flex-shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 bg-background">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <h1 className="font-semibold text-sm text-foreground">
            {project?.name ?? "Project"}
          </h1>

          {isRunning ? (
            <ConnectionBadge />
          ) : status === "stopped" ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-sm bg-muted text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[#C8C5BC]" />
              Stopped
            </span>
          ) : null}

          {headerTeamMembers.length > 0 ? (
            <div className="flex items-center gap-1.5 ml-1">
              {headerTeamMembers.map((m) => (
                <span
                  key={m.id}
                  className={`size-2 rounded-full ${m.color} opacity-70`}
                  title={m.displayName}
                />
              ))}
              <span className="text-[11px] text-muted-foreground">{headerTeamMembers.length} members</span>
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
              <span className="text-[11px] text-muted-foreground">{tmpl.name}</span>
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

        {/* Body: left panel + center + right panel + bottom status bar */}
        <ProjectBody
          projectId={id}
          chatDisabled={status === "stopped"}
          templateId={project?.templateId}
          teamMembers={headerTeamMembers}
        />
      </div>
    </OpenClawProvider>
  )
}
