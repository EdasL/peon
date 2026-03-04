/**
 * useWorkspaceFile — Read/write a single workspace file via OpenClaw RPC.
 *
 * Uses rpc('workspace.read', { path }) and rpc('workspace.write', { path, content })
 * instead of direct REST calls, so it works through the Peon gateway WS proxy.
 */

import { useState, useCallback, useRef } from "react"
import { useOpenClaw } from "@/contexts/OpenClawContext"

interface WorkspaceFileState {
  content: string | null
  isLoading: boolean
  error: string | null
  exists: boolean
}

export function useWorkspaceFile() {
  const { rpc } = useOpenClaw()
  const [state, setState] = useState<WorkspaceFileState>({
    content: null,
    isLoading: false,
    error: null,
    exists: false,
  })
  const abortRef = useRef(0)

  const load = useCallback(
    async (path: string) => {
      const gen = ++abortRef.current
      setState((s) => ({ ...s, isLoading: true, error: null }))
      try {
        const result = (await rpc("workspace.read", { path })) as {
          content?: string
          exists?: boolean
        } | null
        if (gen !== abortRef.current) return
        if (!result || result.exists === false) {
          setState({ content: null, isLoading: false, error: null, exists: false })
          return
        }
        setState({
          content: result.content ?? "",
          isLoading: false,
          error: null,
          exists: true,
        })
      } catch (err) {
        if (gen !== abortRef.current) return
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes("not found") || msg.includes("ENOENT") || msg.includes("404")) {
          setState({ content: null, isLoading: false, error: null, exists: false })
        } else {
          setState((s) => ({ ...s, isLoading: false, error: msg }))
        }
      }
    },
    [rpc],
  )

  const save = useCallback(
    async (path: string, content: string): Promise<boolean> => {
      setState((s) => ({ ...s, isLoading: true, error: null }))
      try {
        await rpc("workspace.write", { path, content })
        setState({ content, isLoading: false, error: null, exists: true })
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, isLoading: false, error: msg }))
        return false
      }
    },
    [rpc],
  )

  return { ...state, load, save }
}
