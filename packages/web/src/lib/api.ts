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
export const createProject = (data: CreateProjectInput) =>
  request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(data) })
export const deleteProject = (id: string) =>
  request<{ project: Project }>(`/api/projects/${id}`, { method: "DELETE" })

// GitHub
export const getGithubRepos = () =>
  request<{ repos: GithubRepo[] }>("/api/auth/github/repos")
export const disconnectGithub = () =>
  request<{ ok: boolean }>("/api/auth/github", { method: "DELETE" })

// API Keys
export const getApiKeys = () => request<{ keys: ApiKeyInfo[] }>("/api/keys")
export const addApiKey = (data: { provider: string; key: string; label?: string }) =>
  request<{ key: ApiKeyInfo }>("/api/keys", { method: "POST", body: JSON.stringify(data) })
export const deleteApiKey = (id: string) =>
  request<{ ok: boolean }>(`/api/keys/${id}`, { method: "DELETE" })

// Account
export const deleteAccount = () =>
  request<{ ok: boolean }>("/api/user", { method: "DELETE" })

// Chat
export const getChatHistory = (projectId: string) =>
  request<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat`)
export const sendChatMessage = (projectId: string, content: string) =>
  request<{ message: ChatMessage }>(`/api/projects/${projectId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })

// Board/task APIs (project-scoped)
import type { ClaudeTeamConfig, ClaudeTask } from "../../server/types"

export async function fetchTeams(): Promise<ClaudeTeamConfig[]> {
  // Not used in multi-user mode — return empty
  return []
}

export async function fetchTeamConfig(projectId: string): Promise<ClaudeTeamConfig> {
  const { project } = await request<{ project: Project }>(`/api/projects/${projectId}`)
  return { name: project.name, members: [], taskList: project.id } as unknown as ClaudeTeamConfig
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
  data: Partial<Pick<ClaudeTask, "status" | "owner">>
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

export interface CreateProjectInput {
  name: string
  repoUrl?: string
  repoBranch?: string
  templateId: string
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

export interface ChatMessage {
  id: string
  projectId: string
  role: "user" | "assistant"
  content: string
  createdAt: string
}
