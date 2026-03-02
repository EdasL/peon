const BASE = ""

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

// Projects
export const getProjects = () => request<{ projects: Project[] }>("/api/projects")
export const createProject = (data: CreateProjectInput) =>
  request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(data) })
export const deleteProject = (id: string) =>
  request<{ project: Project }>(`/api/projects/${id}`, { method: "DELETE" })

// GitHub
export const getGithubRepos = () =>
  request<{ repos: GithubRepo[] }>("/api/auth/github/repos")

// API Keys
export const getApiKeys = () => request<{ keys: ApiKeyInfo[] }>("/api/keys")
export const addApiKey = (data: { provider: string; key: string; label?: string }) =>
  request<{ key: ApiKeyInfo }>("/api/keys", { method: "POST", body: JSON.stringify(data) })
export const deleteApiKey = (id: string) =>
  request<{ ok: boolean }>(`/api/keys/${id}`, { method: "DELETE" })

// Chat
export const getChatHistory = (projectId: string) =>
  request<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat`)
export const sendChatMessage = (projectId: string, content: string) =>
  request<{ message: ChatMessage }>(`/api/projects/${projectId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })

// Legacy team APIs (for Board component compatibility)
import type { ClaudeTeamConfig, ClaudeTask } from "../../server/types"

export async function fetchTeams(): Promise<ClaudeTeamConfig[]> {
  return request<ClaudeTeamConfig[]>("/api/teams")
}

export async function fetchTeamConfig(name: string): Promise<ClaudeTeamConfig> {
  return request<ClaudeTeamConfig>(`/api/teams/${name}/config`)
}

export async function fetchTasks(name: string): Promise<ClaudeTask[]> {
  return request<ClaudeTask[]>(`/api/teams/${name}/tasks`)
}

export async function createTask(
  name: string,
  data: { subject: string; description?: string }
): Promise<ClaudeTask> {
  return request<ClaudeTask>(`/api/teams/${name}/tasks`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export async function updateTask(
  name: string,
  id: string,
  data: Partial<Pick<ClaudeTask, "status" | "owner">>
): Promise<ClaudeTask> {
  return request<ClaudeTask>(`/api/teams/${name}/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export async function deleteTask(name: string, id: string): Promise<void> {
  await request<void>(`/api/teams/${name}/tasks/${id}`, { method: "DELETE" })
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
