import { useState } from "react"
import { X, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SuggestedMember } from "@/lib/team-suggestions"
import {
  ALL_ROLES,
  ROLE_NAMES,
  ROLE_COLORS,
  ROLE_TAGLINES,
  ROLE_BORDER_COLORS,
  ROLE_TEXT_COLORS,
  makeMember,
} from "@/lib/team-suggestions"

interface TeamEditorProps {
  members: SuggestedMember[]
  onChange: (members: SuggestedMember[]) => void
}

function MemberCard({
  member,
  total,
  onChange,
  onDelete,
}: {
  member: SuggestedMember
  index: number
  total: number
  onChange: (updated: SuggestedMember) => void
  onDelete: () => void
}) {
  const [promptOpen, setPromptOpen] = useState(false)
  const initial = (ROLE_NAMES[member.role] ?? member.role)[0]?.toUpperCase() ?? "?"
  const borderColor = ROLE_BORDER_COLORS[member.role] ?? "border-l-stone-500"
  const textColor = ROLE_TEXT_COLORS[member.role] ?? "text-stone-500"
  const bgColor = ROLE_COLORS[member.role] ?? "bg-stone-500"
  const tagline = ROLE_TAGLINES[member.role] ?? ""

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border/60 bg-card pl-0 transition-all",
        "border-l-[3px]",
        borderColor,
      )}
    >
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Large initial */}
          <div
            className={cn(
              "flex size-10 flex-shrink-0 items-center justify-center rounded-md text-lg font-semibold text-white",
              bgColor,
            )}
          >
            {initial}
          </div>

          {/* Role info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-foreground leading-tight">
                {ROLE_NAMES[member.role] ?? member.name}
              </span>
              <span className={cn("text-xs font-medium", textColor)}>
                {member.role}
              </span>
            </div>
            {tagline && (
              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                {tagline}
              </p>
            )}
          </div>

          {/* Remove button */}
          <button
            type="button"
            aria-label={`Remove ${member.name}`}
            disabled={total <= 1}
            onClick={onDelete}
            className="flex-shrink-0 rounded-sm p-1 text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-0 disabled:cursor-not-allowed"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* Prompt toggle */}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setPromptOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            {promptOpen ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            {promptOpen ? "Hide prompt" : "Edit prompt"}
          </button>

          {promptOpen && (
            <textarea
              value={member.prompt}
              onChange={(e) => onChange({ ...member, prompt: e.target.value })}
              rows={5}
              className="mt-2 w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-[11px] text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function AddMemberChips({
  existingRoles,
  onAdd,
}: {
  existingRoles: Set<string>
  onAdd: (role: string) => void
}) {
  const availableRoles = ALL_ROLES.filter((r) => !existingRoles.has(r))

  if (availableRoles.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/60 text-center py-2">
        All roles added
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wide font-medium">
        Add a role
      </p>
      <div className="flex flex-wrap gap-1.5">
        {availableRoles.map((role) => {
          const bgColor = ROLE_COLORS[role] ?? "bg-stone-500"
          return (
            <button
              key={role}
              type="button"
              onClick={() => onAdd(role)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-foreground hover:border-border hover:bg-muted transition-colors"
            >
              <span className={cn("inline-block size-2 rounded-full", bgColor)} />
              {ROLE_NAMES[role]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TeamEditor({ members, onChange }: TeamEditorProps) {
  const updateMember = (index: number, updated: SuggestedMember) => {
    const next = [...members]
    next[index] = updated
    onChange(next)
  }

  const deleteMember = (index: number) => {
    onChange(members.filter((_, i) => i !== index))
  }

  const addMember = (role: string) => {
    onChange([...members, makeMember(role)])
  }

  const existingRoles = new Set(members.map((m) => m.role))

  return (
    <div className="space-y-3">
      {members.map((member, index) => (
        <MemberCard
          key={`${member.role}-${index}`}
          member={member}
          index={index}
          total={members.length}
          onChange={(updated) => updateMember(index, updated)}
          onDelete={() => deleteMember(index)}
        />
      ))}

      <AddMemberChips existingRoles={existingRoles} onAdd={addMember} />
    </div>
  )
}
