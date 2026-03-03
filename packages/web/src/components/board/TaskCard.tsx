import { useDraggable } from "@dnd-kit/core"
import type { BoardTask } from "../../../server/types"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface TaskCardProps {
  task: BoardTask
  onDelete: (id: string) => void
}

export function TaskCard({ task, onDelete }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      data: { task },
    })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "group cursor-grab gap-3 border-border/50 bg-card/80 p-3 transition-all hover:border-ring/30 hover:bg-card active:cursor-grabbing",
        isDragging && "opacity-30"
      )}
    >
      <p className="text-sm font-medium leading-snug">{task.subject}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {task.owner && (
            <Badge variant="secondary" className="text-[10px]">
              {task.owner}
            </Badge>
          )}
          {task.tag && (
            <Badge variant="outline" className="text-[10px]">
              {task.tag}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(task.id)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Delete task"
        >
          <X className="size-3" />
        </Button>
      </div>
    </Card>
  )
}
