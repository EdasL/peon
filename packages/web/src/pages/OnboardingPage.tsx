import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import * as api from "@/lib/api"

type Step = "github" | "repo" | "template" | "apikey" | "launch"

const TEMPLATES = [
  { id: "fullstack", name: "Full Stack", desc: "Designer + Backend + Mobile + QA agents" },
  { id: "backend", name: "Backend Only", desc: "Backend developer + QA agents" },
  { id: "mobile", name: "Mobile Only", desc: "Designer + Mobile developer + QA agents" },
]

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(user?.githubId ? "repo" : "github")
  const [repos, setRepos] = useState<api.GithubRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<api.GithubRepo | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState("")
  const [projectName, setProjectName] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [apiProvider, setApiProvider] = useState<"anthropic" | "openai">("anthropic")

  const connectGithub = () => {
    window.location.href = "/api/auth/github"
  }

  const loadRepos = async () => {
    const data = await api.getGithubRepos()
    setRepos(data.repos)
    setStep("repo")
  }

  const launch = async () => {
    // Save API key
    await api.addApiKey({ provider: apiProvider, key: apiKey })

    // Create project
    const { project } = await api.createProject({
      name: projectName || selectedRepo?.name || "My Project",
      repoUrl: selectedRepo?.htmlUrl,
      templateId: selectedTemplate,
    })

    navigate(`/project/${project.id}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-[500px]">
        <CardHeader>
          <CardTitle>Set up your project</CardTitle>
          <CardDescription>Step {["github", "repo", "template", "apikey", "launch"].indexOf(step) + 1} of 5</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "github" && (
            <>
              <p className="text-sm text-muted-foreground">Connect GitHub so agents can work on your repositories.</p>
              <Button onClick={connectGithub} className="w-full">Connect GitHub</Button>
              <Button variant="ghost" className="w-full" onClick={loadRepos}>
                Skip for now
              </Button>
            </>
          )}

          {step === "repo" && (
            <>
              <p className="text-sm text-muted-foreground">Pick a repository for your agents to work on.</p>
              {repos.length === 0 && (
                <Button onClick={loadRepos} className="w-full">Load repositories</Button>
              )}
              <div className="max-h-60 overflow-y-auto space-y-2">
                {repos.map((repo) => (
                  <button
                    key={repo.fullName}
                    onClick={() => { setSelectedRepo(repo); setProjectName(repo.name); setStep("template") }}
                    className={`w-full text-left p-3 rounded-lg border ${selectedRepo?.fullName === repo.fullName ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                  >
                    <div className="font-medium">{repo.fullName}</div>
                    {repo.private && <span className="text-xs text-muted-foreground">Private</span>}
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => setStep("template")}>
                No repo — start fresh
              </Button>
            </>
          )}

          {step === "template" && (
            <>
              <p className="text-sm text-muted-foreground">Choose a team template.</p>
              <div className="space-y-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t.id); setStep("apikey") }}
                    className={`w-full text-left p-3 rounded-lg border ${selectedTemplate === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="text-sm text-muted-foreground">{t.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "apikey" && (
            <>
              <p className="text-sm text-muted-foreground">Add your API key. Agents use this to run — you control the cost.</p>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={apiProvider === "anthropic" ? "default" : "outline"}
                    onClick={() => setApiProvider("anthropic")}
                    size="sm"
                  >
                    Anthropic
                  </Button>
                  <Button
                    variant={apiProvider === "openai" ? "default" : "outline"}
                    onClick={() => setApiProvider("openai")}
                    size="sm"
                  >
                    OpenAI
                  </Button>
                </div>
                <div>
                  <Label htmlFor="apikey">API Key</Label>
                  <Input
                    id="apikey"
                    type="password"
                    placeholder={apiProvider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              </div>
              <Button onClick={launch} className="w-full" disabled={!apiKey}>
                Launch Project
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
