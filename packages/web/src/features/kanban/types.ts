export type DisplayColumn = 'todo' | 'in-progress' | 'done';

export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export const DISPLAY_COLUMNS: DisplayColumn[] = ['todo', 'in-progress', 'done'];

export const DISPLAY_COLUMN_LABELS: Record<DisplayColumn, string> = {
  todo: 'To Do',
  'in-progress': 'In Progress',
  done: 'Done',
};

/** Maps raw board column from DB to one of 3 display columns */
export function toDisplayColumn(boardColumn: string): DisplayColumn {
  switch (boardColumn) {
    case 'backlog':
    case 'todo':
      return 'todo';
    case 'in_progress':
      return 'in-progress';
    case 'qa':
    case 'done':
      return 'done';
    default:
      return 'todo';
  }
}

export type TaskActor = 'operator' | `agent:${string}`;

export interface TaskFeedback {
  at: number;
  by: TaskActor;
  note: string;
}

export interface TaskRunLink {
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;
}

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  displayColumn: DisplayColumn;
  priority: TaskPriority;
  createdBy: TaskActor;
  createdAt: number;
  updatedAt: number;
  version: number;
  sourceSessionKey?: string;
  assignee?: TaskActor;
  labels: string[];
  columnOrder: number;
  run?: TaskRunLink;
  result?: string;
  resultAt?: number;
  model?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
  dueAt?: number;
  estimateMin?: number;
  actualMin?: number;
  feedback: TaskFeedback[];
  /** Whether the owning agent is currently working (has in_progress task status) */
  isWorking?: boolean;
}
