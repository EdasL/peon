import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthCtx, useAuthProvider } from "@/hooks/use-auth"
import { useAuth } from "@/hooks/use-auth"
import { LoginPage } from "@/pages/LoginPage"
import { OnboardingPage } from "@/pages/OnboardingPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { ProjectPage } from "@/pages/ProjectPage"

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>
  if (!user) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const auth = useAuthProvider()

  return (
    <AuthCtx.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={auth.user ? <Navigate to="/dashboard" /> : <LoginPage />} />
          <Route path="/onboarding" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
          <Route path="/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
          <Route path="/project/:id" element={<AuthGuard><ProjectPage /></AuthGuard>} />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  )
}
