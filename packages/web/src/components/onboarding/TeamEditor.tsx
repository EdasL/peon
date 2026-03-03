import { useState } from "react"
import { X, ChevronDown, ChevronUp, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SuggestedMember } from "@/lib/team-suggestions"
import { ROLE_PROMPTS } from "@/lib/team-suggestions"

interface TeamEditorProps {
  members: SuggestedMember[]
  onChange: (members: SuggestedMember[]) => void
}

function MemberCard({
  member,
  index,
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
        {/* Color dot */}
        <span
          className={cn("mt-2 inline-block size-3 flex-shrink-0 rounded-full", member.color)}
        />

        <div className="flex-1 min-w-0 space-y-2">
          {/* Role + name row */}
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
                placeholder="e.g. Frontend Engineer"
                className="h-7 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
              />
            </div>
          </div>

          {/* Prompt toggle */}
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
                rows={3}
                className="mt-1 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-300 leading-relaxed focus:outline-none focus:ring-1 focus:ring-zinc-700"
              />
            )}
          </div>
        </div>

        {/* Delete button */}
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

export function TeamEditor({ members, onChange }: TeamEditorProps) {
  const updateMember = (index: number, updated: SuggestedMember) => {
    const next = [...members]
    next[index] = updated
    onChange(next)
  }

  const deleteMember = (index: number) => {
    onChange(members.filter((_, i) => i !== index))
  }

  const addMember = () => {
    onChange([
      ...members,
      {
        role: "engineer",
        name: "Engineer",
        prompt: ROLE_PROMPTS.engineer,
        color: "bg-zinc-500",
      },
    ])
  }

  return (
    <div className="space-y-2">
      {members.map((member, index) => (
        <MemberCard
          key={index}
          member={member}
          index={index}
          total={members.length}
          onChange={(updated) => updateMember(index, updated)}
          onDelete={() => deleteMember(index)}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addMember}
        className="w-full border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 bg-transparent text-xs"
      >
        <Plus className="size-3.5 mr-1.5" />
        Add member
      </Button>
    </div>
  )
}
