import { toast } from "sonner"

const BASE = ""

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...opts?.headers },
      ...opts,
    })
  } catch {
    toast.error("Network error — check your connection")
    throw new Error("Network error")
  }
  if (res.status === 401) {
    // Session expired — redirect to login
    window.location.href = "/login"
    throw new Error("Session expired")
  }
  if (!res.ok) {
    const body = await res.text()
    toast.error(body || `Request failed (${res.status})`)
    throw new Error(`API ${res.status}: ${body}`)
  }
  return res.json()
}

// Projects
export const getProjects = () => request<{ projects: Project[] }>("/api/projects")
export const getProject = (id: string) => request<{ project: Project }>(`/api/projects/${id}`)
export const getProjectStatus = (id: string) =>
  request<{ status: Project["status"] }>(`/api/projects/${id}/status`)
export const createProject = (data: CreateProjectInput) =>
  request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(data) })
export const deleteProject = (id: string) =>
  request<void>(`/api/projects/${id}`, { method: "DELETE" })
export const restartProject = (id: string) =>
  request<{ status: string }>(`/api/projects/${id}/restart`, { method: "POST" })
export const updateProject = (id: string, data: { name?: string }) =>
  request<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) })

// GitHub
export const getGithubRepos = () =>
  request<{ repos: GithubRepo[] }>("/api/auth/github/repos")
export const disconnectGithub = () =>
  request<{ ok: boolean }>("/api/auth/github", { method: "DELETE" })

// API Keys
export const getApiKeys = () =>
  request<{ keys: ApiKeyInfo[]; oauthConnections: OAuthConnection[] }>("/api/keys")
export const addApiKey = (data: { provider: string; key: string; label?: string }) =>
  request<{ key: ApiKeyInfo }>("/api/keys", { method: "POST", body: JSON.stringify(data) })
export const deleteApiKey = (id: string) =>
  request<{ ok: boolean }>(`/api/keys/${id}`, { method: "DELETE" })

// OAuth
export const initClaudeOAuth = () =>
  request<{ authUrl: string }>("/api/auth/claude-oauth/web-init", { method: "POST" })
export const exchangeClaudeOAuth = (authCode: string) =>
  request<{ ok: boolean }>("/api/auth/claude-oauth/web-exchange", {
    method: "POST",
    body: JSON.stringify({ authCode }),
  })
export const disconnectOAuth = (provider: string) =>
  request<{ ok: boolean }>(`/api/keys/oauth/${provider}`, { method: "DELETE" })

// Account
export const deleteAccount = () =>
  request<{ ok: boolean }>("/api/user", { method: "DELETE" })

// Chat (project-scoped)
export const getChatHistory = (projectId: string) =>
  request<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat`)
export const sendChatMessage = (projectId: string, content: string) =>
  request<{ message: ChatMessage }>(`/api/projects/${projectId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })

// Master chat (global orchestrator)
export const getMasterChatHistory = () =>
  request<{ messages: MasterChatMessage[] }>("/api/chat")
export const sendMasterChatMessage = (content: string) =>
  request<{ message: MasterChatMessage }>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ content }),
  })

// Teams
export const getProjectTeams = (projectId: string) =>
  request<{ teams: Team[] }>(`/api/projects/${projectId}/teams`)

export const createTeam = (
  projectId: string,
  data: { name: string; members: Omit<TeamMember, "id">[] }
) =>
  request<{ team: Team }>(`/api/projects/${projectId}/teams`, {
    method: "POST",
    body: JSON.stringify(data),
  })

export const addTeamMember = (teamId: string, data: Omit<TeamMember, "id">) =>
  request<{ member: TeamMember }>(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify(data),
  })

export const deleteTeamMember = (teamId: string, memberId: string) =>
  request<{ ok: boolean }>(`/api/teams/${teamId}/members/${memberId}`, { method: "DELETE" })

// Board/task APIs (project-scoped)
import type { ClaudeTeamConfig, ClaudeTeamMember, ClaudeTask } from "../../server/types"
import { getTemplate } from "./templates"

export async function fetchTeamConfig(projectId: string): Promise<ClaudeTeamConfig> {
  // Try DB teams first, fall back to template for old projects
  let dbMembers: ClaudeTeamMember[] | null = null
  try {
    const { teams } = await getProjectTeams(projectId)
    const first = teams[0]
    if (first && first.members.length > 0) {
      dbMembers = first.members.map((m) => ({
        agentId: m.roleName.toLowerCase(),
        name: m.roleName.toLowerCase(),
        agentType: m.displayName,
        model: "claude-sonnet-4-6",
        color: m.color,
        joinedAt: Date.now(),
        tmuxPaneId: "",
        cwd: "",
        subscriptions: [],
      }))
    }
  } catch {
    // Fall through to template-based
  }

  const { project } = await request<{ project: Project }>(`/api/projects/${projectId}`)

  if (dbMembers && dbMembers.length > 0) {
    return {
      name: project.name,
      description: "",
      createdAt: Date.now(),
      leadAgentId: dbMembers[0]?.agentId ?? "",
      leadSessionId: "",
      members: dbMembers,
    }
  }

  // Template fallback for old projects
  const tmpl = getTemplate(project.templateId)
  const members: ClaudeTeamMember[] = tmpl?.agents.map((a) => ({
    agentId: a.role.toLowerCase(),
    name: a.role.toLowerCase(),
    agentType: a.role,
    model: "claude-sonnet-4-6",
    color: a.color,
    joinedAt: Date.now(),
    tmuxPaneId: "",
    cwd: "",
    subscriptions: [],
  })) ?? []

  return {
    name: project.name,
    description: tmpl?.desc ?? "",
    createdAt: Date.now(),
    leadAgentId: members[0]?.agentId ?? "",
    leadSessionId: "",
    members,
  }
}

export async function fetchTasks(projectId: string): Promise<ClaudeTask[]> {
  const { tasks } = await request<{ tasks: ClaudeTask[] }>(`/api/projects/${projectId}/tasks`)
  return tasks
}

export async function createTask(
  projectId: string,
  data: { subject: string; description?: string }
): Promise<ClaudeTask> {
  const { task } = await request<{ task: ClaudeTask }>(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(data),
  })
  return task
}

export async function updateTask(
  projectId: string,
  id: string,
  data: Partial<Pick<ClaudeTask, "status" | "owner">> & { boardColumn?: string }
): Promise<ClaudeTask> {
  const { task } = await request<{ task: ClaudeTask }>(`/api/projects/${projectId}/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
  return task
}

export async function deleteTask(projectId: string, id: string): Promise<void> {
  await request<void>(`/api/projects/${projectId}/tasks/${id}`, { method: "DELETE" })
}

// Types
export interface Project {
  id: string
  name: string
  repoUrl: string | null
  templateId: string
  status: "creating" | "running" | "stopped" | "error"
  createdAt: string
  updatedAt: string
}

export interface TeamMember {
  id: string
  roleName: string
  displayName: string
  systemPrompt: string
  color: string
}

export interface Team {
  id: string
  projectId: string
  name: string
  members: TeamMember[]
}

export interface TeamMemberInput {
  roleName: string
  displayName: string
  systemPrompt: string
  color: string
}

export interface CreateProjectInput {
  name?: string
  repoUrl?: string
  repoBranch?: string
  templateId?: string
  team?: {
    name: string
    members: TeamMemberInput[]
  }
}

export interface GithubRepo {
  name: string
  fullName: string
  htmlUrl: string
  private: boolean
}

export interface ApiKeyInfo {
  id: string
  provider: string
  label: string
  createdAt: string
}

export interface OAuthConnection {
  provider: string
  authType: string
  label: string
  connectedAt?: string
}

export interface ChatMessage {
  id: string
  projectId: string
  role: "user" | "assistant"
  content: string
  createdAt: string
}

export interface MasterChatMessage {
  id: string
  userId: string | null
  projectId: null
  role: "user" | "assistant"
  content: string
  createdAt: string
}
