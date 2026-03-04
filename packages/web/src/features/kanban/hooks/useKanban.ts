import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { KanbanTask, TaskPriority, DisplayColumn } from '../types';
import { toDisplayColumn } from '../types';

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

function workerTaskToKanban(t: WorkerTask, index: number): KanbanTask {
  const meta = t.metadata ?? {};
  return {
    id: t.id,
    title: t.subject,
    description: t.description || undefined,
    status: t.status === 'in_progress' ? 'in-progress' : t.status === 'completed' ? 'done' : 'todo',
    displayColumn: toDisplayColumn(t.boardColumn),
    priority: (meta.priority as TaskPriority) ?? 'normal',
    createdBy: t.owner ? `agent:${t.owner}` : 'operator',
    createdAt: t.updatedAt,
    updatedAt: t.updatedAt,
    version: 1,
    assignee: t.owner ? `agent:${t.owner}` : undefined,
    labels: (meta.labels as string[]) ?? [],
    columnOrder: (meta.columnOrder as number) ?? index,
    feedback: [],
    isWorking: t.status === 'in_progress',
  };
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
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setTasks((res.tasks ?? []).map(workerTaskToKanban));
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

  const tasksByColumn = useMemo(() => {
    const map = new Map<DisplayColumn, KanbanTask[]>();
    for (const t of tasks) {
      let list = map.get(t.displayColumn);
      if (!list) { list = []; map.set(t.displayColumn, list); }
      list.push(t);
    }
    for (const list of map.values()) list.sort((a, b) => a.columnOrder - b.columnOrder);
    return map;
  }, [tasks]);

  const getTasksForColumn = useCallback((col: DisplayColumn): KanbanTask[] => {
    return tasksByColumn.get(col) ?? [];
  }, [tasksByColumn]);

  const columnCounts = useMemo(() => {
    const counts: Record<DisplayColumn, number> = { todo: 0, 'in-progress': 0, done: 0 };
    for (const t of tasks) counts[t.displayColumn] = (counts[t.displayColumn] || 0) + 1;
    return counts;
  }, [tasks]);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    getTasksForColumn,
    columnCounts,
  };
}
