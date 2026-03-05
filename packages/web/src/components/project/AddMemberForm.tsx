import { useState } from "react"
import { cn } from "@/lib/utils"
import * as api from "@/lib/api"
import { Check } from "lucide-react"

export const MEMBER_COLORS = [
  "bg-primary",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
]

interface AddMemberFormProps {
  teamId: string
  existingColors: string[]
  onDone: () => void
}

export function AddMemberForm({ teamId, existingColors, onDone }: AddMemberFormProps) {
  const [roleName, setRoleName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [color, setColor] = useState(
    () => MEMBER_COLORS.find((c) => !existingColors.includes(c)) ?? MEMBER_COLORS[0]
  )
  const [saving, setSaving] = useState(false)

  const canSubmit = roleName.trim().length > 0 && displayName.trim().length > 0

  const handleSubmit = async () => {
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      await api.addTeamMember(teamId, {
        roleName: roleName.trim(),
        displayName: displayName.trim(),
        systemPrompt: systemPrompt.trim() || `You are the ${displayName.trim()} on this team.`,
        color,
      })
      onDone()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-sm border border-border bg-card p-2.5 space-y-2">
      <input
        type="text"
        placeholder="Role (e.g. devops)"
        value={roleName}
        onChange={(e) => setRoleName(e.target.value)}
        className="w-full bg-background border border-border rounded-sm px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
        autoFocus
      />
      <input
        type="text"
        placeholder="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="w-full bg-background border border-border rounded-sm px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
      />
      <textarea
        placeholder="System prompt (optional)"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        rows={2}
        className="w-full bg-background border border-border rounded-sm px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring resize-none"
      />
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground mr-1">Color</span>
        {MEMBER_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={cn(
              "size-4 rounded-full transition-all",
              c,
              color === c ? "ring-2 ring-foreground/30 scale-110" : "opacity-50 hover:opacity-80"
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          className="flex items-center gap-1 rounded-sm bg-primary hover:bg-primary/90 disabled:opacity-40 px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors"
        >
          <Check className="size-3" />
          {saving ? "Adding..." : "Add"}
        </button>
        <button
          onClick={onDone}
          className="rounded-sm px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
