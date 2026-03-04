/**
 * WorkspacePanel — Tabbed viewer/editor for agent workspace config files.
 *
 * Shows SOUL.md, MEMORY.md, AGENTS.md, TOOLS.md with inline editing.
 * Data flows through the OpenClaw RPC layer (workspace.read / workspace.write).
 */

import { useState, useCallback, useEffect, useRef } from "react"
import {
  FileText,
  Brain,
  Bot,
  Wrench,
  RefreshCw,
  Pencil,
  Save,
  X,
  CheckCircle,
  AlertCircle,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useWorkspaceFile } from "./hooks/useWorkspaceFile"

interface FileTab {
  key: string
  label: string
  icon: LucideIcon
}

const FILE_TABS: FileTab[] = [
  { key: "SOUL.md", label: "Soul", icon: Brain },
  { key: "MEMORY.md", label: "Memory", icon: FileText },
  { key: "AGENTS.md", label: "Agents", icon: Bot },
  { key: "TOOLS.md", label: "Tools", icon: Wrench },
]

type TabKey = string

const STORAGE_KEY = "peon-workspace-tab"

function getInitialTab(): TabKey {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && FILE_TABS.some((t) => t.key === stored)) return stored
  } catch {
    /* ignore */
  }
  return FILE_TABS[0].key
}

interface WorkspacePanelProps {
  compact?: boolean
}

export function WorkspacePanel({ compact = false }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab)
  const { content, isLoading, error, exists, load, save } = useWorkspaceFile()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [feedback, setFeedback] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => () => clearTimeout(feedbackTimer.current), [])

  // Load file when tab changes
  useEffect(() => {
    setEditing(false)
    load(activeTab)
  }, [activeTab, load])

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key)
    try {
      localStorage.setItem(STORAGE_KEY, key)
    } catch {
      /* ignore */
    }
  }, [])

  const showFeedback = useCallback((type: "success" | "error", message: string) => {
    clearTimeout(feedbackTimer.current)
    setFeedback({ type, message })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000)
  }, [])

  const handleEdit = useCallback(() => {
    setEditContent(content || "")
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [content])

  const handleSave = useCallback(async () => {
    const success = await save(activeTab, editContent)
    if (success) {
      showFeedback("success", "File saved")
      setEditing(false)
    } else {
      showFeedback("error", "Failed to save")
    }
  }, [activeTab, editContent, save, showFeedback])

  const handleCancel = useCallback(() => {
    setEditing(false)
  }, [])

  const handleCreate = useCallback(async () => {
    const template = `# ${activeTab}\n\n`
    const success = await save(activeTab, template)
    if (success) {
      showFeedback("success", "File created")
    }
  }, [activeTab, save, showFeedback])

  // Warn before unload when editing
  useEffect(() => {
    if (!editing) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [editing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = FILE_TABS.findIndex((t) => t.key === activeTab)
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault()
        const next = (currentIndex + 1) % FILE_TABS.length
        handleTabChange(FILE_TABS[next].key)
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault()
        const prev = (currentIndex - 1 + FILE_TABS.length) % FILE_TABS.length
        handleTabChange(FILE_TABS[prev].key)
      }
    },
    [activeTab, handleTabChange],
  )

  return (
    <div
      className={
        compact
          ? "h-[70vh] max-h-[70vh] flex flex-col min-h-0"
          : "h-full flex flex-col min-h-0"
      }
    >
      {/* Tab bar */}
      <div
        className="flex items-center gap-0 border-b border-border/40 px-2 py-1.5"
        role="tablist"
        aria-label="Workspace files"
        onKeyDown={handleKeyDown}
      >
        {FILE_TABS.map((tab, i) => {
          const isActive = tab.key === activeTab
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleTabChange(tab.key)}
              className={`text-[10px] uppercase tracking-wider cursor-pointer transition-colors bg-transparent border-0 flex items-center gap-1 px-2 py-0.5 rounded-sm focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 ${
                i > 0 ? "ml-1" : ""
              } ${
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
              }`}
            >
              <Icon size={11} />
              <span>{tab.label}</span>
            </button>
          )
        })}

        <div className="flex-1" />

        <button
          onClick={() => load(activeTab)}
          disabled={isLoading}
          className="shrink-0 px-1.5 py-1 bg-transparent border-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0"
          title="Refresh"
          aria-label="Refresh file"
        >
          <RefreshCw size={10} className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-b ${
            feedback.type === "success"
              ? "bg-green-500/10 text-green-500 border-green-500/20"
              : "bg-red-500/10 text-red-500 border-red-500/20"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle size={10} />
          ) : (
            <AlertCircle size={10} />
          )}
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[10px] text-red-500 bg-red-500/10">{error}</div>
      )}

      {/* File content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* File doesn't exist */}
        {!exists && !isLoading && !error && (
          <div className="text-muted-foreground px-3 py-4 text-[11px] text-center">
            <p>File does not exist yet</p>
            <button
              onClick={handleCreate}
              className="mt-2 text-primary hover:underline bg-transparent border-0 cursor-pointer text-[11px] focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 rounded-sm"
            >
              Create {activeTab}
            </button>
          </div>
        )}

        {/* Read-only view */}
        {exists && !editing && content !== null && (
          <div className="relative">
            <div className="absolute top-1 right-1 z-10">
              <button
                onClick={handleEdit}
                className="bg-transparent border border-border/60 text-muted-foreground w-6 h-6 cursor-pointer flex items-center justify-center hover:text-primary hover:border-primary transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 rounded-sm"
                title="Edit"
                aria-label="Edit file"
              >
                <Pencil size={10} />
              </button>
            </div>
            <pre className="px-3 py-2 text-[11px] text-foreground whitespace-pre-wrap font-mono leading-relaxed">
              {content}
            </pre>
          </div>
        )}

        {/* Editing view */}
        {editing && (
          <div className="flex flex-col h-full">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="flex-1 w-full px-3 py-2 text-[11px] font-mono bg-background text-foreground border-0 resize-none outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 focus-visible:ring-inset"
              spellCheck={false}
            />
            <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border/40">
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="bg-transparent border border-primary/60 text-primary text-[10px] px-2 py-1 cursor-pointer flex items-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 rounded-sm"
              >
                <Save size={10} /> Save
              </button>
              <button
                onClick={handleCancel}
                className="bg-transparent border border-border/60 text-muted-foreground text-[10px] px-2 py-1 cursor-pointer flex items-center gap-1 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-0 rounded-sm"
              >
                <X size={10} /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !content && !error && (
          <div className="space-y-2 py-3 px-3">
            <div className="h-3 w-3/4 bg-muted/20 animate-pulse rounded" />
            <div className="h-3 w-1/2 bg-muted/20 animate-pulse rounded" />
            <div className="h-3 w-2/3 bg-muted/20 animate-pulse rounded" />
          </div>
        )}
      </div>
    </div>
  )
}
