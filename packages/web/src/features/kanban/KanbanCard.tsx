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
    <div
      className={`w-full text-left bg-card border border-border rounded-sm px-2.5 py-2.5 ${
        task.isWorking ? 'border-l-2 border-l-[#22C55E]' : ''
      }`}
    >
      <p className="text-[13px] font-medium leading-[18px] line-clamp-2">
        {task.title}
      </p>

      {ownerName && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
          {task.isWorking && (
            <span className="size-[6px] rounded-full bg-[#22C55E] animate-pulse shrink-0" />
          )}
          <span className="truncate font-mono">{ownerName}</span>
        </div>
      )}
    </div>
  );
});
