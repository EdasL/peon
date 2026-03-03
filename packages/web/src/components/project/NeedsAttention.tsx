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
    <div className="border-b border-amber-800/40 bg-amber-950/20 px-3 py-2 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-500">
          Needs your attention
        </span>
        <span className="inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 tabular-nums leading-none">
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
              "flex items-start gap-2 rounded-md border border-amber-800/30 bg-zinc-900/60 px-2.5 py-1.5 text-left",
              onClickBlocker && "cursor-pointer hover:border-amber-700/50 hover:bg-zinc-900/80 transition-colors"
            )}
          >
            <span className="mt-0.5 inline-block size-2 flex-shrink-0 rounded-full bg-amber-500" />

            <div className="min-w-0 flex-1">
              {blocker.agentName && (
                <span className="text-[11px] font-medium text-amber-400 mr-1">
                  {blocker.agentName}:
                </span>
              )}
              <span className="text-[11px] text-zinc-300 leading-snug">
                {blocker.message}
              </span>
            </div>

            <button
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation()
                onDismiss(blocker.id)
              }}
              className="flex-shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
