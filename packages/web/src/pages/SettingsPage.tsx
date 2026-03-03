import { useEffect, useState, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ExternalLink, Github, Loader2, LogIn, Trash2, User, CheckCircle2 } from "lucide-react"
import * as api from "@/lib/api"

type Section = "profile" | "api-keys" | "github" | "danger"

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <User className="h-4 w-4" /> },
  { id: "api-keys", label: "Claude", icon: <LogIn className="h-4 w-4" /> },
  { id: "github", label: "GitHub", icon: <Github className="h-4 w-4" /> },
  { id: "danger", label: "Danger Zone", icon: <Trash2 className="h-4 w-4" /> },
]

const VALID_SECTIONS: Section[] = ["profile", "api-keys", "github", "danger"]

function parseSectionFromUrl(searchParams: URLSearchParams): Section {
  const s = searchParams.get("section")
  if (s && VALID_SECTIONS.includes(s as Section)) return s as Section
  return "profile"
}

export function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionFromUrl = parseSectionFromUrl(searchParams)
  const [section, setSection] = useState<Section>(sectionFromUrl)

  // Sync section from URL when URL changes (e.g. back/forward)
  useEffect(() => {
    const s = parseSectionFromUrl(searchParams)
    setSection(s)
  }, [searchParams])

  const handleSectionChange = useCallback(
    (s: Section) => {
      setSection(s)
      setSearchParams({ section: s }, { replace: true })
    },
    [setSearchParams]
  )
  const [oauthConnections, setOauthConnections] = useState<api.OAuthConnection[]>([])
  const [keysLoading, setKeysLoading] = useState(true)

  // Claude OAuth dialog
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null)
  const [oauthCode, setOauthCode] = useState("")
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthExchanging, setOauthExchanging] = useState(false)

  // GitHub
  const [disconnecting, setDisconnecting] = useState(false)
  const [githubDisconnected, setGithubDisconnected] = useState(false)

  // Delete account
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

  const refreshKeys = () => {
    api.getApiKeys().then((d) => {
      setOauthConnections(d.oauthConnections || [])
    })
  }

  useEffect(() => {
    api.getApiKeys()
      .then((d) => {
        setOauthConnections(d.oauthConnections || [])
      })
      .finally(() => setKeysLoading(false))
  }, [])

  const oauthForProvider = (provider: string) => oauthConnections.find((o) => o.provider === provider)

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
      refreshKeys()
    } catch {
      // toast shown by api layer
    } finally {
      setOauthExchanging(false)
    }
  }

  const handleDisconnectOAuth = async (provider: string) => {
    try {
      await api.disconnectOAuth(provider)
      setOauthConnections((prev) => prev.filter((o) => o.provider !== provider))
      toast.success("Claude disconnected")
    } catch {
      // toast shown by api layer
    }
  }

  const handleDisconnectGithub = async () => {
    setDisconnecting(true)
    try {
      await api.disconnectGithub()
      toast.success("GitHub disconnected")
      setGithubDisconnected(true)
      await refreshUser()
    } catch {
      // toast shown by api layer
    } finally {
      setDisconnecting(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return
    setDeleteAccountLoading(true)
    try {
      await api.deleteAccount()
      toast.success("Account deleted")
      window.location.href = "/"
    } catch {
      // toast shown by api layer
    } finally {
      setDeleteAccountLoading(false)
    }
  }

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "?"

  return (
    <AuthLayout>
      <div className="max-w-4xl mx-auto p-6 w-full flex gap-8">
        {/* Sidebar nav */}
        <nav className="w-48 shrink-0 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSectionChange(item.id)}
              className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                section === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-6">
          {section === "profile" && (
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Your account information from Google sign-in.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar size="lg">
                    {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{user?.name}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {section === "api-keys" && (
            <Card>
              <CardHeader>
                <CardTitle>Claude Connection</CardTitle>
                <CardDescription>
                  Connect your Claude subscription to power your agents.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {keysLoading ? (
                  <Skeleton className="h-14 w-full" />
                ) : (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-sm">Anthropic</span>
                        {oauthForProvider("anthropic") ? (
                          <Badge
                            variant="secondary"
                            className="flex items-center gap-1 text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Claude subscription
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not connected
                          </Badge>
                        )}
                      </div>
                      {oauthForProvider("anthropic") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => handleDisconnectOAuth("anthropic")}
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="flex items-center gap-1.5"
                          onClick={() => {
                            setOauthDialogOpen(true)
                            handleStartOAuth()
                          }}
                        >
                          <LogIn className="h-3.5 w-3.5" />
                          Login with Claude
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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

          {section === "github" && (
            <Card>
              <CardHeader>
                <CardTitle>GitHub</CardTitle>
                <CardDescription>
                  Connect GitHub so agents can access your repositories.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {user?.githubId && !githubDisconnected ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Github className="h-5 w-5" />
                      <div>
                        <p className="text-sm font-medium">Connected</p>
                        <p className="text-xs text-muted-foreground">GitHub account linked</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnectGithub}
                      disabled={disconnecting}
                    >
                      {disconnecting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Github className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Not connected</p>
                        <p className="text-xs text-muted-foreground">
                          Link your GitHub to give agents repo access
                        </p>
                      </div>
                    </div>
                    <Button size="sm" asChild>
                      <a href="/api/auth/github">Connect</a>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {section === "danger" && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>Irreversible actions. Proceed with caution.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Delete account</p>
                    <p className="text-xs text-muted-foreground">
                      Permanently delete your account, all projects, API keys, and chat history.
                    </p>
                  </div>
                  <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        Delete Account
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete your account?</DialogTitle>
                        <DialogDescription>
                          This will permanently delete your account and all associated data
                          including projects, API keys, and chat history. This action cannot be
                          undone.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2 py-2">
                        <Label htmlFor="delete-confirm" className="text-sm">
                          Type <span className="font-mono font-semibold">DELETE</span> to confirm
                        </Label>
                        <Input
                          id="delete-confirm"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder="DELETE"
                          className="font-mono"
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setDeleteAccountOpen(false)
                            setDeleteConfirmText("")
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleDeleteAccount}
                          disabled={deleteAccountLoading || deleteConfirmText !== "DELETE"}
                        >
                          {deleteAccountLoading && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          Delete Account
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AuthLayout>
  )
}
