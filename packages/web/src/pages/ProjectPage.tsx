import { useParams, useNavigate } from "react-router-dom"
import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { Board } from "@/components/board/Board"
import { ProvisioningOverlay } from "@/components/project/ProvisioningOverlay"
import * as api from "@/lib/api"
import { ArrowLeft } from "lucide-react"

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

type ProjectStatus = api.Project["status"]

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<api.Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<ProjectStatus>("creating")
  const [provisioning, setProvisioning] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!id) return
    api.getProject(id)
      .then(({ project }) => {
        setProject(project)
        setStatus(project.status)
        setProvisioning(project.status === "creating")
      })
      .finally(() => setLoading(false))
  }, [id])

  // SSE connection for project_status updates while provisioning
  useEffect(() => {
    if (!id || !provisioning) return

    const es = new EventSource(`/api/projects/${id}/chat/stream`, { withCredentials: true })
    eventSourceRef.current = es

    es.addEventListener("project_status", (e) => {
      const data = JSON.parse(e.data) as { status: ProjectStatus }
      setStatus(data.status)
    })

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [id, provisioning])

  const handleProvisioningReady = useCallback(() => {
    setProvisioning(false)
  }, [])

  if (!id) return null
  if (loading) return <ProjectSkeleton />

  if (provisioning) {
    return (
      <ProvisioningOverlay
        projectName={project?.name ?? "your project"}
        status={status}
        onReady={handleProvisioningReady}
        onBack={() => navigate("/dashboard")}
      />
    )
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold">{project?.name ?? "Project not found"}</h1>
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <Board teamName={id} onBack={() => navigate("/dashboard")} />
        </div>
        <div className="w-[380px] flex-shrink-0">
          <ChatPanel projectId={id} />
        </div>
      </div>
    </div>
  )
}
