import { memo, useState, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import type { KanbanTask } from './types';
import { MarkdownMessage } from '@/components/chat/MarkdownMessage';

interface KanbanCardProps {
  task: KanbanTask;
}

export const KanbanCard = memo(function KanbanCard({ task }: KanbanCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDescription = !!task.description?.trim();

  const toggle = useCallback(() => {
    if (hasDescription) setExpanded(prev => !prev);
  }, [hasDescription]);

  const ownerName = task.assignee
    ? task.assignee === 'operator'
      ? 'Operator'
      : task.assignee.replace('agent:', '')
    : null;

  return (
    <div
      onClick={toggle}
      className={`w-full text-left bg-card border border-border rounded-sm px-2.5 py-2.5 ${
        task.isWorking ? 'border-l-2 border-l-[#22C55E]' : ''
      } ${hasDescription ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        {hasDescription && (
          <ChevronRight
            size={14}
            className={`shrink-0 mt-[2px] text-muted-foreground transition-transform duration-150 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        )}
        <p className={`text-[13px] font-medium leading-[18px] ${expanded ? '' : 'line-clamp-2'}`}>
          {task.title}
        </p>
      </div>

      {expanded && task.description && (
        <div className="mt-2 pt-2 border-t border-border text-muted-foreground">
          <MarkdownMessage content={task.description} />
        </div>
      )}

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
