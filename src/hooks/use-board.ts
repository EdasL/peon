import { useState, useEffect, useCallback, useRef } from "react"
import type { ClaudeTask, BoardColumn, BoardTask } from "../../server/types"
import { fetchTasks, createTask, updateTask, deleteTask } from "@/lib/api"
import { toBoardTasks, detectTransitions } from "@/lib/state-machine"

const POLL_INTERVAL = 5000

interface BoardState {
  tasks: BoardTask[]
  loading: boolean
  error: string | null
}

export function useBoard(teamName: string) {
  const [state, setState] = useState<BoardState>({
    tasks: [],
    loading: true,
    error: null,
  })
  const [columnMap, setColumnMap] = useState<Record<string, BoardColumn>>({})
  const prevTasksRef = useRef<BoardTask[]>([])

  const load = useCallback(async () => {
    try {
      const raw = await fetchTasks(teamName)

      // Detect transitions from previous state
      if (prevTasksRef.current.length > 0) {
        const transitions = detectTransitions(
          prevTasksRef.current,
          raw,
          columnMap
        )
        if (transitions.length > 0) {
          const newMap = { ...columnMap }
          for (const t of transitions) {
            newMap[t.taskId] = t.column
            // Apply status/owner updates if needed
            if (t.updates.status || t.updates.owner) {
              try {
                await updateTask(teamName, t.taskId, t.updates)
              } catch {
                // Best effort — backend might not be ready
              }
            }
          }
          setColumnMap(newMap)
        }
      }

      const boardTasks = toBoardTasks(raw, columnMap)
      prevTasksRef.current = boardTasks
      setState({ tasks: boardTasks, loading: false, error: null })
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: "Failed to load tasks",
      }))
    }
  }, [teamName, columnMap])

  // Initial load + polling
  useEffect(() => {
    load()
    const id = setInterval(load, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [load])

  const addTask = useCallback(
    async (subject: string) => {
      try {
        await createTask(teamName, { subject })
        await load()
      } catch {
        // Graceful — task creation might fail if backend isn't ready
      }
    },
    [teamName, load]
  )

  const moveTask = useCallback(
    async (taskId: string, toColumn: BoardColumn) => {
      // Update local column map immediately for responsive UI
      setColumnMap((prev) => ({ ...prev, [taskId]: toColumn }))

      // Determine what status/owner changes this column move implies
      const updates: Partial<Pick<ClaudeTask, "status" | "owner">> = {}
      switch (toColumn) {
        case "backlog":
          updates.status = "pending"
          updates.owner = ""
          break
        case "todo":
          updates.status = "pending"
          break
        case "in_progress":
          updates.status = "in_progress"
          break
        case "qa":
          updates.status = "pending"
          updates.owner = "qa"
          break
        case "done":
          updates.status = "completed"
          break
      }

      try {
        await updateTask(teamName, taskId, updates)
        await load()
      } catch {
        // Best effort
      }
    },
    [teamName, load]
  )

  const removeTask = useCallback(
    async (taskId: string) => {
      // Optimistic: remove from UI
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== taskId),
      }))
      try {
        await deleteTask(teamName, taskId)
      } catch {
        // Reload to restore if delete failed
        await load()
      }
    },
    [teamName, load]
  )

  return { ...state, addTask, moveTask, removeTask }
}
