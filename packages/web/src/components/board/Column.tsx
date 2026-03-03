import { useDroppable } from "@dnd-kit/core"
import type { BoardColumn, BoardTask } from "../../../server/types"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TaskCard } from "./TaskCard"
import { AddTask } from "./AddTask"
import { cn } from "@/lib/utils"

interface ColumnProps {
  id: BoardColumn
  label: string
  tasks: BoardTask[]
  onAddTask?: (subject: string) => void
  onDeleteTask: (id: string) => void
}

export function Column({
  id,
  label,
  tasks,
  onAddTask,
  onDeleteTask,
}: ColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id })

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "flex h-full flex-col gap-0 border-border/40 bg-card/40 transition-colors",
        isOver && "border-primary/40 bg-primary/5"
      )}
    >
      <CardHeader className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] font-normal">
            {tasks.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-3 pb-3">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-2 pr-2">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onDelete={onDeleteTask} />
            ))}
            {tasks.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <span className="text-xs text-muted-foreground/50">
                  No tasks
                </span>
              </div>
            )}
          </div>
        </ScrollArea>
        {onAddTask && (
          <div className="mt-2">
            <AddTask onAdd={onAddTask} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
