import type { GranularAgentState } from "@/lib/openclaw-types"

export function getStatusBadgeText(state: GranularAgentState): string {
  if (state.toolName) return `TOOL: ${state.toolName}`
  return state.status
}

export function getStatusBadgeClasses(state: GranularAgentState): string {
  if (state.toolName) {
    return "bg-blue-500/20 text-blue-400 animate-pulse"
  }

  switch (state.status) {
    case "THINKING":
      return "bg-orange-500/20 text-orange-400 animate-pulse"
    case "STREAMING":
      return "bg-green-500/20 text-green-400 animate-pulse"
    case "DONE":
      return "bg-green-500/20 text-green-400"
    case "ERROR":
      return "bg-red-500/20 text-red-400"
    case "IDLE":
    default:
      return "bg-muted-foreground/20 text-muted-foreground"
  }
}
