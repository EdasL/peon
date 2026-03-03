import { useState, useRef, useEffect } from "react"
import { X, ChevronDown, ChevronUp, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SuggestedMember } from "@/lib/team-suggestions"
import {
  ALL_ROLES,
  ROLE_PROMPTS,
  ROLE_NAMES,
  ROLE_COLORS,
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

  return (
    <div className="rounded-md border border-border/40 bg-zinc-900/60 p-3">
      <div className="flex items-start gap-3">
        <span
          className={cn("mt-2 inline-block size-3 flex-shrink-0 rounded-full", member.color)}
        />

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <label className="text-[10px] text-zinc-600 uppercase tracking-wide mb-0.5 block">
                Role key
              </label>
              <Input
                value={member.role}
                onChange={(e) => onChange({ ...member, role: e.target.value })}
                placeholder="e.g. frontend"
                className="h-7 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[10px] text-zinc-600 uppercase tracking-wide mb-0.5 block">
                Display name
              </label>
              <Input
                value={member.name}
                onChange={(e) => onChange({ ...member, name: e.target.value })}
                placeholder="e.g. Frontend Developer"
                className="h-7 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
              />
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPromptOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
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
                className="mt-1 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-300 leading-relaxed focus:outline-none focus:ring-1 focus:ring-zinc-700"
              />
            )}
          </div>
        </div>

        <button
          type="button"
          aria-label={`Remove ${member.name}`}
          disabled={total <= 1}
          onClick={onDelete}
          className="mt-1 flex-shrink-0 text-zinc-700 hover:text-zinc-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function AddMemberDropdown({
  existingRoles,
  onAdd,
}: {
  existingRoles: Set<string>
  onAdd: (role: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const availableRoles = ALL_ROLES.filter((r) => !existingRoles.has(r))

  if (availableRoles.length === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        className="w-full border-dashed border-zinc-700 text-zinc-600 bg-transparent text-xs"
      >
        All roles added
      </Button>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="w-full border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 bg-transparent text-xs"
      >
        <Plus className="size-3.5 mr-1.5" />
        Add member
      </Button>

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-lg">
          {availableRoles.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => {
                onAdd(role)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2"
            >
              <span className={cn("inline-block size-2 rounded-full", ROLE_COLORS[role])} />
              <span className="font-medium">{ROLE_NAMES[role]}</span>
              <span className="text-zinc-600 ml-auto">{role}</span>
            </button>
          ))}
        </div>
      )}
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
    <div className="space-y-2">
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

      <AddMemberDropdown existingRoles={existingRoles} onAdd={addMember} />
    </div>
  )
}
