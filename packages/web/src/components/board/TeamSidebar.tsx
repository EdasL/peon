import type { ClaudeTeamConfig } from "../../../server/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

function getInitials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

const COLOR_MAP: Record<string, string> = {
  green: "bg-emerald-600",
  yellow: "bg-amber-600",
  purple: "bg-violet-600",
  blue: "bg-blue-600",
  red: "bg-red-600",
  orange: "bg-orange-600",
  pink: "bg-pink-600",
  cyan: "bg-cyan-600",
}

interface TeamSidebarProps {
  team: ClaudeTeamConfig
}

export function TeamSidebar({ team }: TeamSidebarProps) {
  const nonLeadMembers = team.members.filter(
    (m) => m.agentId !== team.leadAgentId
  )

  if (nonLeadMembers.length === 0) return null

  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-border/40 bg-background">
      <div className="px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Team Members
        </h2>
      </div>
      <Separator />
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {nonLeadMembers.map((member) => (
          <div
            key={member.agentId}
            className="flex items-center gap-3 rounded-md px-2 py-2"
          >
            <Avatar size="sm">
              <AvatarFallback
                className={`text-[10px] text-white ${COLOR_MAP[member.color ?? ""] ?? "bg-muted-foreground"}`}
              >
                {getInitials(member.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {member.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {member.agentType}
              </span>
            </div>
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {member.model}
            </Badge>
          </div>
        ))}
      </div>
    </aside>
  )
}
