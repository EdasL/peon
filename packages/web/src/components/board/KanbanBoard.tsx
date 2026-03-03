import { useMemo } from "react"
import type { ClaudeTask } from "../../../server/types"
import type { TeamMember } from "@/lib/api"
import { KanbanColumn } from "./KanbanColumn"

export function KanbanBoard({
  tasks,
  teamMembers,
  templateId,
}: {
  tasks: ClaudeTask[]
  teamMembers?: TeamMember[]
  templateId?: string
}) {
  const columns = useMemo(() => {
    const todo: ClaudeTask[] = []
    const inProgress: ClaudeTask[] = []
    const done: ClaudeTask[] = []

    for (const task of tasks) {
      switch (task.status) {
        case "in_progress":
          inProgress.push(task)
          break
        case "completed":
          done.push(task)
          break
        default:
          todo.push(task)
          break
      }
    }

    return { todo, inProgress, done }
  }, [tasks])

  return (
    <div className="flex h-full gap-px bg-zinc-950">
      <KanbanColumn
        title="To Do"
        tasks={columns.todo}
        accentColor="bg-zinc-400"
        teamMembers={teamMembers}
        templateId={templateId}
      />
      <div className="w-px bg-border/30 flex-shrink-0" />
      <KanbanColumn
        title="In Progress"
        tasks={columns.inProgress}
        accentColor="bg-amber-400"
        teamMembers={teamMembers}
        templateId={templateId}
      />
      <div className="w-px bg-border/30 flex-shrink-0" />
      <KanbanColumn
        title="Done"
        tasks={columns.done}
        accentColor="bg-emerald-400"
        teamMembers={teamMembers}
        templateId={templateId}
      />
    </div>
  )
}
