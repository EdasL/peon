import { useState, useEffect, useCallback, useRef } from "react"
import type { ClaudeTask, BoardColumn, BoardTask } from "../../server/types"
import { fetchTasks, createTask, updateTask, deleteTask } from "@/lib/api"
import { toBoardTasks } from "@/lib/state-machine"

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
  const columnMapRef = useRef(columnMap)
  columnMapRef.current = columnMap

  // Initial load
  useEffect(() => {
    fetchTasks(teamName)
      .then((raw) => {
        const boardTasks = toBoardTasks(raw, columnMapRef.current)
        setState({ tasks: boardTasks, loading: false, error: null })
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loading: false, error: "Failed to load tasks" }))
      })
  }, [teamName])

  // SSE for real-time updates
  useEffect(() => {
    const es = new EventSource(`/api/projects/${teamName}/chat/stream`, { withCredentials: true })

    es.addEventListener("task_update", (e) => {
      const task = JSON.parse(e.data) as ClaudeTask & { boardColumn?: string }
      setState((prev) => {
        const existing = prev.tasks.findIndex((t) => t.id === task.id)
        const boardColumn = (task.boardColumn ?? columnMapRef.current[task.id] ?? "backlog") as BoardColumn
        const boardTask: BoardTask = {
          ...task,
          boardColumn,
          blocks: task.blocks ?? [],
          blockedBy: task.blockedBy ?? [],
        }

        if (existing >= 0) {
          const updated = [...prev.tasks]
          updated[existing] = boardTask
          return { ...prev, tasks: updated }
        }
        return { ...prev, tasks: [...prev.tasks, boardTask] }
      })
    })

    es.addEventListener("task_delete", (e) => {
      const { id } = JSON.parse(e.data) as { id: string }
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== id),
      }))
    })

    return () => es.close()
  }, [teamName])

  const addTask = useCallback(
    async (subject: string) => {
      try {
        await createTask(teamName, { subject })
        // SSE will deliver the update
      } catch {
        // Graceful
      }
    },
    [teamName]
  )

  const moveTask = useCallback(
    async (taskId: string, toColumn: BoardColumn) => {
      // Update local column map immediately for responsive UI
      setColumnMap((prev) => ({ ...prev, [taskId]: toColumn }))

      // Optimistic local update
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => t.id === taskId ? { ...t, boardColumn: toColumn } : t),
      }))

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
        await updateTask(teamName, taskId, { ...updates, boardColumn: toColumn })
        // SSE will deliver the confirmed update
      } catch {
        // Reload on failure to restore correct state
        const raw = await fetchTasks(teamName)
        const boardTasks = toBoardTasks(raw, columnMapRef.current)
        setState({ tasks: boardTasks, loading: false, error: null })
      }
    },
    [teamName]
  )

  const removeTask = useCallback(
    async (taskId: string) => {
      // Optimistic remove
      setState((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== taskId),
      }))
      try {
        await deleteTask(teamName, taskId)
        // SSE will confirm the delete
      } catch {
        // Reload on failure
        const raw = await fetchTasks(teamName)
        const boardTasks = toBoardTasks(raw, columnMapRef.current)
        setState({ tasks: boardTasks, loading: false, error: null })
      }
    },
    [teamName]
  )

  return { ...state, addTask, moveTask, removeTask }
}
