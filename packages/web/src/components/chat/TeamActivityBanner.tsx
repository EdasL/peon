import { Loader2, Wrench } from "lucide-react"
import type { TeamActivityEvent } from "@/hooks/use-chat"

function describeActivity(event: TeamActivityEvent): string {
  const tool = event.tool.toLowerCase()
  const target = event.text

  switch (tool) {
    case "read": return target ? `Reading ${target}` : "Reading file"
    case "write": return target ? `Creating ${target}` : "Creating file"
    case "edit":
    case "multiedit":
    case "streplace": return target ? `Editing ${target}` : "Editing file"
    case "bash":
    case "exec":
    case "shell": return target ? `Running ${target}` : "Running command"
    case "grep": return target ? `Searching ${target}` : "Searching code"
    case "glob": return target ? `Scanning ${target}` : "Scanning files"
    case "webbrowser":
    case "webfetch": return "Fetching from web"
    case "websearch": return "Searching web"
    default: return target ? `${event.tool} ${target}` : event.tool
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + "…"
}

export function TeamActivityBanner({ activities }: { activities: TeamActivityEvent[] }) {
  // Show the most recent 4 activities, newest first
  const recent = activities.slice(-4).reverse()
  const anyLoading = activities.some((a) => a.loading)

  return (
    <div className="mx-3 my-2 rounded-sm border border-border/50 bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30">
        {anyLoading ? (
          <Loader2 className="h-3 w-3 text-primary shrink-0 animate-spin" />
        ) : (
          <span className="size-1.5 rounded-full bg-[#22C55E] animate-pulse" />
        )}
        <span className="text-[11px] font-medium text-muted-foreground">
          Team working
        </span>
      </div>
      <div className="px-3 py-1.5 space-y-0.5">
        {recent.map((activity, i) => (
          <div key={`${activity.timestamp}-${i}`} className="flex items-center gap-1.5">
            {activity.loading ? (
              <Loader2 className="h-2.5 w-2.5 text-primary shrink-0 animate-spin" />
            ) : (
              <Wrench className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
            )}
            {activity.agentName && (
              <span className="text-[10px] font-medium text-muted-foreground/70">
                {activity.agentName}:
              </span>
            )}
            <span className="text-[11px] font-mono text-muted-foreground truncate">
              {truncate(describeActivity(activity), 60)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
