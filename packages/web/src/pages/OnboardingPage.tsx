import { useState, useEffect, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthLayout } from "@/components/layout/AuthLayout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Check, ExternalLink, Github, LogIn } from "lucide-react"
import * as api from "@/lib/api"
import { getDefaultTeam } from "@/lib/team-suggestions"
import type { SuggestedMember } from "@/lib/team-suggestions"
import { TeamEditor } from "@/components/onboarding/TeamEditor"

type Step = "apikey" | "github" | "repo" | "team"

const ALL_STEPS: Step[] = ["apikey", "github", "repo", "team"]

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

  // Claude OAuth dialog
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState("")
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthExchanging, setOauthExchanging] = useState(false)

  // Repo state
  const [repos, setRepos] = useState<api.GithubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [reposLoaded, setReposLoaded] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<api.GithubRepo | null>(null)
  const [reposError, setReposError] = useState<string | null>(null)

  // Form state
  const [members, setMembers] = useState<SuggestedMember[]>(() => getDefaultTeam())
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  // Animation
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    api
      .getApiKeys()
      .then((d) => {
        setExistingKeys(d.keys)
        if (d.oauthConnections?.some((o) => o.provider === "anthropic")) {
          setExistingKeys((prev) => {
            if (prev.some((k) => k.provider === "anthropic")) return prev
            return [...prev, { id: "oauth", provider: "anthropic", label: "Claude subscription", createdAt: "" }]
          })
        }
      })
      .catch(() => {})
      .finally(() => setKeysLoaded(true))
  }, [])

  const hasAnyKey = existingKeys.length > 0
  const hasGithub = !!(user?.githubId || githubStatus === "connected")

  const computeSteps = useCallback((): Step[] => {
    const s: Step[] = []
    if (!hasAnyKey) s.push("apikey")
    if (!hasGithub) s.push("github")
    s.push("repo", "team")
    return s
  }, [hasAnyKey, hasGithub])

  const steps = computeSteps()

  const initialStep = useCallback((): Step => {
    if (!hasAnyKey) return "apikey"
    if (!hasGithub) return "github"
    return "repo"
  }, [hasAnyKey, hasGithub])

  const [step, setStep] = useState<Step>("apikey")

  useEffect(() => {
    if (keysLoaded) {
      setStep(initialStep())
      setTimeout(() => setVisible(true), 50)
    }
  }, [keysLoaded, initialStep])

  // Load repos when on the repo step
  useEffect(() => {
    if (step === "repo" && hasGithub && !reposLoaded && !reposLoading) {
      setReposLoading(true)
      api
        .getGithubRepos()
        .then((d) => {
          setRepos(d.repos)
          setReposLoaded(true)
          setReposError(null)
        })
        .catch((err: unknown) => {
          setReposLoaded(true)
          setReposError(err instanceof Error ? err.message : "Failed to load repositories")
        })
        .finally(() => setReposLoading(false))
    }
  }, [step, hasGithub, reposLoaded, reposLoading])

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

  const handleStartOAuth = async () => {
    setOauthLoading(true)
    setOauthAuthUrl(null)
    setOauthCode("")
    try {
      const { authUrl } = await api.initClaudeOAuth()
      setOauthAuthUrl(authUrl)
      window.open(authUrl, "_blank", "noopener")
    } catch {
      // toast shown by api layer
    } finally {
      setOauthLoading(false)
    }
  }

  const handleExchangeOAuth = async () => {
    if (!oauthCode.trim()) return
    setOauthExchanging(true)
    try {
      await api.exchangeClaudeOAuth(oauthCode.trim())
      toast.success("Claude subscription connected!")
      setOauthDialogOpen(false)
      setOauthAuthUrl(null)
      setOauthCode("")
      setExistingKeys((prev) => {
        if (prev.some((k) => k.provider === "anthropic")) return prev
        return [...prev, { id: "oauth", provider: "anthropic", label: "Claude subscription", createdAt: "" }]
      })
      transitionTo(hasGithub ? "repo" : "github")
    } catch {
      // toast shown by api layer
    } finally {
      setOauthExchanging(false)
    }
  }

  const selectRepo = (repo: api.GithubRepo) => {
    setSelectedRepo(repo)
  }

  const launch = async () => {
    if (!selectedRepo) return
    setLaunching(true)
    setLaunchError(null)
    try {
      const { project } = await api.createProject({
        name: selectedRepo.name,
        repoUrl: selectedRepo.htmlUrl,
        team: {
          name: "Default Team",
          members: members.map((m) => ({
            roleName: m.role,
            displayName: m.name,
            systemPrompt: m.prompt,
            color: m.color,
          })),
        },
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

          {/* Step: API key / Claude OAuth */}
          {step === "apikey" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Connect to Claude</h1>
                <p className="text-sm text-muted-foreground">
                  Login with your Claude subscription to get started.
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    setOauthDialogOpen(true)
                    handleStartOAuth()
                  }}
                >
                  <LogIn className="h-4 w-4" />
                  Login with Claude
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Uses your Claude Pro, Max, or Teams subscription
                </p>
              </div>
            </div>
          )}

          {/* Step: Connect GitHub */}
          {step === "github" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Connect GitHub</h1>
                <p className="text-sm text-muted-foreground">
                  Link your GitHub account to select a repository.
                </p>
              </div>

              {githubStatus === "error" && (
                <div className="text-sm text-destructive bg-destructive/10 rounded-sm p-3">
                  {githubError || "GitHub connection failed. Try again."}
                </div>
              )}

              <div className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={connectGithub}
                >
                  <Github className="h-4 w-4" />
                  Connect GitHub
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Grants access to your repositories so the team can work on your code
                </p>
              </div>
            </div>
          )}

          {/* Step: Select Repository (mandatory) */}
          {step === "repo" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Select a repository</h1>
                <p className="text-sm text-muted-foreground">
                  Choose the repo your team will work on.
                </p>
              </div>

              {reposLoading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading repositories...
                </div>
              ) : repos.length > 0 ? (
                <>
                  <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-sm border border-border p-1">
                    {repos.map((repo) => (
                      <button
                        key={repo.fullName}
                        onClick={() => selectRepo(repo)}
                        className={[
                          "w-full text-left px-3 py-2 rounded-sm text-sm flex items-center justify-between transition-colors",
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

                  {selectedRepo && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Selected: <span className="text-foreground font-medium">{selectedRepo.name}</span>
                      </span>
                      <button
                        onClick={() => setSelectedRepo(null)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  {reposError ? (
                    <span className="text-destructive">{reposError}</span>
                  ) : (
                    "No repositories found. Create a repo on GitHub first."
                  )}
                </div>
              )}

              <Button
                className="w-full"
                disabled={!selectedRepo}
                onClick={() => transitionTo("team")}
              >
                Next
              </Button>
            </div>
          )}

          {/* Step: Team editor + launch */}
          {step === "team" && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Build your team</h1>
                <p className="text-sm text-muted-foreground">
                  Customize roles and prompts, or add more members.
                </p>
              </div>

              <TeamEditor members={members} onChange={setMembers} />

              <div className="space-y-2">
                {launchError && (
                  <div className="text-sm text-destructive bg-destructive/10 rounded-sm p-3">
                    {launchError}
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={launch}
                  disabled={launching || members.length === 0}
                >
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
                  onClick={() => transitionTo("repo")}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Claude OAuth dialog */}
      <Dialog open={oauthDialogOpen} onOpenChange={(open) => {
        setOauthDialogOpen(open)
        if (!open) {
          setOauthAuthUrl(null)
          setOauthCode("")
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Login with Claude</DialogTitle>
            <DialogDescription>
              Authorize with your Claude subscription, then paste the code below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {oauthLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : oauthAuthUrl ? (
              <>
                <div className="space-y-2">
                  <p className="text-sm">
                    <strong>Step 1:</strong> A new tab should have opened. If not, click below:
                  </p>
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <a href={oauthAuthUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Claude authorization
                    </a>
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-sm">
                    <strong>Step 2:</strong> After authorizing, copy the code shown and paste it here:
                  </p>
                  <Input
                    placeholder="Paste the code here (CODE#STATE)"
                    value={oauthCode}
                    onChange={(e) => setOauthCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && oauthCode.trim()) handleExchangeOAuth()
                    }}
                    className="font-mono text-sm"
                    autoFocus
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Failed to initialize. Close this dialog and try again.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOauthDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleExchangeOAuth}
              disabled={!oauthCode.trim() || oauthExchanging}
            >
              {oauthExchanging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  )
}
