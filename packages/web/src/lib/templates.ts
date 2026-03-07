/** Canonical template definitions -- used by onboarding, dashboard, and project pages */

export interface TemplateAgent {
  role: string
  color: string
}

export interface Template {
  id: string
  name: string
  desc: string
  agents: TemplateAgent[]
}

export const TEMPLATES: Template[] = [
  {
    id: "fullteam",
    name: "Full Team",
    desc: "All core roles for large projects",
    agents: [
      { role: "Frontend", color: "bg-emerald-500" },
      { role: "Backend", color: "bg-violet-500" },
      { role: "Designer", color: "bg-pink-500" },
      { role: "Infra", color: "bg-orange-500" },
      { role: "QA", color: "bg-amber-500" },
    ],
  },
  {
    id: "fullstack",
    name: "Full Stack",
    desc: "A complete team for web applications",
    agents: [
      { role: "Frontend", color: "bg-emerald-500" },
      { role: "Backend", color: "bg-violet-500" },
      { role: "QA", color: "bg-amber-500" },
    ],
  },
  {
    id: "backend",
    name: "Backend Only",
    desc: "Focused on server-side development",
    agents: [
      { role: "Backend", color: "bg-violet-500" },
      { role: "Infra", color: "bg-orange-500" },
      { role: "QA", color: "bg-amber-500" },
    ],
  },
  {
    id: "mobile",
    name: "Mobile",
    desc: "Native and cross-platform mobile apps",
    agents: [
      { role: "Designer", color: "bg-pink-500" },
      { role: "Mobile", color: "bg-cyan-500" },
      { role: "QA", color: "bg-amber-500" },
    ],
  },
]

/** Look up a template by ID, returns undefined if not found */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
