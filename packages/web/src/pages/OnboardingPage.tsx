import { useState, useEffect, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Loader2, Check, Github, ExternalLink, Users } from "lucide-react"
import * as api from "@/lib/api"
import { TEMPLATES } from "@/lib/templates"

type Step = "apikey" | "repo-template" | "launch"

function ProgressDots({ steps, current }: { steps: Step[]; current: Step }) {
  const currentIndex = steps.indexOf(current)
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {steps.map((s, i) => (
        <div
          key={s}
          className={[
            "h-2 rounded-full transition-all duration-300",
            i < currentIndex
              ? "w-6 bg-primary/50"
              : i === currentIndex
              ? "w-6 bg-primary"
              : "w-2 bg-muted-foreground/30",
          ].join(" ")}
        />
      ))}
    </div>
  )
}

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const githubStatus = searchParams.get("github")
  const githubError = searchParams.get("message")

  // Key state
  const [existingKeys, setExistingKeys] = useState<api.ApiKeyInfo[]>([])
  const [keysLoaded, setKeysLoaded] = useState(false)

  // Repo state
  const [repos, setRepos] = useState<api.GithubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [reposLoaded, setReposLoaded] = useState(false)
  const [repoUrl, setRepoUrl] = useState("")
  const [selectedRepo, setSelectedRepo] = useState<api.GithubRepo | null>(null)

  // Form state
  const [selectedTemplate, setSelectedTemplate] = useState("fullstack")
  const [projectName, setProjectName] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [apiProvider] = useState<"anthropic">("anthropic")
  const [savingKey, setSavingKey] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  // Animation
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    api
      .getApiKeys()
      .then((d) => setExistingKeys(d.keys))
      .catch(() => {})
      .finally(() => setKeysLoaded(true))
  }, [])

  const hasAnyKey = existingKeys.length > 0
  const hasGithub = !!(user?.githubId || githubStatus === "connected")

  const steps: Step[] = hasAnyKey ? ["repo-template", "launch"] : ["apikey", "repo-template", "launch"]

  const initialStep = useCallback((): Step => {
    if (!hasAnyKey) return "apikey"
    return "repo-template"
  }, [hasAnyKey])

  const [step, setStep] = useState<Step>("apikey")

  // Once keys load, set correct initial step
  useEffect(() => {
    if (keysLoaded) {
      setStep(initialStep())
      setTimeout(() => setVisible(true), 50)
    }
  }, [keysLoaded, initialStep])

  // Load repos if GitHub connected and not yet loaded
  useEffect(() => {
    if (hasGithub && step === "repo-template" && !reposLoaded && !reposLoading) {
      setReposLoading(true)
      api
        .getGithubRepos()
        .then((d) => {
          setRepos(d.repos)
          setReposLoaded(true)
        })
        .catch(() => {
          setReposLoaded(true)
        })
        .finally(() => setReposLoading(false))
    }
  }, [hasGithub, step, reposLoaded, reposLoading])

  const transitionTo = (next: Step) => {
    setVisible(false)
    setTimeout(() => {
      setStep(next)
      setVisible(true)
    }, 150)
  }

  const connectGithub = () => {
    window.location.href = "/api/auth/github"
  }

  const handleApiKeyContinue = async () => {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await api.addApiKey({ provider: apiProvider, key: apiKey.trim() })
      setExistingKeys((prev) => [
        ...prev,
        { id: "pending", provider: apiProvider, label: "", createdAt: "" },
      ])
      transitionTo("repo-template")
    } catch {
      // error toasted by api.ts
    } finally {
      setSavingKey(false)
    }
  }

  const selectRepo = (repo: api.GithubRepo) => {
    setSelectedRepo(repo)
    setProjectName(repo.name)
    setRepoUrl("")
  }

  const handleTemplatePick = (templateId: string) => {
    setSelectedTemplate(templateId)
    transitionTo("launch")
  }

  const launch = async () => {
    setLaunching(true)
    setLaunchError(null)
    try {
      const resolvedRepoUrl = selectedRepo?.htmlUrl || (repoUrl.trim() || undefined)
      const { project } = await api.createProject({
        name: projectName.trim() || selectedRepo?.name || undefined,
        repoUrl: resolvedRepoUrl,
        templateId: selectedTemplate,
      })
      navigate(`/project/${project.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project"
      setLaunchError(msg)
    } finally {
      setLaunching(false)
    }
  }

  if (!keysLoaded) {
    return (
      <AuthLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className={[
            "w-full max-w-[480px] transition-all duration-200",
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
          ].join(" ")}
        >
          <ProgressDots steps={steps} current={step} />

          {/* API Key step — only for new users */}
          {step === "apikey" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Add your API key</h1>
                <p className="text-sm text-muted-foreground">
                  Agents run on your key — you control the cost.{" "}
                  <a
                    href="https://console.anthropic.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    Get one <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm">
                  <span className="text-muted-foreground">Provider:</span>
                  <span className="font-medium">Anthropic</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apikey" className="text-sm font-medium">
                    API Key
                  </Label>
                  <Input
                    id="apikey"
                    type="password"
                    placeholder="sk-ant-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && apiKey.trim()) handleApiKeyContinue()
                    }}
                    autoFocus
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Stored encrypted. Never logged or shared.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  onClick={handleApiKeyContinue}
                  className="w-full"
                  disabled={!apiKey.trim() || savingKey}
                >
                  {savingKey ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Continue"
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Press Enter to continue
                </p>
              </div>
            </div>
          )}

          {/* Repo + Template combined step */}
          {step === "repo-template" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Set up your project</h1>
                <p className="text-sm text-muted-foreground">
                  Pick a repo (optional) and choose your team.
                </p>
              </div>

              {/* GitHub error from OAuth callback */}
              {githubStatus === "error" && (
                <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                  {githubError || "GitHub connection failed. Try again."}
                </div>
              )}

              {/* Repo section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Repository</span>
                  {!hasGithub && (
                    <button
                      onClick={connectGithub}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Github className="h-3.5 w-3.5" />
                      Connect GitHub
                    </button>
                  )}
                </div>

                {hasGithub ? (
                  reposLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading repos...
                    </div>
                  ) : repos.length > 0 ? (
                    <div className="max-h-44 overflow-y-auto space-y-1.5 rounded-lg border border-border p-1">
                      {repos.map((repo) => (
                        <button
                          key={repo.fullName}
                          onClick={() => selectRepo(repo)}
                          className={[
                            "w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors",
                            selectedRepo?.fullName === repo.fullName
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted",
                          ].join(" ")}
                        >
                          <span className="font-medium truncate">{repo.fullName}</span>
                          <span className="flex items-center gap-1.5 shrink-0 ml-2">
                            {repo.private && (
                              <span
                                className={[
                                  "text-xs px-1.5 py-0.5 rounded",
                                  selectedRepo?.fullName === repo.fullName
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "bg-muted text-muted-foreground",
                                ].join(" ")}
                              >
                                Private
                              </span>
                            )}
                            {selectedRepo?.fullName === repo.fullName && (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground p-2">No repos found.</p>
                  )
                ) : (
                  <Input
                    placeholder="https://github.com/you/your-repo (optional)"
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value)
                      setSelectedRepo(null)
                    }}
                    className="text-sm"
                  />
                )}

                {selectedRepo && (
                  <button
                    onClick={() => {
                      setSelectedRepo(null)
                      setProjectName("")
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {/* Template section */}
              <div className="space-y-2">
                <span className="text-sm font-medium">Team template</span>
                <div className="grid gap-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleTemplatePick(t.id)}
                      className={[
                        "w-full text-left px-4 py-3 rounded-lg border transition-all duration-150",
                        selectedTemplate === t.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/40 hover:bg-muted/40",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{t.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{t.agents.length}</span>
                          {selectedTemplate === t.id && (
                            <Check className="h-4 w-4 text-primary ml-1" />
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{t.desc}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {t.agents.map((a) => (
                          <span
                            key={a.role}
                            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                          >
                            <span className={`h-2 w-2 rounded-full ${a.color}`} />
                            {a.role}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Click a template to continue
              </p>
            </div>
          )}

          {/* Launch step */}
          {step === "launch" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Ready to launch</h1>
                <p className="text-sm text-muted-foreground">
                  Give your project a name, then go.
                </p>
              </div>

              {/* Summary */}
              <div className="rounded-lg border border-border divide-y divide-border text-sm">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Template</span>
                  <span className="font-medium capitalize">
                    {TEMPLATES.find((t) => t.id === selectedTemplate)?.name ?? selectedTemplate}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Repo</span>
                  <span className="font-medium text-xs truncate max-w-[200px]">
                    {selectedRepo?.fullName || repoUrl || (
                      <span className="text-muted-foreground italic">None (fresh start)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">API key</span>
                  <span className="flex items-center gap-1.5 text-green-500 font-medium">
                    <Check className="h-3.5 w-3.5" />
                    Anthropic connected
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="project-name" className="text-sm font-medium">
                  Project name
                </Label>
                <Input
                  id="project-name"
                  placeholder="Leave blank for a random name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !launching) launch()
                  }}
                  autoFocus
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                {launchError && (
                  <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                    {launchError}
                  </div>
                )}
                <Button onClick={launch} className="w-full" disabled={launching}>
                  {launching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Launching...
                    </>
                  ) : launchError ? (
                    "Retry"
                  ) : (
                    "Launch project"
                  )}
                </Button>
                <button
                  onClick={() => transitionTo("repo-template")}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthLayout>
  )
}
