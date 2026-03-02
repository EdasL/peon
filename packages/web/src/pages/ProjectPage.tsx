import { useParams, useNavigate } from "react-router-dom"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { Board } from "@/components/board/Board"
import * as api from "@/lib/api"
import { ArrowLeft } from "lucide-react"

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<api.Project | null>(null)

  useEffect(() => {
    if (id) api.getProjects().then((d) => {
      setProject(d.projects.find((p) => p.id === id) ?? null)
    })
  }, [id])

  if (!id) return null

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold">{project?.name ?? "Loading..."}</h1>
      </header>
      <div className="flex-1 flex min-h-0">
        {/* Kanban dashboard — left side (2/3 width) */}
        <div className="flex-1 min-w-0 overflow-auto">
          <Board teamName={id} onBack={() => navigate("/dashboard")} />
        </div>
        {/* Chat panel — right side (1/3 width) */}
        <div className="w-[380px] flex-shrink-0">
          <ChatPanel projectId={id} />
        </div>
      </div>
    </div>
  )
}
