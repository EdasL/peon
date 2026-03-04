import { memo } from 'react';
import type { KanbanTask } from './types';

interface KanbanCardProps {
  task: KanbanTask;
}

export const KanbanCard = memo(function KanbanCard({ task }: KanbanCardProps) {
  const ownerName = task.assignee
    ? task.assignee === 'operator'
      ? 'Operator'
      : task.assignee.replace('agent:', '')
    : null;

  return (
    <div className="w-full text-left bg-card border border-border rounded-[10px] px-2.5 py-2.5">
      <p className="text-[13px] font-semibold leading-[18px] text-foreground line-clamp-2">
        {task.title}
      </p>

      {ownerName && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
          {task.isWorking && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          )}
          <span className="truncate">{ownerName}</span>
        </div>
      )}
    </div>
  );
});
