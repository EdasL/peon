import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface AddTaskProps {
  onAdd: (subject: string) => void
}

export function AddTask({ onAdd }: AddTaskProps) {
  const [value, setValue] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setValue("")
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        placeholder="Add a task..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-sm"
      />
      <Button type="submit" size="sm" variant="secondary" className="shrink-0">
        <Plus className="size-3.5" />
      </Button>
    </form>
  )
}
