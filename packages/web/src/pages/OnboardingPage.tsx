import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Loader2 } from "lucide-react"
import * as api from "@/lib/api"

type Step = "github" | "repo" | "template" | "apikey" | "launch"

const TEMPLATES = [
  { id: "fullstack", name: "Full Stack", desc: "Designer + Backend + Mobile + QA agents" },
  { id: "backend", name: "Backend Only", desc: "Backend developer + QA agents" },
  { id: "mobile", name: "Mobile Only", desc: "Designer + Mobile developer + QA agents" },
]

const ALL_STEPS: Step[] = ["github", "repo", "template", "apikey", "launch"]

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const githubStatus = searchParams.get("github")
  const githubError = searchParams.get("message")

  const [existingKeys, setExistingKeys] = useState<api.ApiKeyInfo[]>([])
  const [keysLoaded, setKeysLoaded] = useState(false)

  const [repos, setRepos] = useState<api.GithubRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<api.GithubRepo | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState("")
  const [projectName, setProjectName] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [apiProvider, setApiProvider] = useState<"anthropic" | "openai">("anthropic")
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    api.getApiKeys()
      .then((d) => setExistingKeys(d.keys))
      .catch(() => {})
      .finally(() => setKeysLoaded(true))
  }, [])

  const hasKey = (provider: string) => existingKeys.some((k) => k.provider === provider)
  const hasAnyKey = existingKeys.length > 0

  const initialStep: Step =
    githubStatus === "connected" ? "repo" : user?.githubId ? "repo" : "github"
  const [step, setStep] = useState<Step>(initialStep)

  const goToNextFromTemplate = () => {
    // Skip apikey step if user already has at least one key
    if (hasAnyKey) {
      setStep("launch")
    } else {
      setStep("apikey")
    }
  }

  const visibleSteps = keysLoaded
    ? ALL_STEPS.filter((s) => s !== "apikey" || !hasAnyKey)
    : ALL_STEPS

  const stepNumber = visibleSteps.indexOf(step) + 1
  const totalSteps = visibleSteps.length

  const connectGithub = () => {
    window.location.href = "/api/auth/github"
  }

  const loadRepos = async () => {
    const data = await api.getGithubRepos()
    setRepos(data.repos)
    setStep("repo")
  }

  const launch = async () => {
    setLaunching(true)
    try {
      // Only add API key if user doesn't already have one
      if (!hasAnyKey && apiKey.trim()) {
        await api.addApiKey({ provider: apiProvider, key: apiKey.trim() })
      }

      const { project } = await api.createProject({
        name: projectName || selectedRepo?.name || undefined,
        repoUrl: selectedRepo?.htmlUrl,
        templateId: selectedTemplate,
      })

      navigate(`/project/${project.id}`)
    } finally {
      setLaunching(false)
    }
  }

  if (!keysLoaded) {
    return (
      <AuthLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-[500px]">
          <CardHeader>
            <CardTitle>Set up your project</CardTitle>
            <CardDescription>Step {stepNumber} of {totalSteps}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "github" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect GitHub so agents can work on your repositories.
                </p>
                {githubStatus === "error" && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
                    {githubError || "GitHub connection failed"}
                  </p>
                )}
                <Button onClick={connectGithub} className="w-full">Connect GitHub</Button>
                <Button variant="ghost" className="w-full" onClick={() => setStep("template")}>
                  Skip for now
                </Button>
              </>
            )}

            {step === "repo" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Pick a repository for your agents to work on.
                </p>
                {repos.length === 0 && (
                  <Button onClick={loadRepos} className="w-full">Load repositories</Button>
                )}
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {repos.map((repo) => (
                    <button
                      key={repo.fullName}
                      onClick={() => {
                        setSelectedRepo(repo)
                        setProjectName(repo.name)
                        setStep("template")
                      }}
                      className={`w-full text-left p-3 rounded-lg border ${
                        selectedRepo?.fullName === repo.fullName
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="font-medium">{repo.fullName}</div>
                      {repo.private && (
                        <span className="text-xs text-muted-foreground">Private</span>
                      )}
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
                      onClick={() => {
                        setSelectedTemplate(t.id)
                        goToNextFromTemplate()
                      }}
                      className={`w-full text-left p-3 rounded-lg border ${
                        selectedTemplate === t.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
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
                <p className="text-sm text-muted-foreground">
                  Add your API key. Agents use this to run — you control the cost.
                </p>
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
                  {hasKey(apiProvider) ? (
                    <p className="text-sm text-muted-foreground bg-muted rounded-md p-3">
                      You already have a{" "}
                      <span className="font-medium capitalize">{apiProvider}</span> key connected.
                    </p>
                  ) : (
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
                  )}
                </div>
                <Button
                  onClick={() => setStep("launch")}
                  className="w-full"
                  disabled={!hasKey(apiProvider) && !apiKey}
                >
                  Continue
                </Button>
              </>
            )}

            {step === "launch" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Name your project and launch.
                </p>
                <div>
                  <Label htmlFor="project-name">Project name (optional)</Label>
                  <Input
                    id="project-name"
                    placeholder="Leave blank for a random name"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                {hasAnyKey && (
                  <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                    Using your connected API key.
                  </p>
                )}
                <Button onClick={launch} className="w-full" disabled={launching}>
                  {launching && <Loader2 className="h-4 w-4 animate-spin" />}
                  {launching ? "Launching..." : "Launch Project"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AuthLayout>
  )
}
