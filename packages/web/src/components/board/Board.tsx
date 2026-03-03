import { useState, useEffect } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import type { BoardColumn, BoardTask, ClaudeTeamConfig } from "../../../server/types"
import { useBoard } from "@/hooks/use-board"
import { fetchTeamConfig } from "@/lib/api"
import { COLUMNS } from "@/lib/state-machine"
import { Column } from "./Column"
import { DragOverlayCard } from "./DragOverlayCard"
import { TeamSidebar } from "./TeamSidebar"

interface BoardProps {
  teamName: string
}

export function Board({ teamName }: BoardProps) {
  const { tasks, loading, error, addTask, moveTask, removeTask } =
    useBoard(teamName)
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null)
  const [teamConfig, setTeamConfig] = useState<ClaudeTeamConfig | null>(null)

  useEffect(() => {
    fetchTeamConfig(teamName).then(setTeamConfig).catch(() => {})
  }, [teamName])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as BoardTask | undefined
    if (task) setActiveTask(task)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return

    const taskId = active.id as string
    const toColumn = over.id as BoardColumn
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.boardColumn === toColumn) return

    moveTask(taskId, toColumn)
  }

  const tasksByColumn = new Map<BoardColumn, BoardTask[]>()
  for (const col of COLUMNS) {
    tasksByColumn.set(col.id, [])
  }
  for (const task of tasks) {
    const list = tasksByColumn.get(task.boardColumn)
    if (list) list.push(task)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto p-4">
            <div className="grid h-full min-w-[1100px] grid-cols-5 gap-3">
              {COLUMNS.map((col) => (
                <Column
                  key={col.id}
                  id={col.id}
                  label={col.label}
                  tasks={tasksByColumn.get(col.id) ?? []}
                  onAddTask={col.id === "backlog" ? addTask : undefined}
                  onDeleteTask={removeTask}
                />
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask ? <DragOverlayCard task={activeTask} /> : null}
          </DragOverlay>
        </DndContext>

        {teamConfig && <TeamSidebar team={teamConfig} />}
      </div>
    </div>
  )
}
