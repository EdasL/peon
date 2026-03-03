import type { ClaudeTask } from "../../../server/types"
import type { TeamMember } from "@/lib/api"
import { ScrollArea } from "@/components/ui/scroll-area"
import { KanbanCard } from "./KanbanCard"

export function KanbanColumn({
  title,
  tasks,
  accentColor,
  teamMembers,
  templateId,
}: {
  title: string
  tasks: ClaudeTask[]
  accentColor: string
  teamMembers?: TeamMember[]
  templateId?: string
}) {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0">
        <span className={`size-2 rounded-full ${accentColor}`} />
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
          {title}
        </h3>
        <span className="text-[11px] text-zinc-600 tabular-nums">
          {tasks.length}
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-2 px-2 pb-2">
          {tasks.length === 0 && (
            <p className="text-xs text-zinc-700 text-center py-8">
              No tasks
            </p>
          )}
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              teamMembers={teamMembers}
              templateId={templateId}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
