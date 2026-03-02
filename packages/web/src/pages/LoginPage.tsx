import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-[400px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">femrun</CardTitle>
          <CardDescription>
            Launch AI agent teams for your projects
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/api/auth/google">
            <Button className="w-full" size="lg">
              Sign in with Google
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
