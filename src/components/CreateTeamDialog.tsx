import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  TEAM_TEMPLATES,
  type AgentTemplate,
  type TeamTemplate,
} from "@/lib/team-templates"
import { ChevronLeft, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react"

interface CreateTeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (name: string) => void
}

type Step = 1 | 2 | 3

const MODEL_OPTIONS = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
]

const COLOR_OPTIONS = [
  "green",
  "yellow",
  "purple",
  "blue",
  "red",
  "orange",
  "pink",
  "cyan",
]

const COLOR_MAP: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  purple: "bg-violet-500",
  blue: "bg-blue-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
}

function makeEmptyAgent(): AgentTemplate {
  return {
    name: "",
    agentType: "developer",
    model: "sonnet",
    color: "blue",
    prompt: "",
  }
}

export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateTeamDialogProps) {
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState("")
  const [cwd, setCwd] = useState("~/Projects/")
  const [description, setDescription] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState<TeamTemplate | null>(
    null
  )
  const [agents, setAgents] = useState<AgentTemplate[]>([])
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setStep(1)
    setName("")
    setCwd("~/Projects/")
    setDescription("")
    setSelectedTemplate(null)
    setAgents([])
    setExpandedAgent(null)
    setSubmitting(false)
  }

  function handleOpenChange(value: boolean) {
    if (!value) reset()
    onOpenChange(value)
  }

  function handleSelectTemplate(template: TeamTemplate | null) {
    setSelectedTemplate(template)
    setAgents(template ? template.agents.map((a) => ({ ...a })) : [makeEmptyAgent()])
  }

  function updateAgent(index: number, patch: Partial<AgentTemplate>) {
    setAgents((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a))
    )
  }

  function removeAgent(index: number) {
    setAgents((prev) => prev.filter((_, i) => i !== index))
    if (expandedAgent === index) setExpandedAgent(null)
  }

  function addAgent() {
    setAgents((prev) => [...prev, makeEmptyAgent()])
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, cwd, agents }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      handleOpenChange(false)
      onCreated(name)
    } catch {
      // Allow retry
      setSubmitting(false)
    }
  }

  const canProceedStep1 = name.trim().length > 0 && cwd.trim().length > 0
  const canProceedStep2 = selectedTemplate !== null || agents.length > 0
  const canSubmit =
    agents.length > 0 && agents.every((a) => a.name.trim().length > 0)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && "Create Team"}
            {step === 2 && "Choose Template"}
            {step === 3 && "Customize Agents"}
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Set up your new agent team"}
            {step === 2 && "Pick a starting template or go custom"}
            {step === 3 && "Configure team members before launch"}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* Step 1: Basics */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-cwd">Project directory</Label>
              <Input
                id="team-cwd"
                placeholder="~/Projects/my-project"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-desc">Description (optional)</Label>
              <Textarea
                id="team-desc"
                placeholder="What this team will work on..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        {/* Step 2: Template */}
        {step === 2 && (
          <div className="grid grid-cols-2 gap-3">
            {TEAM_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTemplate(t)}
                className={`rounded-lg border p-3 text-left transition-colors hover:border-ring/40 ${
                  selectedTemplate?.id === t.id
                    ? "border-ring bg-accent"
                    : "border-border"
                }`}
              >
                <p className="text-sm font-medium">{t.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.description}
                </p>
                <p className="mt-2 text-xs text-muted-foreground/70">
                  {t.agents.length} agent{t.agents.length !== 1 ? "s" : ""}
                </p>
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleSelectTemplate(null)}
              className={`rounded-lg border border-dashed p-3 text-left transition-colors hover:border-ring/40 ${
                selectedTemplate === null && agents.length > 0
                  ? "border-ring bg-accent"
                  : "border-border"
              }`}
            >
              <p className="text-sm font-medium">Custom</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Start from scratch with your own agents
              </p>
            </button>
          </div>
        )}

        {/* Step 3: Customize Agents */}
        {step === 3 && (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {agents.map((agent, i) => (
              <div
                key={i}
                className="rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-3 shrink-0 rounded-full ${COLOR_MAP[agent.color] ?? "bg-gray-500"}`}
                  />
                  <Input
                    className="h-8 flex-1 text-sm"
                    placeholder="Agent name"
                    value={agent.name}
                    onChange={(e) => updateAgent(i, { name: e.target.value })}
                  />
                  <Select
                    value={agent.model}
                    onValueChange={(v) => updateAgent(i, { model: v })}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={agent.color}
                    onValueChange={(v) => updateAgent(i, { color: v })}
                  >
                    <SelectTrigger className="h-8 w-20 text-xs" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`size-2 rounded-full ${COLOR_MAP[c]}`}
                            />
                            {c}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-8 p-0"
                    onClick={() =>
                      setExpandedAgent(expandedAgent === i ? null : i)
                    }
                  >
                    {expandedAgent === i ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeAgent(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                {expandedAgent === i && (
                  <div className="mt-3">
                    <Textarea
                      className="text-xs"
                      placeholder="Agent system prompt..."
                      value={agent.prompt}
                      onChange={(e) =>
                        updateAgent(i, { prompt: e.target.value })
                      }
                      rows={3}
                    />
                  </div>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addAgent}
            >
              <Plus className="size-3.5" />
              Add Agent
            </Button>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button
              variant="ghost"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="mr-auto"
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
          )}
          {step === 1 && (
            <Button disabled={!canProceedStep1} onClick={() => setStep(2)}>
              Next
            </Button>
          )}
          {step === 2 && (
            <Button disabled={!canProceedStep2} onClick={() => setStep(3)}>
              Next
            </Button>
          )}
          {step === 3 && (
            <Button
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Launching..." : "Launch Team"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
