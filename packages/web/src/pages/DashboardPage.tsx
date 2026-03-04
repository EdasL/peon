import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthLayout } from "@/components/layout/AuthLayout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Trash2, Loader2, Plus, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import * as api from "@/lib/api"
import type { Team } from "@/lib/api"

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

function statusDot(status: api.Project["status"]) {
  switch (status) {
    case "running":
      return <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Running" />
    case "creating":
      return <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" title="Creating" />
    case "stopped":
      return <span className="inline-block h-2 w-2 rounded-full border border-zinc-500" title="Stopped" />
    case "error":
      return <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="Error" />
    default:
      return <span className="inline-block h-2 w-2 rounded-full border border-zinc-600" />
  }
}

function statusLabel(status: api.Project["status"]) {
  switch (status) {
    case "running":
      return "Running"
    case "creating":
      return "Creating"
    case "stopped":
      return "Stopped"
    case "error":
      return "Error"
    default:
      return status
  }
}

function ProjectCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/30">
      <Skeleton className="h-2 w-2 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-32 mb-1" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  )
}

export function DashboardPage() {
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
    <AuthLayout>
      <main className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-[640px]">
          {/* Section header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-zinc-100">Your Projects</h2>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => navigate("/onboarding")}
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>

          {/* Project list */}
          <div className="space-y-2">
            {loading ? (
              <>
                <ProjectCardSkeleton />
                <ProjectCardSkeleton />
                <ProjectCardSkeleton />
              </>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-zinc-800 mb-4">
                  <FolderOpen className="h-6 w-6 text-zinc-500" />
                </div>
                <p className="text-sm text-zinc-400 mb-1">No projects yet.</p>
                <p className="text-xs text-zinc-600 mb-5">
                  Create your first project.
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
                const agentCount = teams?.[0]?.members?.length ?? 0

                return (
                  <Card
                    key={p.id}
                    className={cn(
                      "cursor-pointer transition-colors relative group px-4 py-3",
                      "hover:border-primary/40 hover:bg-zinc-900/50"
                    )}
                    onClick={() => navigate(`/project/${p.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      {statusDot(p.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-200 truncate">
                          {p.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-zinc-500">
                            {statusLabel(p.status)}
                          </span>
                          {agentCount > 0 && (
                            <span className="text-[11px] text-zinc-600">
                              {agentCount} agent{agentCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] text-zinc-600 shrink-0">
                        {timeAgo(p.updatedAt)}
                      </span>
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
                  </Card>
                )
              })
            )}
          </div>
        </div>

        {/* Delete confirmation dialog */}
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
      </main>
    </AuthLayout>
  )
}
