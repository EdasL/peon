import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import { AuthLayout } from "@/components/layout/AuthLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
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
import { Github, Key, Loader2, Trash2, User } from "lucide-react"
import * as api from "@/lib/api"

type Section = "profile" | "api-keys" | "github" | "danger"

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <User className="h-4 w-4" /> },
  { id: "api-keys", label: "API Keys", icon: <Key className="h-4 w-4" /> },
  { id: "github", label: "GitHub", icon: <Github className="h-4 w-4" /> },
  { id: "danger", label: "Danger Zone", icon: <Trash2 className="h-4 w-4" /> },
]

export function SettingsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>("profile")
  const [keys, setKeys] = useState<api.ApiKeyInfo[]>([])
  const [keysLoading, setKeysLoading] = useState(true)

  // Add key form
  const [newProvider, setNewProvider] = useState<"anthropic" | "openai">("anthropic")
  const [newKey, setNewKey] = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [addingKey, setAddingKey] = useState(false)

  // Delete key dialog
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null)
  const [deleteKeyLoading, setDeleteKeyLoading] = useState(false)

  // GitHub
  const [disconnecting, setDisconnecting] = useState(false)

  // Delete account
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false)

  useEffect(() => {
    api.getApiKeys()
      .then((d) => setKeys(d.keys))
      .finally(() => setKeysLoading(false))
  }, [])

  const handleAddKey = async () => {
    if (!newKey.trim()) return
    setAddingKey(true)
    try {
      const { key } = await api.addApiKey({
        provider: newProvider,
        key: newKey.trim(),
        label: newLabel.trim() || undefined,
      })
      setKeys((prev) => [...prev, key])
      setNewKey("")
      setNewLabel("")
      toast.success("API key added")
    } finally {
      setAddingKey(false)
    }
  }

  const handleDeleteKey = async () => {
    if (!deletingKeyId) return
    setDeleteKeyLoading(true)
    try {
      await api.deleteApiKey(deletingKeyId)
      setKeys((prev) => prev.filter((k) => k.id !== deletingKeyId))
      setDeletingKeyId(null)
      toast.success("API key deleted")
    } finally {
      setDeleteKeyLoading(false)
    }
  }

  const handleDisconnectGithub = async () => {
    setDisconnecting(true)
    try {
      await api.disconnectGithub()
      toast.success("GitHub disconnected")
      // Reload to update user state
      window.location.reload()
    } finally {
      setDisconnecting(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteAccountLoading(true)
    try {
      await api.deleteAccount()
      toast.success("Account deleted")
      window.location.href = "/"
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
              onClick={() => setSection(item.id)}
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
            <>
              <Card>
                <CardHeader>
                  <CardTitle>API Keys</CardTitle>
                  <CardDescription>Manage the API keys your agents use. You control the cost.</CardDescription>
                </CardHeader>
                <CardContent>
                  {keysLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No API keys yet. Add one below.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {keys.map((k) => (
                        <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center gap-3">
                            <Badge variant="secondary">{k.provider}</Badge>
                            <span className="text-sm">{k.label || "Untitled"}</span>
                            <span className="text-xs text-muted-foreground">
                              Added {new Date(k.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <Dialog
                            open={deletingKeyId === k.id}
                            onOpenChange={(open) => setDeletingKeyId(open ? k.id : null)}
                          >
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon-xs">
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Delete API key</DialogTitle>
                                <DialogDescription>
                                  This will remove the key and agents will no longer be able to use it.
                                </DialogDescription>
                              </DialogHeader>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setDeletingKeyId(null)}>
                                  Cancel
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={handleDeleteKey}
                                  disabled={deleteKeyLoading}
                                >
                                  {deleteKeyLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                                  Delete
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add API Key</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      variant={newProvider === "anthropic" ? "default" : "outline"}
                      onClick={() => setNewProvider("anthropic")}
                      size="sm"
                    >
                      Anthropic
                    </Button>
                    <Button
                      variant={newProvider === "openai" ? "default" : "outline"}
                      onClick={() => setNewProvider("openai")}
                      size="sm"
                    >
                      OpenAI
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="new-key">API Key</Label>
                      <Input
                        id="new-key"
                        type="password"
                        placeholder={newProvider === "anthropic" ? "sk-ant-..." : "sk-..."}
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="new-label">Label (optional)</Label>
                      <Input
                        id="new-label"
                        placeholder="e.g. Personal, Work"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button onClick={handleAddKey} disabled={!newKey.trim() || addingKey}>
                    {addingKey && <Loader2 className="h-4 w-4 animate-spin" />}
                    Add Key
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {section === "github" && (
            <Card>
              <CardHeader>
                <CardTitle>GitHub</CardTitle>
                <CardDescription>Connect GitHub so agents can access your repositories.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {user?.githubId ? (
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
                        <p className="text-xs text-muted-foreground">Link your GitHub to give agents repo access</p>
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
                      <Button variant="destructive" size="sm">Delete Account</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete your account?</DialogTitle>
                        <DialogDescription>
                          This will permanently delete your account and all associated data including
                          projects, API keys, and chat history. This action cannot be undone.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteAccountOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleDeleteAccount}
                          disabled={deleteAccountLoading}
                        >
                          {deleteAccountLoading && <Loader2 className="h-4 w-4 animate-spin" />}
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
