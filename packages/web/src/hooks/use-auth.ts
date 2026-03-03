import { useState, useEffect, useCallback, createContext, useContext } from "react"

interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  githubId: string | null
}

interface AuthContext {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

export const AuthCtx = createContext<AuthContext>({
  user: null,
  loading: true,
  logout: async () => {},
  refreshUser: async () => {},
})

export function useAuth() {
  return useContext(AuthCtx)
}

export function useAuthProvider(): AuthContext {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) return { user: null }
        return r.json()
      })
      .then((d) => { if (!cancelled) setUser(d?.user ?? null) })
      .catch(() => { if (!cancelled) setUser(null) })
      .finally(() => { if (!cancelled) setLoading(false) })

    // Re-validate session every 5 minutes
    const interval = setInterval(() => {
      fetch("/api/auth/me", { credentials: "include" })
        .then((r) => {
          if (!cancelled && r.status === 401) {
            setUser(null)
            window.location.href = "/login"
          }
        })
        .catch(() => {})
    }, 5 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { credentials: "include" })
      if (r.ok) {
        const d = await r.json()
        setUser(d?.user ?? null)
      }
    } catch {}
  }, [])

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    setUser(null)
    window.location.href = "/"
  }

  return { user, loading, logout, refreshUser }
}
