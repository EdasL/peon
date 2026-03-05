import { useState, useEffect, useCallback, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface ModelOption {
  value: string
  label: string
}

const FALLBACK_MODELS: ModelOption[] = [
  { value: "anthropic/claude-haiku-4-5", label: "claude-haiku-4-5" },
  { value: "anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5" },
  { value: "anthropic/claude-opus-4-6", label: "claude-opus-4-6" },
]

const THINKING_LEVELS: ModelOption[] = [
  { value: "off", label: "off" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
]

type ModelEntry = { id: string; alias?: string }

function deriveAlias(id: string): string {
  return id.includes("/") ? id.split("/", 2)[1] : id
}

interface SpawnAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSpawn: (opts: {
    task: string
    label?: string
    model: string
    thinking: string
  }) => Promise<void>
}

export function SpawnAgentDialog({
  open,
  onOpenChange,
  onSpawn,
}: SpawnAgentDialogProps) {
  const [task, setTask] = useState("")
  const [label, setLabel] = useState("")
  const [model, setModel] = useState<string>("")
  const [thinking, setThinking] = useState<string>("medium")
  const [spawning, setSpawning] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<ModelEntry[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/gateway/models")
        if (!res.ok) return
        const data = (await res.json()) as {
          models?: Array<{ id: string; label?: string; alias?: string }>
        }
        if (cancelled || !Array.isArray(data.models)) return
        setFetchedModels(
          data.models.map((m) => ({ id: m.id, alias: m.alias || m.label })),
        )
      } catch {
        /* use fallback */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (fetchedModels.length > 0 && !model) {
      const sonnet = fetchedModels.find((m) => m.id.includes("sonnet"))
      setModel(sonnet?.id || fetchedModels[0].id)
    }
  }, [fetchedModels, model])

  const modelOptions = useMemo<ModelOption[]>(() => {
    if (fetchedModels.length > 0) {
      return fetchedModels.map((m) => ({
        value: m.id,
        label: m.alias || deriveAlias(m.id),
      }))
    }
    return FALLBACK_MODELS
  }, [fetchedModels])

  const defaultModelId = useMemo(() => {
    if (fetchedModels.length > 0) {
      const sonnet = fetchedModels.find((m) => m.id.includes("sonnet"))
      return sonnet?.id || fetchedModels[0].id
    }
    return FALLBACK_MODELS[1].value
  }, [fetchedModels])

  const reset = useCallback(() => {
    setTask("")
    setLabel("")
    setModel(defaultModelId)
    setThinking("medium")
  }, [defaultModelId])

  const [spawnError, setSpawnError] = useState("")

  const handleLaunch = useCallback(async () => {
    if (!task.trim()) return
    setSpawning(true)
    setSpawnError("")
    try {
      await onSpawn({
        task: task.trim(),
        label: label.trim() || undefined,
        model,
        thinking,
      })
      reset()
      onOpenChange(false)
    } catch (err) {
      console.error("Failed to spawn agent:", err)
      setSpawnError(
        err instanceof Error ? err.message : "Failed to spawn agent",
      )
    } finally {
      setSpawning(false)
    }
  }, [task, label, model, thinking, onSpawn, onOpenChange, reset])

  const handleCancel = useCallback(() => {
    reset()
    onOpenChange(false)
  }, [onOpenChange, reset])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !spawning) handleCancel()
      }}
    >
      <DialogContent className="bg-card border-border max-w-md overflow-visible">
        <DialogHeader>
          <DialogTitle className="text-primary font-mono text-sm tracking-wider uppercase">
            Launch Subagent
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Spawn a new subagent session with a specific task.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Task / Prompt
            </label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="What should this agent do?"
              rows={3}
              className="w-full bg-background border border-border/60 text-foreground text-xs font-mono px-2 py-1.5 resize-y focus:outline-none focus:border-primary placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. refactor-auth"
              className="w-full bg-background border border-border/60 text-foreground text-xs font-mono px-2 py-1.5 focus:outline-none focus:border-primary placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 block">
                Model
              </label>
              <Select value={model} onValueChange={setModel} disabled={spawning}>
                <SelectTrigger className="w-full text-xs font-mono">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1 block">
                Thinking
              </label>
              <Select
                value={thinking}
                onValueChange={setThinking}
                disabled={spawning}
              >
                <SelectTrigger className="w-full text-xs font-mono">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_LEVELS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {spawnError && (
            <p className="text-[11px] text-destructive font-mono">{spawnError}</p>
          )}
          {spawning && (
            <p className="text-[11px] text-muted-foreground animate-pulse">
              Waiting for agent to spawn subagent...
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={spawning}
            className="font-mono text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleLaunch}
            disabled={spawning || !task.trim()}
            className="font-mono text-xs min-w-[90px]"
          >
            {spawning ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Spawning...
              </span>
            ) : (
              "Launch"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
