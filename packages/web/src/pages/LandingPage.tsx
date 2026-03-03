import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Users,
  Activity,
  Github,
  Key,
  GitBranch,
  Rocket,
  ArrowRight,
  Terminal,
  Zap,
} from "lucide-react"

const FEATURES = [
  {
    icon: Users,
    title: "Agent teams, not single bots",
    description:
      "Deploy a coordinated team — lead, frontend, backend, mobile — each with a focused role. They collaborate, delegate, and ship together.",
  },
  {
    icon: Activity,
    title: "Real-time visibility",
    description:
      "Watch every tool call, file edit, and shell command as it happens. No black boxes. You see exactly what the team is doing and why.",
  },
  {
    icon: Github,
    title: "GitHub-native",
    description:
      "Connect a repo and the agents start in context. They read your code, open branches, and commit work — no copy-paste required.",
  },
]

const STEPS = [
  {
    number: "01",
    icon: Key,
    title: "Connect your API key",
    description: "Bring your own Anthropic key. No markup, no lock-in. You pay the model directly.",
  },
  {
    number: "02",
    icon: GitBranch,
    title: "Pick a repo and template",
    description:
      "Point it at a GitHub repo — or start fresh. Choose a team template: Full Stack, Backend Only, or Mobile.",
  },
  {
    number: "03",
    icon: Rocket,
    title: "Launch and direct",
    description:
      "The team spins up in seconds. Chat with the lead agent to assign work, review progress, and steer direction.",
  },
]

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/40 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="size-5 text-primary" />
            <span className="font-semibold tracking-tight text-lg">peon.work</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/login")}>
            Sign in
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-24 pb-20 text-center">
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <Zap className="size-3 text-primary" />
            Agents that actually ship code
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.08]">
            Your entire engineering
            <br />
            <span className="text-primary">team, automated.</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
            Peon launches a coordinated team of AI agents on your codebase. Not a
            single assistant — a full team with roles, context, and real-time
            collaboration.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <Button size="lg" className="gap-2 px-8 text-base" onClick={() => navigate("/login")}>
              Launch your team
              <ArrowRight className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Bring your own key. No subscription required.
            </span>
          </div>
        </div>
      </section>

      {/* Terminal-style preview strip */}
      <section className="px-6 pb-20">
        <div className="max-w-3xl mx-auto rounded-xl border border-border/60 bg-card overflow-hidden shadow-lg">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/30">
            <div className="size-3 rounded-full bg-destructive/60" />
            <div className="size-3 rounded-full bg-yellow-500/60" />
            <div className="size-3 rounded-full bg-green-500/60" />
            <span className="ml-2 text-xs text-muted-foreground font-mono">
              peon — swift-falcon
            </span>
          </div>
          <div className="p-6 font-mono text-sm leading-7 space-y-1">
            <p>
              <span className="text-muted-foreground">agent:lead</span>
              <span className="text-muted-foreground mx-2">—</span>
              <span className="text-foreground">Delegating auth module to backend agent</span>
            </p>
            <p>
              <span className="text-muted-foreground">agent:backend</span>
              <span className="text-muted-foreground mx-2">—</span>
              <span className="text-green-400">writing</span>
              <span className="text-muted-foreground mx-1">src/auth/jwt.ts</span>
            </p>
            <p>
              <span className="text-muted-foreground">agent:frontend</span>
              <span className="text-muted-foreground mx-2">—</span>
              <span className="text-blue-400">editing</span>
              <span className="text-muted-foreground mx-1">src/components/LoginForm.tsx</span>
            </p>
            <p>
              <span className="text-muted-foreground">agent:backend</span>
              <span className="text-muted-foreground mx-2">—</span>
              <span className="text-yellow-400">running</span>
              <span className="text-muted-foreground mx-1">bun test src/auth</span>
            </p>
            <p>
              <span className="text-muted-foreground">agent:lead</span>
              <span className="text-muted-foreground mx-2">—</span>
              <span className="text-green-400">Tests passing. Opening PR.</span>
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 pb-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-3">
              Built for teams that move fast
            </h2>
            <p className="text-muted-foreground text-base max-w-lg mx-auto">
              Every decision in Peon is designed around one thing: getting real work done, visibly, without getting in your way.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="bg-card/60 border-border/60">
                <CardHeader>
                  <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center mb-1">
                    <Icon className="size-4 text-primary" />
                  </div>
                  <CardTitle className="text-base">{title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 pb-24 border-t border-border/40 pt-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Up and running in minutes</h2>
            <p className="text-muted-foreground text-base">
              No infrastructure. No config files. Just a key and a repo.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(({ number, icon: Icon, title, description }) => (
              <div key={number} className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-primary/60 font-semibold tabular-nums">
                    {number}
                  </span>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
                <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                  <Icon className="size-5 text-foreground/70" />
                </div>
                <div>
                  <h3 className="font-semibold text-base mb-1">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-6 pb-24 pt-4">
        <div className="max-w-2xl mx-auto text-center rounded-2xl border border-border/60 bg-card/50 px-8 py-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Stop writing code alone.
          </h2>
          <p className="text-muted-foreground text-base mb-8 max-w-md mx-auto">
            Connect your API key, pick a repo, and watch a full team of agents get to work. First deploy in under five minutes.
          </p>
          <Button size="lg" className="gap-2 px-10 text-base" onClick={() => navigate("/login")}>
            Get started free
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="size-4" />
            <span>peon.work</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Bring your own Anthropic key. Your data, your models.
          </p>
        </div>
      </footer>
    </div>
  )
}
