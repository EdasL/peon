import { Button } from "@/components/ui/button"

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-[360px] text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] mb-2">peon.work</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Launch AI agent teams for your projects
        </p>
        <a href="/api/auth/google">
          <Button className="w-full" size="lg">
            Sign in with Google
          </Button>
        </a>
      </div>
    </div>
  )
}
