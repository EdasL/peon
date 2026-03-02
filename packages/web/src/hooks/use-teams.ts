import { useState, useEffect, useCallback } from "react"
import type { ClaudeTeamConfig } from "../../server/types"
import { fetchTeams } from "@/lib/api"

interface TeamsState {
  teams: ClaudeTeamConfig[]
  loading: boolean
  error: string | null
}

export function useTeams() {
  const [state, setState] = useState<TeamsState>({
    teams: [],
    loading: true,
    error: null,
  })

  const load = useCallback(async () => {
    try {
      const teams = await fetchTeams()
      setState({ teams, loading: false, error: null })
    } catch {
      setState({ teams: [], loading: false, error: "Failed to load teams" })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, refresh: load }
}
