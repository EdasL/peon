import { getTemplate } from "@/lib/templates"
import type { TeamMember } from "@/lib/api"

const FALLBACK_COLORS: Record<string, string> = {
  lead: "bg-blue-500",
  "team-lead": "bg-blue-500",
  frontend: "bg-emerald-500",
  backend: "bg-violet-500",
  qa: "bg-amber-500",
  designer: "bg-pink-500",
  mobile: "bg-cyan-500",
}

export function getAgentColor(agentName: string, teamMembers?: TeamMember[], templateId?: string): string {
  if (teamMembers?.length) {
    const match = teamMembers.find(
      (m) => m.roleName.toLowerCase() === agentName.toLowerCase()
    )
    if (match) return match.color
  }
  if (templateId) {
    const tmpl = getTemplate(templateId)
    if (tmpl) {
      const match = tmpl.agents.find(
        (a) => a.role.toLowerCase() === agentName.toLowerCase()
      )
      if (match) return match.color
    }
  }
  return FALLBACK_COLORS[agentName.toLowerCase()] ?? "bg-zinc-500"
}

export function getAgentDisplayName(agentName: string, teamMembers?: TeamMember[]): string {
  if (teamMembers?.length) {
    const match = teamMembers.find(
      (m) => m.roleName.toLowerCase() === agentName.toLowerCase()
    )
    if (match) return match.displayName
  }
  return agentName
}

/**
 * Convert a Tailwind bg-* class to its text-* equivalent for inline colored text.
 * e.g. "bg-blue-500" → "text-blue-500"
 */
export function bgToText(bgClass: string): string {
  return bgClass.replace(/^bg-/, "text-")
}

/**
 * Convert a Tailwind bg-* class to a border-* equivalent.
 */
export function bgToBorder(bgClass: string): string {
  return bgClass.replace(/^bg-/, "border-")
}
