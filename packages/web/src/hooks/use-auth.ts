import { useState, useEffect, createContext, useContext } from "react"

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
}

export const AuthCtx = createContext<AuthContext>({
  user: null,
  loading: true,
  logout: async () => {},
})

export function useAuth() {
  return useContext(AuthCtx)
}

export function useAuthProvider(): AuthContext {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    setUser(null)
    window.location.href = "/"
  }

  return { user, loading, logout }
}
