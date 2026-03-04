import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { KanbanTask, TaskStatus, TaskPriority } from '../types';

export interface KanbanFilters {
  q: string;
  priority: TaskPriority[];
  assignee: string;
  labels: string[];
}

const EMPTY_FILTERS: KanbanFilters = { q: '', priority: [], assignee: '', labels: [] };

export interface VersionConflictError extends Error {
  latest?: KanbanTask;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string | null;
  version: number;
}

interface WorkerTask {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string | null;
  boardColumn: string;
  metadata?: Record<string, unknown>;
  updatedAt: number;
  blocks?: string[];
  blockedBy?: string[];
}

const BOARD_TO_STATUS: Record<string, TaskStatus> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'in-progress',
  qa: 'review',
  done: 'done',
};

const STATUS_TO_BOARD: Record<TaskStatus, string> = {
  backlog: 'backlog',
  todo: 'todo',
  'in-progress': 'in_progress',
  review: 'qa',
  done: 'done',
  cancelled: 'done',
};

function workerTaskToKanban(t: WorkerTask, index: number): KanbanTask {
  const meta = t.metadata ?? {};
  return {
    id: t.id,
    title: t.subject,
    description: t.description || undefined,
    status: BOARD_TO_STATUS[t.boardColumn] ?? 'backlog',
    priority: (meta.priority as TaskPriority) ?? 'normal',
    createdBy: t.owner ? `agent:${t.owner}` : 'operator',
    createdAt: t.updatedAt,
    updatedAt: t.updatedAt,
    version: 1,
    assignee: t.owner ? `agent:${t.owner}` : undefined,
    labels: (meta.labels as string[]) ?? [],
    columnOrder: (meta.columnOrder as number) ?? index,
    feedback: [],
  };
}

function matchesFilters(task: KanbanTask, filters: KanbanFilters): boolean {
  if (filters.q) {
    const q = filters.q.toLowerCase();
    const inTitle = task.title.toLowerCase().includes(q);
    const inDesc = task.description?.toLowerCase().includes(q);
    if (!inTitle && !inDesc) return false;
  }
  if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
  if (filters.assignee && task.assignee !== filters.assignee) return false;
  if (filters.labels.length > 0 && !filters.labels.some(l => task.labels.includes(l))) return false;
  return true;
}

async function apiRequest<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed (${res.status})`);
  }
  return res.json();
}

export function useKanban(projectId: string) {
  const [allTasks, setAllTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<KanbanFilters>(EMPTY_FILTERS);
  const fetchIdRef = useRef(0);

  const fetchTasks = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!projectId) return;
    const id = ++fetchIdRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await apiRequest<{ tasks: WorkerTask[] }>(`/api/projects/${projectId}/tasks`);
      if (id !== fetchIdRef.current) return;
      setAllTasks((res.tasks ?? []).map(workerTaskToKanban));
      if (!silent) setError(null);
    } catch (err: unknown) {
      if (id !== fetchIdRef.current) return;
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      if (id === fetchIdRef.current && !silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // SSE for real-time task updates
  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/projects/${projectId}/chat/stream`, {
      withCredentials: true,
    });
    const refresh = () => fetchTasks({ silent: true });
    es.addEventListener('task_update', refresh);
    es.addEventListener('task_delete', refresh);
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [projectId, fetchTasks]);

  const tasks = useMemo(
    () => allTasks.filter(t => matchesFilters(t, filters)),
    [allTasks, filters],
  );

  const createTask = useCallback(async (payload: CreateTaskPayload): Promise<KanbanTask> => {
    const boardColumn = payload.status ? STATUS_TO_BOARD[payload.status] : 'todo';
    const metadata: Record<string, unknown> = {};
    if (payload.priority && payload.priority !== 'normal') metadata.priority = payload.priority;
    if (payload.labels?.length) metadata.labels = payload.labels;

    const res = await apiRequest<{ task: WorkerTask }>(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        subject: payload.title,
        description: payload.description ?? '',
        metadata: {
          ...metadata,
          boardColumn,
        },
      }),
    });
    await fetchTasks({ silent: true });
    return workerTaskToKanban(res.task, 0);
  }, [projectId, fetchTasks]);

  const updateTask = useCallback(async (id: string, payload: UpdateTaskPayload): Promise<KanbanTask> => {
    const body: Record<string, unknown> = {};
    if (payload.title !== undefined) body.subject = payload.title;
    if (payload.description !== undefined) body.description = payload.description ?? '';
    if (payload.status !== undefined) body.boardColumn = STATUS_TO_BOARD[payload.status];
    if (payload.assignee !== undefined) {
      body.owner = payload.assignee?.replace(/^agent:/, '') || null;
    }

    const existingTask = allTasks.find(t => t.id === id);
    const existingMeta = (existingTask as KanbanTask & { _meta?: Record<string, unknown> })?._meta ?? {};
    const metadata: Record<string, unknown> = { ...existingMeta };
    if (payload.priority !== undefined) metadata.priority = payload.priority;
    if (payload.labels !== undefined) metadata.labels = payload.labels;
    body.metadata = metadata;

    const res = await apiRequest<{ task: WorkerTask }>(`/api/projects/${projectId}/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    await fetchTasks({ silent: true });
    return workerTaskToKanban(res.task, 0);
  }, [projectId, fetchTasks, allTasks]);

  const reorderTask = useCallback(async (
    id: string,
    _version: number,
    targetStatus: TaskStatus,
    _targetIndex: number,
  ): Promise<KanbanTask> => {
    const boardColumn = STATUS_TO_BOARD[targetStatus];
    const res = await apiRequest<{ task: WorkerTask }>(`/api/projects/${projectId}/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ boardColumn }),
    });
    await fetchTasks({ silent: true });
    return workerTaskToKanban(res.task, _targetIndex);
  }, [projectId, fetchTasks]);

  const setTasksOptimistic = useCallback((updater: (prev: KanbanTask[]) => KanbanTask[]) => {
    setAllTasks(updater);
  }, []);

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    await apiRequest<void>(`/api/projects/${projectId}/tasks/${id}`, { method: 'DELETE' });
    await fetchTasks({ silent: true });
  }, [projectId, fetchTasks]);

  const tasksByStatusMap = useMemo(() => {
    const map = new Map<TaskStatus, KanbanTask[]>();
    for (const t of tasks) {
      let list = map.get(t.status);
      if (!list) { list = []; map.set(t.status, list); }
      list.push(t);
    }
    for (const list of map.values()) list.sort((a, b) => a.columnOrder - b.columnOrder);
    return map;
  }, [tasks]);

  const tasksByStatus = useCallback((status: TaskStatus): KanbanTask[] => {
    return tasksByStatusMap.get(status) ?? [];
  }, [tasksByStatusMap]);

  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      backlog: 0, todo: 0, 'in-progress': 0, review: 0, done: 0, cancelled: 0,
    };
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [tasks]);

  return {
    tasks,
    setTasks: setAllTasks,
    loading,
    error,
    filters,
    setFilters,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    reorderTask,
    setTasksOptimistic,
    tasksByStatus,
    statusCounts,
  };
}
