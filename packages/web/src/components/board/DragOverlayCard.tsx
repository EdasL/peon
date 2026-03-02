import type { BoardTask } from "../../../server/types"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface DragOverlayCardProps {
  task: BoardTask
}

export function DragOverlayCard({ task }: DragOverlayCardProps) {
  return (
    <Card className="w-64 gap-3 border-primary/50 bg-card p-3 shadow-lg shadow-primary/10">
      <p className="text-sm font-medium leading-snug">{task.subject}</p>
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
    </Card>
  )
}
