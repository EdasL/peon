import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Trash2, Loader2, X, MessageSquare, FolderOpen, Pencil } from "lucide-react"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { Input } from "@/components/ui/input"
import * as api from "@/lib/api"
import { getTemplate } from "@/lib/templates"

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

function statusBadgeClass(status: api.Project["status"]): string {
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

function ProjectCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<api.Project[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [chatProjectId, setChatProjectId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  useEffect(() => {
    api.getProjects()
      .then((d) => setProjects(d.projects))
      .finally(() => setLoading(false))
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

  const handleRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null)
      return
    }
    try {
      const { project } = await api.updateProject(renamingId, { name: renameValue.trim() })
      setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, name: project.name } : p))
    } catch {
      // toast shown by api layer
    }
    setRenamingId(null)
  }

  const deletingProject = projects.find((p) => p.id === deletingId)
  const chatProject = projects.find((p) => p.id === chatProjectId)

  return (
    <AuthLayout>
      <main className="max-w-5xl mx-auto p-6 w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">My Projects</h2>
          <Button onClick={() => navigate("/onboarding")}>New Project</Button>
        </div>

        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {loading ? (
                <>
                  <ProjectCardSkeleton />
                  <ProjectCardSkeleton />
                  <ProjectCardSkeleton />
                </>
              ) : (
                <>
                  {projects.map((p) => (
                    <Card
                      key={p.id}
                      className={`cursor-pointer hover:border-primary/50 transition-colors relative group ${
                        chatProjectId === p.id ? "border-primary/50" : ""
                      }`}
                      onClick={() => {
                        if (p.status === "running") {
                          setChatProjectId((prev) => (prev === p.id ? null : p.id))
                        } else {
                          navigate(`/project/${p.id}`)
                        }
                      }}
                    >
                      <CardHeader className="pb-2 pr-16">
                        {renamingId === p.id ? (
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename()
                              if (e.key === "Escape") setRenamingId(null)
                            }}
                            onBlur={handleRename}
                            autoFocus
                            className="h-7 text-base font-semibold"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <CardTitle
                            className="text-base"
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              setRenamingId(p.id)
                              setRenameValue(p.name)
                            }}
                          >
                            {p.name}
                          </CardTitle>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={p.status === "stopped" ? "secondary" : "default"}
                            className={statusBadgeClass(p.status)}
                          >
                            {p.status}
                          </Badge>
                          {p.status === "running" && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              Click to chat
                            </span>
                          )}
                        </div>
                        {(() => {
                          const tmpl = getTemplate(p.templateId)
                          if (!tmpl) return null
                          return (
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-muted-foreground">{tmpl.name}</span>
                              <div className="flex items-center gap-1">
                                {tmpl.agents.map((a) => (
                                  <span
                                    key={a.role}
                                    className={`size-1.5 rounded-full ${a.color}`}
                                    title={a.role}
                                  />
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Last active {timeAgo(p.updatedAt)}
                        </p>
                      </CardContent>
                      {/* Rename + delete buttons */}
                      <button
                        className="absolute top-3 right-9 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(p.id)
                          setRenameValue(p.name)
                        }}
                        title="Rename project"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeletingId(p.id)
                        }}
                        title="Delete project"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Card>
                  ))}
                  {projects.length === 0 && (
                    <div className="col-span-full flex justify-center py-12">
                      <Card className="w-full max-w-sm text-center px-8 py-10">
                        <div className="flex justify-center mb-4">
                          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                            <FolderOpen className="h-6 w-6 text-muted-foreground" />
                          </div>
                        </div>
                        <h3 className="text-lg font-semibold mb-1">No projects yet</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                          Create your first project to start working with AI agents.
                        </p>
                        <Button onClick={() => navigate("/onboarding")} className="w-full">
                          Create your first project
                        </Button>
                      </Card>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Inline chat slide-over */}
          {chatProjectId && chatProject && (
            <div className="w-[380px] flex-shrink-0 border rounded-lg overflow-hidden flex flex-col h-[calc(100vh-10rem)] sticky top-6">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
                <span className="font-semibold text-sm">{chatProject.name}</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => navigate(`/project/${chatProjectId}`)}
                  >
                    Open project
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setChatProjectId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel projectId={chatProjectId} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <span className="font-medium">{deletingProject?.name}</span> and all associated data.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  )
}
