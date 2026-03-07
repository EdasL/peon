import { useKanban } from './hooks/useKanban';
import { KanbanBoard } from './KanbanBoard';

interface KanbanPanelProps {
  projectId: string;
}

export function KanbanPanel({ projectId }: KanbanPanelProps) {
  const {
    tasks,
    loading,
    error,
    fetchTasks,
    getTasksForColumn,
  } = useKanban(projectId);

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="shrink-0 px-4 pt-3 pb-2">
        <h1 className="text-sm font-bold text-foreground tracking-wide uppercase">Board</h1>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 pb-4">
        <KanbanBoard
          getTasksForColumn={getTasksForColumn}
          loading={loading}
          error={error}
          onRetry={() => fetchTasks()}
          hasAnyTasks={tasks.length > 0}
        />
      </div>
    </div>
  );
}
