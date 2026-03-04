import { memo } from 'react';
import { Inbox } from 'lucide-react';
import type { KanbanTask, DisplayColumn } from './types';
import { DISPLAY_COLUMN_LABELS } from './types';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  column: DisplayColumn;
  tasks: KanbanTask[];
}

export const KanbanColumn = memo(function KanbanColumn({ column, tasks }: KanbanColumnProps) {
  return (
    <div className="flex flex-col min-w-[280px] w-[320px] max-w-[360px] h-full shrink-0 bg-card rounded-sm border border-border">
      <div className="sticky top-0 z-10 flex items-center justify-between h-10 px-3 bg-card border-b border-border rounded-t-sm">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {DISPLAY_COLUMN_LABELS[column]}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm tabular-nums">
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-[120px]">
        {tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8 text-muted-foreground/40 select-none">
            <Inbox size={20} className="mb-1.5" />
            <span className="text-[11px]">No tasks</span>
          </div>
        ) : (
          tasks.map(task => (
            <KanbanCard key={task.id} task={task} />
          ))
        )}
      </div>
    </div>
  );
});
