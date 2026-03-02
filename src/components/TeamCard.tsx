import type { ClaudeTeamConfig } from "../../server/types"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

function getInitials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-600",
    "bg-emerald-600",
    "bg-violet-600",
    "bg-amber-600",
    "bg-rose-600",
    "bg-cyan-600",
    "bg-pink-600",
    "bg-indigo-600",
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

interface TeamCardProps {
  team: ClaudeTeamConfig
  onClick: () => void
}

export function TeamCard({ team, onClick }: TeamCardProps) {
  return (
    <Card
      className="cursor-pointer transition-all hover:border-ring/40 hover:shadow-md hover:shadow-primary/5 active:scale-[0.99]"
      onClick={onClick}
    >
      <CardHeader>
        <CardTitle className="text-lg">{team.name}</CardTitle>
        {team.description && (
          <CardDescription className="line-clamp-2">
            {team.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          {team.members.length > 0 ? (
            <AvatarGroup>
              {team.members.slice(0, 5).map((m) => (
                <Avatar key={m.agentId} size="sm">
                  <AvatarFallback
                    className={`text-[10px] text-white ${getAvatarColor(m.name)}`}
                  >
                    {getInitials(m.name)}
                  </AvatarFallback>
                </Avatar>
              ))}
            </AvatarGroup>
          ) : (
            <span className="text-xs text-muted-foreground">No members</span>
          )}
          <Badge variant="secondary" className="text-xs">
            {team.members.length} agent{team.members.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
