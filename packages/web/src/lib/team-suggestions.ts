export interface SuggestedMember {
  role: string
  name: string
  prompt: string
  color: string
}

export const ROLE_PROMPTS: Record<string, string> = {
  lead: "You are the project lead. You coordinate the team, break down tasks into sub-tasks, assign work to specialists, and ensure delivery quality.",
  frontend:
    "You specialize in React, TypeScript, and Tailwind CSS. You own all UI components, pages, hooks, and styling.",
  backend:
    "You specialize in Node.js, APIs, and databases. You own API routes, database schema, migrations, and server logic.",
  qa: "You write and run tests, catch regressions, and review code for quality. You own the test suite.",
  mobile:
    "You specialize in mobile development. You own native/cross-platform implementation, navigation, and platform APIs.",
  engineer:
    "You are a generalist software engineer. You implement features, fix bugs, and write clean, tested code.",
}

const ROLE_NAMES: Record<string, string> = {
  lead: "Lead",
  frontend: "Frontend Engineer",
  backend: "Backend Engineer",
  qa: "QA Engineer",
  mobile: "Mobile Engineer",
  engineer: "Engineer",
}

const ROLE_COLORS: Record<string, string> = {
  lead: "bg-blue-500",
  frontend: "bg-emerald-500",
  backend: "bg-violet-500",
  qa: "bg-amber-500",
  mobile: "bg-cyan-500",
  engineer: "bg-zinc-500",
}

function makeMember(role: string): SuggestedMember {
  return {
    role,
    name: ROLE_NAMES[role] ?? role,
    prompt: ROLE_PROMPTS[role] ?? "",
    color: ROLE_COLORS[role] ?? "bg-zinc-500",
  }
}

const KEYWORD_PATTERNS: Array<{ pattern: RegExp; roles: string[] }> = [
  {
    pattern: /react|frontend|ui|css|tailwind|component/i,
    roles: ["lead", "frontend", "qa"],
  },
  {
    pattern: /api|backend|server|database|postgres|mongo|express|node/i,
    roles: ["lead", "backend", "qa"],
  },
  {
    pattern: /fullstack|full-stack|full stack|app|web app/i,
    roles: ["lead", "frontend", "backend", "qa"],
  },
  {
    pattern: /mobile|ios|android|react native|flutter/i,
    roles: ["lead", "mobile", "qa"],
  },
]

export function suggestTeam(goal: string): SuggestedMember[] {
  const matched = new Set<string>()

  for (const { pattern, roles } of KEYWORD_PATTERNS) {
    if (pattern.test(goal)) {
      for (const role of roles) matched.add(role)
    }
  }

  if (matched.size === 0) {
    return [makeMember("lead"), makeMember("engineer"), makeMember("qa")]
  }

  // Preserve a stable order: lead first, qa last, others in between
  const ORDER = ["lead", "frontend", "backend", "mobile", "engineer", "qa"]
  const sorted = Array.from(matched).sort(
    (a, b) => (ORDER.indexOf(a) ?? 99) - (ORDER.indexOf(b) ?? 99)
  )

  return sorted.map(makeMember)
}
