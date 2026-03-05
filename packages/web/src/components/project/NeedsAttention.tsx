import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Blocker } from "@/hooks/use-blockers"

interface NeedsAttentionProps {
  blockers: Blocker[]
  onDismiss: (id: string) => void
  onClickBlocker?: (blocker: Blocker) => void
}

export function NeedsAttention({
  blockers,
  onDismiss,
  onClickBlocker,
}: NeedsAttentionProps) {
  if (blockers.length === 0) return null

  return (
    <div className="border-b border-amber-300/60 bg-amber-50 px-3 py-2 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
          Needs your attention
        </span>
        <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-700 text-[11px] font-bold px-1.5 py-0.5 tabular-nums leading-none">
          {blockers.length}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {blockers.map((blocker) => (
          <div
            key={blocker.id}
            role="button"
            tabIndex={0}
            onClick={() => onClickBlocker?.(blocker)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onClickBlocker?.(blocker)
            }}
            className={cn(
              "flex items-start gap-2 rounded-sm border border-amber-300/40 bg-card px-2.5 py-1.5 text-left",
              onClickBlocker && "cursor-pointer hover:border-amber-400/60 hover:bg-amber-50/50 transition-colors"
            )}
          >
            <span className="mt-0.5 inline-block size-2 flex-shrink-0 rounded-full bg-amber-500" />

            <div className="min-w-0 flex-1">
              {blocker.agentName && (
                <span className="text-[11px] font-medium text-amber-700 mr-1">
                  {blocker.agentName}:
                </span>
              )}
              <span className="text-[11px] text-foreground leading-snug">
                {blocker.message}
              </span>
            </div>

            <button
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation()
                onDismiss(blocker.id)
              }}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
