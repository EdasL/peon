import type { ClaudeTask } from "../../../server/types"
import type { TeamMember } from "@/lib/api"
import { getAgentColor, getAgentDisplayName, bgToText } from "@/lib/agent-utils"
import { User } from "lucide-react"

export function KanbanCard({
  task,
  teamMembers,
  templateId,
}: {
  task: ClaudeTask
  teamMembers?: TeamMember[]
  templateId?: string
}) {
  const ownerColor = task.owner
    ? getAgentColor(task.owner, teamMembers, templateId)
    : null
  const ownerName = task.owner
    ? getAgentDisplayName(task.owner, teamMembers)
    : null

  return (
    <div className="rounded-lg border border-border/40 bg-zinc-900/60 p-3 space-y-2 hover:border-border/70 transition-colors">
      <p className="text-[13px] font-medium text-zinc-100 leading-snug">
        {task.subject}
      </p>

      {task.description && (
        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
          {task.description}
        </p>
      )}

      {ownerName && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className={`size-1.5 rounded-full ${ownerColor}`} />
          <span className={`text-[11px] font-medium ${bgToText(ownerColor!)}`}>
            {ownerName}
          </span>
        </div>
      )}

      {!ownerName && (
        <div className="flex items-center gap-1.5 pt-0.5 text-zinc-600">
          <User className="size-3" />
          <span className="text-[11px]">Unassigned</span>
        </div>
      )}
    </div>
  )
}
