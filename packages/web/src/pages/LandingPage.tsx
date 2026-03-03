import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6">
      <h1 className="text-4xl font-bold tracking-tight">peon.work</h1>
      <p className="text-muted-foreground text-lg">Launch AI agent teams for your projects</p>
      <Button size="lg" onClick={() => navigate("/login")}>
        Sign in with Google
      </Button>
    </div>
  )
}
