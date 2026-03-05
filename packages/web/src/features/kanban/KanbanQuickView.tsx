import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import type { KanbanTask, DisplayColumn } from './types';
import { DISPLAY_COLUMN_LABELS } from './types';
import { useKanban } from './hooks/useKanban';

const QUICK_COLUMNS: DisplayColumn[] = ['todo', 'in-progress'];
const MAX_ROWS = 5;

interface KanbanQuickViewProps {
  projectId: string;
  onOpenBoard: () => void;
  onOpenTask: (task: KanbanTask) => void;
}

function TaskRow({ task, onClick }: { task: KanbanTask; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-xs hover:bg-muted/60 transition-colors group cursor-pointer"
    >
      <span className="truncate flex-1 text-foreground/80 group-hover:text-foreground">
        {task.title}
      </span>
      {task.assignee && (
        <span className="shrink-0 text-[11px] text-muted-foreground truncate max-w-[60px]">
          {task.assignee.replace(/^agent:/, '')}
        </span>
      )}
    </button>
  );
}

function ColumnSection({
  column,
  tasks,
  onOpenTask,
}: {
  column: DisplayColumn;
  tasks: KanbanTask[];
  onOpenTask: (task: KanbanTask) => void;
}) {
  const visible = tasks.slice(0, MAX_ROWS);
  const overflow = tasks.length - MAX_ROWS;

  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center gap-1.5 px-1.5 mb-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {DISPLAY_COLUMN_LABELS[column]}
        </span>
        <span className="text-[11px] text-muted-foreground">{tasks.length}</span>
      </div>
      {visible.map(task => (
        <TaskRow key={task.id} task={task} onClick={() => onOpenTask(task)} />
      ))}
      {overflow > 0 && (
        <span className="block px-1.5 text-[11px] text-muted-foreground">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

export function KanbanQuickView({ projectId, onOpenBoard, onOpenTask }: KanbanQuickViewProps) {
  const { getTasksForColumn, columnCounts, loading, error } = useKanban(projectId);

  const sections = useMemo(() => {
    return QUICK_COLUMNS.map(col => ({
      column: col,
      tasks: getTasksForColumn(col),
    }));
  }, [getTasksForColumn]);

  const totalActive = (columnCounts.todo || 0) + (columnCounts['in-progress'] || 0);
  const allEmpty = totalActive === 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/90">Board</span>
          {totalActive > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              {totalActive}
            </span>
          )}
        </div>
        <button
          onClick={onOpenBoard}
          className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors cursor-pointer"
        >
          Open Board
          <ArrowRight size={11} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {error && (
          <p className="text-[11px] text-destructive px-1.5">{error}</p>
        )}
        {loading && !error && (
          <p className="text-[11px] text-muted-foreground px-1.5 animate-pulse">Loading...</p>
        )}
        {!loading && allEmpty && !error && (
          <p className="text-[11px] text-muted-foreground px-1.5 py-4 text-center">
            No active tasks
          </p>
        )}
        {!loading && !allEmpty && sections.map(({ column, tasks }) =>
          tasks.length > 0 ? (
            <ColumnSection
              key={column}
              column={column}
              tasks={tasks}
              onOpenTask={onOpenTask}
            />
          ) : null
        )}
      </div>
    </div>
  );
}
