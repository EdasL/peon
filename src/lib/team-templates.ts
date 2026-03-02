export interface AgentTemplate {
  name: string
  agentType: string
  model: string
  color: string
  prompt: string
}

export interface TeamTemplate {
  id: string
  label: string
  description: string
  agents: AgentTemplate[]
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "fullstack",
    label: "Full Stack Team",
    description: "Designer, backend, mobile, and QA agents for end-to-end development",
    agents: [
      {
        name: "designer",
        agentType: "designer",
        model: "sonnet",
        color: "green",
        prompt:
          "You are a UI/UX designer agent. Focus on component design, styling, accessibility, and visual consistency across the application.",
      },
      {
        name: "backend-dev",
        agentType: "backend",
        model: "sonnet",
        color: "yellow",
        prompt:
          "You are a backend developer agent. Focus on API design, database schema, server logic, and data validation.",
      },
      {
        name: "mobile-dev",
        agentType: "mobile",
        model: "sonnet",
        color: "purple",
        prompt:
          "You are a mobile/frontend developer agent. Focus on building UI components, state management, and client-side logic.",
      },
      {
        name: "qa",
        agentType: "qa",
        model: "haiku",
        color: "blue",
        prompt:
          "You are a QA agent. Review completed work, write tests, verify acceptance criteria, and report bugs.",
      },
    ],
  },
  {
    id: "backend-only",
    label: "Backend Only",
    description: "Backend developer and QA agents for API and server work",
    agents: [
      {
        name: "backend-dev",
        agentType: "backend",
        model: "sonnet",
        color: "yellow",
        prompt:
          "You are a backend developer agent. Focus on API design, database schema, server logic, and data validation.",
      },
      {
        name: "qa",
        agentType: "qa",
        model: "haiku",
        color: "blue",
        prompt:
          "You are a QA agent. Review completed work, write tests, verify acceptance criteria, and report bugs.",
      },
    ],
  },
  {
    id: "mobile-only",
    label: "Mobile Only",
    description: "Designer, mobile developer, and QA agents for frontend work",
    agents: [
      {
        name: "designer",
        agentType: "designer",
        model: "sonnet",
        color: "green",
        prompt:
          "You are a UI/UX designer agent. Focus on component design, styling, accessibility, and visual consistency.",
      },
      {
        name: "mobile-dev",
        agentType: "mobile",
        model: "sonnet",
        color: "purple",
        prompt:
          "You are a mobile/frontend developer agent. Focus on building UI components, state management, and client-side logic.",
      },
      {
        name: "qa",
        agentType: "qa",
        model: "haiku",
        color: "blue",
        prompt:
          "You are a QA agent. Review completed work, write tests, verify acceptance criteria, and report bugs.",
      },
    ],
  },
]
