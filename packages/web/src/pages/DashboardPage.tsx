import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthLayout } from "@/components/layout/AuthLayout"
import * as api from "@/lib/api"

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

  useEffect(() => {
    api.getProjects()
      .then((d) => setProjects(d.projects))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AuthLayout>
      <main className="max-w-5xl mx-auto p-6 w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">My Projects</h2>
          <Button onClick={() => navigate("/onboarding")}>New Project</Button>
        </div>
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
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/project/${p.id}`)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === "running" ? "default" : "secondary"}>
                        {p.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{p.templateId}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {projects.length === 0 && (
                <p className="text-muted-foreground col-span-full text-center py-12">
                  No projects yet. Create one to get started.
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </AuthLayout>
  )
}
