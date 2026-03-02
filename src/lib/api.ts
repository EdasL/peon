import type { ClaudeTeamConfig, ClaudeTask } from "../../server/types"

const BASE = "/api"

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export async function fetchTeams(): Promise<ClaudeTeamConfig[]> {
  return fetchJSON<ClaudeTeamConfig[]>(`${BASE}/teams`)
}

export async function fetchTeamConfig(
  name: string
): Promise<ClaudeTeamConfig> {
  return fetchJSON<ClaudeTeamConfig>(`${BASE}/teams/${name}/config`)
}

export async function fetchTasks(name: string): Promise<ClaudeTask[]> {
  return fetchJSON<ClaudeTask[]>(`${BASE}/teams/${name}/tasks`)
}

export async function createTask(
  name: string,
  data: { subject: string; description?: string }
): Promise<ClaudeTask> {
  return fetchJSON<ClaudeTask>(`${BASE}/teams/${name}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

export async function updateTask(
  name: string,
  id: string,
  data: Partial<Pick<ClaudeTask, "status" | "owner">>
): Promise<ClaudeTask> {
  return fetchJSON<ClaudeTask>(`${BASE}/teams/${name}/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
}

export async function deleteTask(name: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/teams/${name}/tasks/${id}`, {
    method: "DELETE",
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}
