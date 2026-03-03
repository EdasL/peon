import { useParams, useNavigate } from "react-router-dom"
import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { Board } from "@/components/board/Board"
import { AgentDashboard } from "@/components/project/AgentDashboard"
import { ProvisioningOverlay } from "@/components/project/ProvisioningOverlay"
import type { Project } from "@/lib/api"
import * as api from "@/lib/api"
import { getTemplate } from "@/lib/templates"
import { ArrowLeft, AlertCircle, Activity, LayoutGrid, Power } from "lucide-react"

function ProjectSkeleton() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-5 w-40" />
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
        <div className="w-[380px] border-l p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-3/4" />
        </div>
      </div>
    </div>
  )
}

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<Project["status"]>("creating")
  const [mainView, setMainView] = useState<"agents" | "board">("agents")

  useEffect(() => {
    if (!id) return
    api.getProject(id)
      .then(({ project }) => {
        setProject(project)
        setStatus(project.status)
      })
      .finally(() => setLoading(false))
  }, [id])

  // Poll status every 3s only while status is "creating"
  useEffect(() => {
    if (!id || status !== "creating") return

    const interval = setInterval(() => {
      api.getProjectStatus(id)
        .then(({ status: s }) => setStatus(s))
        .catch(() => {})
    }, 3000)

    return () => clearInterval(interval)
  }, [id, status])

  // SSE for real-time project_status updates while creating
  useEffect(() => {
    if (!id || status !== "creating") return

    const es = new EventSource(`/api/projects/${id}/chat/stream`, { withCredentials: true })
    es.addEventListener("project_status", (e) => {
      const data = JSON.parse(e.data) as { status: Project["status"] }
      setStatus(data.status)
    })

    return () => es.close()
  }, [id, status])

  const handleProvisioningReady = useCallback(() => {
    setStatus("running")
  }, [])

  if (!id) return null
  if (loading) return <ProjectSkeleton />

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
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="h-6 w-6" />
          <h2 className="text-lg font-semibold">Project failed to start</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Check that your API key is valid and try again.
        </p>
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {status === "stopped" && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border-b border-amber-800/30 text-amber-400 text-xs">
          <Power className="h-3.5 w-3.5" />
          <span>Container is stopped. Activity data is from the last session.</span>
        </div>
      )}
      <header className="border-b px-4 py-2 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold">{project?.name ?? "Project"}</h1>
        {(() => {
          const tmpl = project?.templateId ? getTemplate(project.templateId) : null
          if (!tmpl) return null
          return (
            <div className="flex items-center gap-1.5 ml-2">
              {tmpl.agents.map((a) => (
                <span
                  key={a.role}
                  className={`size-2 rounded-full ${a.color}`}
                  title={a.role}
                />
              ))}
              <span className="text-xs text-muted-foreground">{tmpl.name}</span>
            </div>
          )
        })()}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={mainView === "agents" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setMainView("agents")}
          >
            <Activity className="size-3.5" />
            Agents
          </Button>
          <Button
            variant={mainView === "board" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setMainView("board")}
          >
            <LayoutGrid className="size-3.5" />
            Board
          </Button>
        </div>
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          {mainView === "agents" ? (
            <AgentDashboard
              projectId={id}
              templateId={project?.templateId}
              onSwitchToBoard={() => setMainView("board")}
            />
          ) : (
            <Board teamName={id} onBack={() => navigate("/dashboard")} />
          )}
        </div>
        <div className="w-[380px] flex-shrink-0">
          <ChatPanel projectId={id} />
        </div>
      </div>
    </div>
  )
}
