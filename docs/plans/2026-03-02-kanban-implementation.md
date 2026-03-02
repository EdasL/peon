# Femrun Agent Platform — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Kanban board as an agent team management platform with shadcn/ui, json-server, Claude Code file integration, and OpenClaw orchestration.

**Architecture:** Two views (Teams List + Team Board). json-server + custom middleware reads/writes Claude Code's native `~/.claude/teams/` and `~/.claude/tasks/` files. OpenClaw runs alongside as a meta-orchestrator for task triage and self-improvement. Frontend uses shadcn/ui + @dnd-kit. Auto-advancing state machine moves cards through Backlog → To Do → In Progress → QA → Done based on agent state changes.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS, shadcn/ui, @dnd-kit/core, json-server, OpenClaw, concurrently

**Design doc:** `docs/plans/2026-03-02-kanban-redesign-design.md`

---

## Phase 1: Clean Slate + New Stack Setup

### Task 1: Remove old code, set up Tailwind + shadcn/ui

**Files:**
- Delete: `server/index.ts`, `server/tasks.json`, `src/App.tsx`, `src/main.tsx`, `src/styles/global.css`, `src/components/Column.tsx`, `src/components/TaskCard.tsx`, `src/components/DragOverlay.tsx`, `shared/types.ts`
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- Create: `src/index.css`, `src/lib/utils.ts`, `components.json`

**Step 1: Remove old source files**

```bash
rm -f server/index.ts server/tasks.json shared/types.ts
rm -f src/App.tsx src/main.tsx src/styles/global.css
rm -f src/components/Column.tsx src/components/TaskCard.tsx src/components/DragOverlay.tsx
rmdir src/styles src/hooks src/components shared server public 2>/dev/null || true
```

**Step 2: Update package.json — remove old deps, add new ones**

Remove: `express`, `cors`, `uuid`, `@types/express`, `@types/cors`, `@types/uuid`, `tsx`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

Install new deps:
```bash
npm uninstall express cors uuid @types/express @types/cors @types/uuid tsx @dnd-kit/sortable @dnd-kit/utilities
npm install json-server clsx tailwind-merge class-variance-authority lucide-react tw-animate-css
npm install -D tailwindcss @tailwindcss/vite
```

**Step 3: Update vite.config.ts**

```typescript
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})
```

**Step 4: Update tsconfig.json for path aliases**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "server"]
}
```

**Step 5: Create src/index.css with Tailwind + dark theme**

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar-background: var(--sidebar-background);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

:root {
  --radius: 0.625rem;
  /* Dark theme by default */
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.922 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.922 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --sidebar-background: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.922 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

body {
  font-family: var(--font-sans);
  background: var(--background);
  color: var(--foreground);
  -webkit-font-smoothing: antialiased;
}
```

**Step 6: Create src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

**Step 7: Initialize shadcn/ui — run init and add components**

```bash
npx shadcn@latest init --defaults --force
npx shadcn@latest add card button input badge scroll-area dialog select separator avatar
```

Note: If `shadcn init` prompts, choose: style=new-york, base-color=neutral, css-variables=yes. The `--force` flag overwrites any existing files.

**Step 8: Create placeholder src/main.tsx and src/App.tsx**

`src/main.tsx`:
```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

`src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <h1 className="text-2xl font-semibold">Femrun Agent Platform</h1>
    </div>
  )
}
```

**Step 9: Update index.html — remove Google Fonts link (Inter loaded via Tailwind)**

Remove the Google Fonts `<link>` tags from `<head>`. Tailwind handles the font.

**Step 10: Verify build**

```bash
npx tsc --noEmit && npx vite build
```

Expected: zero errors, successful build.

**Step 11: Commit**

```bash
git add -A && git commit -m "chore: clean slate — tailwind + shadcn/ui setup"
```

---

### Task 2: Set up json-server with custom middleware for Claude Code integration

**Files:**
- Create: `server/db.json`, `server/middleware.ts`, `server/claude-files.ts`, `server/types.ts`
- Modify: `package.json` (scripts)

**Step 1: Create shared types**

`server/types.ts`:
```typescript
// Claude Code task file format (from ~/.claude/tasks/{team}/{id}.json)
export interface ClaudeTask {
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: "pending" | "in_progress" | "completed"
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
}

// Claude Code team config format (from ~/.claude/teams/{team}/config.json)
export interface ClaudeTeamConfig {
  name: string
  description: string
  createdAt: number
  leadAgentId: string
  leadSessionId: string
  members: ClaudeTeamMember[]
}

export interface ClaudeTeamMember {
  agentId: string
  name: string
  agentType: string
  model: string
  prompt?: string
  color?: string
  planModeRequired?: boolean
  joinedAt: number
  tmuxPaneId: string
  cwd: string
  subscriptions: string[]
  backendType?: string
}

// Board-specific types
export type BoardColumn = "backlog" | "todo" | "in_progress" | "qa" | "done"

export interface BoardTask extends ClaudeTask {
  boardColumn: BoardColumn
  tag?: string
}
```

**Step 2: Create Claude Code file integration layer**

`server/claude-files.ts` — reads/writes `~/.claude/teams/` and `~/.claude/tasks/`:
```typescript
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { ClaudeTask, ClaudeTeamConfig } from "./types.js"

const CLAUDE_DIR = join(homedir(), ".claude")
const TEAMS_DIR = join(CLAUDE_DIR, "teams")
const TASKS_DIR = join(CLAUDE_DIR, "tasks")

export function listTeams(): string[] {
  if (!existsSync(TEAMS_DIR)) return []
  return readdirSync(TEAMS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

export function getTeamConfig(teamName: string): ClaudeTeamConfig | null {
  const configPath = join(TEAMS_DIR, teamName, "config.json")
  if (!existsSync(configPath)) return null
  return JSON.parse(readFileSync(configPath, "utf-8"))
}

export function listTasks(teamName: string): ClaudeTask[] {
  const taskDir = join(TASKS_DIR, teamName)
  if (!existsSync(taskDir)) return []
  return readdirSync(taskDir)
    .filter(f => f.endsWith(".json") && f !== ".lock")
    .map(f => {
      const content = readFileSync(join(taskDir, f), "utf-8")
      return JSON.parse(content) as ClaudeTask
    })
}

export function getTask(teamName: string, taskId: string): ClaudeTask | null {
  const taskPath = join(TASKS_DIR, teamName, `${taskId}.json`)
  if (!existsSync(taskPath)) return null
  return JSON.parse(readFileSync(taskPath, "utf-8"))
}

export function createTask(teamName: string, task: ClaudeTask): ClaudeTask {
  const taskDir = join(TASKS_DIR, teamName)
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true })
  const taskPath = join(taskDir, `${task.id}.json`)
  writeFileSync(taskPath, JSON.stringify(task, null, 2))
  return task
}

export function updateTask(teamName: string, taskId: string, updates: Partial<ClaudeTask>): ClaudeTask | null {
  const task = getTask(teamName, taskId)
  if (!task) return null
  const updated = { ...task, ...updates, id: taskId }
  const taskPath = join(TASKS_DIR, teamName, `${taskId}.json`)
  writeFileSync(taskPath, JSON.stringify(updated, null, 2))
  return updated
}

export function deleteTask(teamName: string, taskId: string): boolean {
  const taskPath = join(TASKS_DIR, teamName, `${taskId}.json`)
  if (!existsSync(taskPath)) return false
  const { unlinkSync } = require("fs")
  unlinkSync(taskPath)
  return true
}

export function getNextTaskId(teamName: string): string {
  const tasks = listTasks(teamName)
  const maxId = tasks.reduce((max, t) => Math.max(max, parseInt(t.id) || 0), 0)
  return String(maxId + 1)
}
```

**Step 3: Create json-server middleware**

`server/middleware.ts` — custom routes that json-server can't handle:
```typescript
import type { Request, Response, NextFunction } from "express"
import * as claude from "./claude-files.js"
import type { ClaudeTask } from "./types.js"

export function claudeMiddleware(req: Request, res: Response, next: NextFunction) {
  // GET /api/teams — list all Claude Code teams
  if (req.method === "GET" && req.path === "/api/teams") {
    const teamNames = claude.listTeams()
    const teams = teamNames
      .map(name => claude.getTeamConfig(name))
      .filter(Boolean)
    return res.json(teams)
  }

  // GET /api/teams/:name/config — get team config
  const configMatch = req.path.match(/^\/api\/teams\/([^/]+)\/config$/)
  if (req.method === "GET" && configMatch) {
    const config = claude.getTeamConfig(configMatch[1])
    if (!config) return res.status(404).json({ error: "team not found" })
    return res.json(config)
  }

  // GET /api/teams/:name/tasks — list all tasks
  const tasksMatch = req.path.match(/^\/api\/teams\/([^/]+)\/tasks$/)
  if (req.method === "GET" && tasksMatch) {
    const tasks = claude.listTasks(tasksMatch[1])
    return res.json(tasks)
  }

  // POST /api/teams/:name/tasks — create task
  if (req.method === "POST" && tasksMatch) {
    const teamName = tasksMatch[1]
    const id = claude.getNextTaskId(teamName)
    const task: ClaudeTask = {
      id,
      subject: req.body.subject,
      description: req.body.description || "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      ...req.body,
      id, // ensure id isn't overwritten
    }
    const created = claude.createTask(teamName, task)
    return res.status(201).json(created)
  }

  // PATCH /api/teams/:name/tasks/:id — update task
  const taskMatch = req.path.match(/^\/api\/teams\/([^/]+)\/tasks\/([^/]+)$/)
  if (req.method === "PATCH" && taskMatch) {
    const updated = claude.updateTask(taskMatch[1], taskMatch[2], req.body)
    if (!updated) return res.status(404).json({ error: "task not found" })
    return res.json(updated)
  }

  // DELETE /api/teams/:name/tasks/:id — delete task
  if (req.method === "DELETE" && taskMatch) {
    const deleted = claude.deleteTask(taskMatch[1], taskMatch[2])
    if (!deleted) return res.status(404).json({ error: "task not found" })
    return res.json({ ok: true })
  }

  next()
}
```

**Step 4: Create db.json for json-server (board-specific data)**

`server/db.json`:
```json
{
  "boards": [
    {
      "id": "femrun",
      "teamName": "femrun",
      "columnMap": {}
    }
  ]
}
```

**Step 5: Create server entry point**

`server/index.ts`:
```typescript
import jsonServer from "json-server"
import { claudeMiddleware } from "./middleware.js"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const server = jsonServer.create()
const router = jsonServer.router(join(__dirname, "db.json"))
const middlewares = jsonServer.defaults({ noCors: false })

server.use(middlewares)
server.use(jsonServer.bodyParser)
server.use(claudeMiddleware)
server.use("/api", router)

server.listen(3001, () => {
  console.log("Server running on http://localhost:3001")
})
```

**Step 6: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite"
  }
}
```

Note: We keep `tsx` for the server since json-server's programmatic API needs it. Re-install if removed in Task 1:
```bash
npm install -D tsx
```

**Step 7: Verify server starts and reads Claude Code files**

```bash
npm run dev:server &
sleep 2
curl -s http://localhost:3001/api/teams | jq '.[].name'
curl -s http://localhost:3001/api/teams/femrun/tasks | jq '.[].subject'
kill %1
```

Expected: prints team names and task subjects from `~/.claude/`.

**Step 8: Commit**

```bash
git add -A && git commit -m "feat: json-server + Claude Code file integration layer"
```

---

## Phase 2: Teams List View

### Task 3: Build the Teams List (home/dashboard) view

**Files:**
- Create: `src/pages/TeamsPage.tsx`, `src/components/TeamCard.tsx`, `src/hooks/use-teams.ts`, `src/lib/api.ts`
- Modify: `src/App.tsx`

**Step 1: Create API client**

`src/lib/api.ts`:
```typescript
const BASE = "/api"

export async function fetchTeams() {
  const res = await fetch(`${BASE}/teams`)
  return res.json()
}

export async function fetchTeamConfig(teamName: string) {
  const res = await fetch(`${BASE}/teams/${teamName}/config`)
  return res.json()
}

export async function fetchTasks(teamName: string) {
  const res = await fetch(`${BASE}/teams/${teamName}/tasks`)
  return res.json()
}

export async function createTask(teamName: string, data: { subject: string; description?: string }) {
  const res = await fetch(`${BASE}/teams/${teamName}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function updateTask(teamName: string, taskId: string, data: Record<string, unknown>) {
  const res = await fetch(`${BASE}/teams/${teamName}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteTask(teamName: string, taskId: string) {
  await fetch(`${BASE}/teams/${teamName}/tasks/${taskId}`, { method: "DELETE" })
}
```

**Step 2: Create useTeams hook**

`src/hooks/use-teams.ts`:
```typescript
import { useEffect, useState } from "react"
import { fetchTeams } from "@/lib/api"
import type { ClaudeTeamConfig } from "../../server/types"

export function useTeams() {
  const [teams, setTeams] = useState<ClaudeTeamConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTeams()
      .then(setTeams)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return { teams, loading }
}
```

**Step 3: Create TeamCard component**

`src/components/TeamCard.tsx` — uses shadcn Card, Badge, Avatar:
```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { ClaudeTeamConfig } from "../../server/types"

interface TeamCardProps {
  team: ClaudeTeamConfig
  onClick: () => void
}

export function TeamCard({ team, onClick }: TeamCardProps) {
  const agents = team.members.filter(m => m.agentType !== "lead")

  return (
    <Card
      className="cursor-pointer transition-colors hover:border-foreground/20"
      onClick={onClick}
    >
      <CardHeader>
        <CardTitle className="text-lg">{team.name}</CardTitle>
        <CardDescription>{team.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {agents.map(agent => (
            <div key={agent.name} className="flex items-center gap-1.5">
              <Avatar className="h-6 w-6">
                <AvatarFallback
                  className="text-[10px] font-medium"
                  style={{ backgroundColor: agent.color || "#525252" }}
                >
                  {agent.name[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Badge variant="secondary" className="text-[10px]">
                {agent.name}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
```

**Step 4: Create TeamsPage**

`src/pages/TeamsPage.tsx`:
```tsx
import { useTeams } from "@/hooks/use-teams"
import { TeamCard } from "@/components/TeamCard"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface TeamsPageProps {
  onSelectTeam: (teamName: string) => void
}

export function TeamsPage({ onSelectTeam }: TeamsPageProps) {
  const { teams, loading } = useTeams()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-8 py-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Femrun</h1>
        <Button size="sm" variant="outline" disabled>
          <Plus className="h-4 w-4 mr-1.5" />
          New Team
        </Button>
      </header>
      <main className="max-w-4xl mx-auto px-8 py-10">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading teams...</p>
        ) : teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">No teams found. Create one to get started.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {teams.map(team => (
              <TeamCard
                key={team.name}
                team={team}
                onClick={() => onSelectTeam(team.name)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
```

**Step 5: Wire up App.tsx with simple router**

`src/App.tsx`:
```tsx
import { useState } from "react"
import { TeamsPage } from "@/pages/TeamsPage"

export default function App() {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)

  if (!selectedTeam) {
    return <TeamsPage onSelectTeam={setSelectedTeam} />
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <p>Board for: {selectedTeam} (next task)</p>
    </div>
  )
}
```

**Step 6: Verify — start both servers, open browser**

```bash
npm run dev
```

Open http://localhost:5173 — should show team cards for existing Claude Code teams (e.g., "femrun").

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: teams list view with Claude Code integration"
```

---

## Phase 3: Kanban Board View

### Task 4: Build the Kanban board with columns and auto-advance state machine

**Files:**
- Create: `src/pages/BoardPage.tsx`, `src/components/board/Board.tsx`, `src/components/board/Column.tsx`, `src/components/board/TaskCard.tsx`, `src/components/board/AddTask.tsx`, `src/components/board/DragOverlayCard.tsx`, `src/hooks/use-board.ts`, `src/lib/state-machine.ts`
- Modify: `src/App.tsx`

**Step 1: Create the state machine logic**

`src/lib/state-machine.ts` — maps Claude Code task state to board columns and handles auto-advance:
```typescript
import type { BoardColumn, BoardTask, ClaudeTask } from "../../server/types"

// Derive board column from Claude Code task state
export function deriveColumn(task: ClaudeTask, columnMap: Record<string, BoardColumn>): BoardColumn {
  // If we have an explicit column mapping, use it
  if (columnMap[task.id]) return columnMap[task.id]

  // Otherwise derive from status + owner
  if (task.status === "completed") return "done"
  if (task.status === "in_progress" && task.owner === "qa") return "qa"
  if (task.status === "in_progress") return "in_progress"
  if (task.status === "pending" && task.owner) return "todo"
  return "backlog"
}

// Detect state transitions that should auto-advance cards
export function detectTransitions(
  prev: BoardTask[],
  current: ClaudeTask[],
  columnMap: Record<string, BoardColumn>
): { taskId: string; from: BoardColumn; to: BoardColumn; updates?: Partial<ClaudeTask> }[] {
  const transitions: { taskId: string; from: BoardColumn; to: BoardColumn; updates?: Partial<ClaudeTask> }[] = []

  for (const task of current) {
    const prevTask = prev.find(t => t.id === task.id)
    if (!prevTask) continue

    // Coding agent completed → move to QA
    if (
      prevTask.boardColumn === "in_progress" &&
      task.status === "completed" &&
      task.owner !== "qa"
    ) {
      transitions.push({
        taskId: task.id,
        from: "in_progress",
        to: "qa",
        updates: { owner: "qa", status: "pending" },
      })
    }

    // QA agent completed → move to Done
    if (
      prevTask.boardColumn === "qa" &&
      task.status === "completed" &&
      task.owner === "qa"
    ) {
      transitions.push({
        taskId: task.id,
        from: "qa",
        to: "done",
      })
    }

    // Agent picked up task → move to In Progress
    if (
      prevTask.boardColumn === "todo" &&
      task.status === "in_progress"
    ) {
      transitions.push({
        taskId: task.id,
        from: "todo",
        to: "in_progress",
      })
    }
  }

  return transitions
}

export const COLUMNS: { id: BoardColumn; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "qa", label: "QA" },
  { id: "done", label: "Done" },
]
```

**Step 2: Create useBoard hook**

`src/hooks/use-board.ts` — fetches tasks, polls every 5s, applies state machine:
```typescript
import { useCallback, useEffect, useRef, useState } from "react"
import { fetchTasks, fetchTeamConfig, createTask, updateTask } from "@/lib/api"
import { deriveColumn, detectTransitions } from "@/lib/state-machine"
import type { BoardColumn, BoardTask, ClaudeTask } from "../../server/types"
import type { ClaudeTeamConfig } from "../../server/types"

export function useBoard(teamName: string) {
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [team, setTeam] = useState<ClaudeTeamConfig | null>(null)
  const [columnMap, setColumnMap] = useState<Record<string, BoardColumn>>({})
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  // Load team config
  useEffect(() => {
    fetchTeamConfig(teamName).then(setTeam).catch(() => {})
  }, [teamName])

  // Poll tasks every 5s
  useEffect(() => {
    const poll = async () => {
      const claudeTasks: ClaudeTask[] = await fetchTasks(teamName)

      // Detect transitions and auto-advance
      const transitions = detectTransitions(tasksRef.current, claudeTasks, columnMap)
      const newColumnMap = { ...columnMap }

      for (const t of transitions) {
        newColumnMap[t.taskId] = t.to
        if (t.updates) {
          await updateTask(teamName, t.taskId, t.updates)
        }
      }

      setColumnMap(newColumnMap)

      const boardTasks: BoardTask[] = claudeTasks
        .filter(t => !t.metadata?._internal)
        .map(t => ({
          ...t,
          boardColumn: newColumnMap[t.id] || deriveColumn(t, newColumnMap),
        }))

      setTasks(boardTasks)
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [teamName, columnMap])

  const addTask = useCallback(async (subject: string, description?: string) => {
    const task = await createTask(teamName, { subject, description })
    setTasks(prev => [...prev, { ...task, boardColumn: "backlog" as BoardColumn }])
  }, [teamName])

  const moveTask = useCallback(async (taskId: string, toColumn: BoardColumn) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, boardColumn: toColumn } : t))
    setColumnMap(prev => ({ ...prev, [taskId]: toColumn }))

    // Write to Claude Code files based on column
    const updates: Partial<ClaudeTask> = {}
    if (toColumn === "backlog") {
      updates.owner = undefined
      updates.status = "pending"
    } else if (toColumn === "todo") {
      updates.status = "pending"
      // Owner will be set by OpenClaw triage
    }

    if (Object.keys(updates).length > 0) {
      await updateTask(teamName, taskId, updates)
    }
  }, [teamName])

  return { tasks, team, addTask, moveTask }
}
```

**Step 3: Create Column component**

`src/components/board/Column.tsx`:
```tsx
import { useDroppable } from "@dnd-kit/core"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TaskCard } from "./TaskCard"
import type { BoardColumn, BoardTask } from "../../../server/types"

interface ColumnProps {
  id: BoardColumn
  label: string
  tasks: BoardTask[]
  children?: React.ReactNode
}

export function Column({ id, label, tasks, children }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <Card className={`flex flex-col min-h-0 ${isOver ? "border-primary/50" : ""}`}>
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] h-5">
            {tasks.length}
          </Badge>
        </div>
      </CardHeader>
      {children}
      <CardContent className="flex-1 min-h-0 px-3 pb-3" ref={setNodeRef}>
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-2 pr-2">
            {tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No tasks</p>
            ) : (
              tasks.map(task => <TaskCard key={task.id} task={task} />)
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
```

**Step 4: Create TaskCard component**

`src/components/board/TaskCard.tsx`:
```tsx
import { useDraggable } from "@dnd-kit/core"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { BoardTask } from "../../../server/types"

interface TaskCardProps {
  task: BoardTask
  overlay?: boolean
}

export function TaskCard({ task, overlay }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: overlay,
  })

  return (
    <Card
      ref={overlay ? undefined : setNodeRef}
      className={`p-3 cursor-grab active:cursor-grabbing transition-opacity ${
        isDragging ? "opacity-40" : ""
      } ${overlay ? "shadow-lg border-primary/30 scale-[1.02]" : "hover:border-foreground/15"}`}
      {...(overlay ? {} : { ...listeners, ...attributes })}
    >
      <p className="text-sm leading-snug">{task.subject}</p>
      <div className="flex items-center gap-1.5 mt-2">
        {task.owner && (
          <Badge variant="outline" className="text-[10px] h-4">
            {task.owner}
          </Badge>
        )}
        {task.tag && (
          <Badge variant="secondary" className="text-[10px] h-4">
            {task.tag}
          </Badge>
        )}
      </div>
    </Card>
  )
}
```

**Step 5: Create DragOverlayCard**

`src/components/board/DragOverlayCard.tsx`:
```tsx
import { TaskCard } from "./TaskCard"
import type { BoardTask } from "../../../server/types"

export function DragOverlayCard({ task }: { task: BoardTask }) {
  return <TaskCard task={task} overlay />
}
```

**Step 6: Create AddTask component**

`src/components/board/AddTask.tsx`:
```tsx
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface AddTaskProps {
  onAdd: (subject: string) => void
}

export function AddTask({ onAdd }: AddTaskProps) {
  const [value, setValue] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setValue("")
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 pb-2">
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Add a task..."
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}
```

**Step 7: Create Board component**

`src/components/board/Board.tsx`:
```tsx
import { useCallback, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { useBoard } from "@/hooks/use-board"
import { COLUMNS } from "@/lib/state-machine"
import { Column } from "./Column"
import { AddTask } from "./AddTask"
import { DragOverlayCard } from "./DragOverlayCard"
import type { BoardColumn, BoardTask } from "../../../server/types"

interface BoardProps {
  teamName: string
  onBack: () => void
}

export function Board({ teamName, onBack }: BoardProps) {
  const { tasks, team, addTask, moveTask } = useBoard(teamName)
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as BoardTask | undefined
    if (task) setActiveTask(task)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return
    const taskId = active.id as string
    const toColumn = over.id as BoardColumn
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.boardColumn === toColumn) return
    moveTask(taskId, toColumn)
  }, [tasks, moveTask])

  const tasksByColumn = (col: BoardColumn) => tasks.filter(t => t.boardColumn === col)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-8 py-4 flex items-center gap-4">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm">
          &larr; Teams
        </button>
        <h1 className="text-lg font-semibold tracking-tight">{team?.name || teamName}</h1>
        <span className="text-xs text-muted-foreground">{tasks.length} tasks</span>
      </header>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 grid grid-cols-5 gap-px bg-border p-px overflow-hidden">
          {COLUMNS.map(col => (
            <Column key={col.id} id={col.id} label={col.label} tasks={tasksByColumn(col.id)}>
              {col.id === "backlog" && <AddTask onAdd={addTask} />}
            </Column>
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask && <DragOverlayCard task={activeTask} />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
```

**Step 8: Wire Board into App.tsx**

Update `src/App.tsx`:
```tsx
import { useState } from "react"
import { TeamsPage } from "@/pages/TeamsPage"
import { Board } from "@/components/board/Board"

export default function App() {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null)

  if (!selectedTeam) {
    return <TeamsPage onSelectTeam={setSelectedTeam} />
  }

  return <Board teamName={selectedTeam} onBack={() => setSelectedTeam(null)} />
}
```

**Step 9: Verify — full flow**

```bash
npm run dev
```

1. Open http://localhost:5173 — should show team cards
2. Click "femrun" — should show 5-column board with existing tasks
3. Add a task in Backlog — should appear
4. Drag task to "To Do" — should move
5. Check `~/.claude/tasks/femrun/` — new task file should exist

**Step 10: Commit**

```bash
git add -A && git commit -m "feat: kanban board with drag-and-drop and auto-advance state machine"
```

---

## Phase 4: OpenClaw Integration

### Task 5: Install OpenClaw and create task triage skill

**Files:**
- Create: `~/.openclaw/workspace/skills/femrun-triage/SKILL.md`, `server/openclaw.ts`
- Modify: `~/.openclaw/openclaw.json`

**Step 1: Install OpenClaw**

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

During onboarding: select Anthropic as provider, enter API key, use `anthropic/claude-haiku-4-5-20251001` as the model (fast and cheap for triage).

**Step 2: Create the task triage skill**

`~/.openclaw/workspace/skills/femrun-triage/SKILL.md`:
```yaml
---
name: femrun_triage
description: Watches for unassigned tasks in Claude Code team task directories and assigns them to the right agent based on task context.
---

# Task Triage Skill

## When to Run
When a task file in ~/.claude/tasks/{team}/ has status "pending", is in the board's "todo" column, and has no owner.

## Steps
1. Read the task file (subject + description)
2. Read the team config from ~/.claude/teams/{team}/config.json to get the list of agents
3. Analyze the task context against the agent roles
4. Assign the task to the most appropriate agent by writing `owner` to the task file
5. Skip tasks owned by "qa" — those are QA assignments, not triage targets

## Assignment Rules
- If the task mentions UI, design, styling, components → designer
- If the task mentions API, database, server, backend, Go → backend
- If the task mentions mobile, React Native, app, screen, navigation → mobile
- If ambiguous, assign to backend (most common)

## Output
Write the owner field to the task file. Log the assignment.
```

**Step 3: Create server-side OpenClaw integration**

`server/openclaw.ts` — calls OpenClaw gateway for triage:
```typescript
import { listTasks, updateTask, getTeamConfig } from "./claude-files.js"
import type { ClaudeTask } from "./types.js"

const OPENCLAW_GATEWAY = "http://127.0.0.1:18789"

// Simple triage using Claude API directly (fallback if OpenClaw not running)
export async function triageTask(teamName: string, task: ClaudeTask): Promise<string | null> {
  const config = getTeamConfig(teamName)
  if (!config) return null

  const agents = config.members
    .filter(m => m.agentType !== "lead" && m.name !== "qa")
    .map(m => `${m.name} (${m.agentType})`)

  // Use OpenClaw hooks endpoint if available, otherwise this is a placeholder
  // for when OpenClaw skill handles it automatically
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "triage",
        task: { id: task.id, subject: task.subject, description: task.description },
        agents,
        teamName,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.assignedAgent || null
    }
  } catch {
    // OpenClaw not running — skip triage
  }

  return null
}

// Poll for unassigned "todo" tasks and triage them
export function startTriagePoller(teamName: string, columnMap: Record<string, string>) {
  setInterval(async () => {
    const tasks = listTasks(teamName)
    for (const task of tasks) {
      const col = columnMap[task.id]
      if (col === "todo" && !task.owner && task.status === "pending") {
        const agent = await triageTask(teamName, task)
        if (agent) {
          updateTask(teamName, task.id, { owner: agent })
        }
      }
    }
  }, 10_000) // every 10s
}
```

**Step 4: Verify OpenClaw is running**

```bash
openclaw gateway --port 18789 &
curl -s http://127.0.0.1:18789/ | head -5
```

Expected: OpenClaw Control UI response.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: OpenClaw integration for task triage"
```

---

## Phase 5: Team Creation

### Task 6: Build team creation UI and agent spawning

**Files:**
- Create: `src/components/CreateTeamDialog.tsx`, `src/lib/team-templates.ts`
- Modify: `src/pages/TeamsPage.tsx`, `server/middleware.ts`

**Step 1: Create team templates**

`src/lib/team-templates.ts`:
```typescript
export interface AgentTemplate {
  name: string
  agentType: string
  model: string
  color: string
  prompt: string
}

export interface TeamTemplate {
  id: string
  label: string
  description: string
  agents: AgentTemplate[]
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "fullstack",
    label: "Full Stack Team",
    description: "Designer + Backend + Mobile + QA",
    agents: [
      { name: "designer", agentType: "designer", model: "sonnet", color: "#22c55e", prompt: "You are the designer on the team. Review and improve UI/UX, design system, and visual consistency." },
      { name: "backend", agentType: "backend", model: "sonnet", color: "#eab308", prompt: "You are the backend developer. Build and maintain APIs, database models, and server-side logic." },
      { name: "mobile", agentType: "mobile", model: "sonnet", color: "#a855f7", prompt: "You are the mobile developer. Build and maintain React Native screens, hooks, and navigation." },
      { name: "qa", agentType: "qa", model: "sonnet", color: "#3b82f6", prompt: "You are the QA engineer. Write and fix tests, review code quality, verify bug fixes." },
    ],
  },
  {
    id: "backend-only",
    label: "Backend Only",
    description: "Backend + QA",
    agents: [
      { name: "backend", agentType: "backend", model: "sonnet", color: "#eab308", prompt: "You are the backend developer. Build and maintain APIs, database models, and server-side logic." },
      { name: "qa", agentType: "qa", model: "sonnet", color: "#3b82f6", prompt: "You are the QA engineer. Write and fix tests, review code quality, verify bug fixes." },
    ],
  },
  {
    id: "mobile-only",
    label: "Mobile Only",
    description: "Mobile + Designer + QA",
    agents: [
      { name: "designer", agentType: "designer", model: "sonnet", color: "#22c55e", prompt: "You are the designer. Review and improve UI/UX and visual consistency." },
      { name: "mobile", agentType: "mobile", model: "sonnet", color: "#a855f7", prompt: "You are the mobile developer. Build and maintain React Native screens, hooks, and navigation." },
      { name: "qa", agentType: "qa", model: "sonnet", color: "#3b82f6", prompt: "You are the QA engineer. Write and fix tests, review code quality, verify bug fixes." },
    ],
  },
]
```

**Step 2: Create CreateTeamDialog component**

`src/components/CreateTeamDialog.tsx` — multi-step Dialog using shadcn Dialog, Input, Select:

This is a larger component (~150 lines). It should:
1. Step 1: Team name + project directory (cwd) + description
2. Step 2: Choose template from TEAM_TEMPLATES
3. Step 3: Show agent list, allow editing name/model/prompt per agent
4. Submit button calls `POST /api/teams` with full config

Use shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `Input`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `Button`, `Separator`.

**Step 3: Add team creation API route to middleware**

Add to `server/middleware.ts`:
```typescript
// POST /api/teams — create team and spawn agents
if (req.method === "POST" && req.path === "/api/teams") {
  const { name, description, cwd, agents } = req.body
  // 1. Write config.json
  // 2. Create tasks directory
  // 3. Create .claude/agents/*.md in project cwd
  // 4. Spawn agents via: exec(`claude --team ${name} --agent-name ${agent.name} --model ${agent.model} --cwd ${cwd}`)
  // Return config
}
```

Implementation uses `child_process.exec` to spawn Claude Code agent processes.

**Step 4: Wire CreateTeamDialog into TeamsPage**

Add state for dialog open/close, pass `onCreated` callback that refreshes the teams list.

**Step 5: Verify — create a test team**

1. Open http://localhost:5173
2. Click "New Team"
3. Fill in: name="test-team", cwd="/tmp/test", template="Backend Only"
4. Click "Launch Team"
5. Check `~/.claude/teams/test-team/config.json` exists
6. Check agent processes spawned

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: team creation with templates and agent spawning"
```

---

## Phase 6: Polish & Wire Up

### Task 7: Team sidebar with agent status

**Files:**
- Create: `src/components/board/TeamSidebar.tsx`
- Modify: `src/components/board/Board.tsx`

Add a right sidebar to the board showing each team member: avatar (colored circle), name, model badge, and a status dot (green if process alive, gray if dead). Uses shadcn Avatar, Badge, Card.

Poll `GET /api/teams/:name/config` every 10s to refresh member list.

**Commit:** `git add -A && git commit -m "feat: team sidebar with agent status"`

---

### Task 8: Final integration test and cleanup

**Step 1: Start all services**

```bash
npm run dev
```

**Step 2: Test full flow**

1. Open http://localhost:5173
2. Click existing "femrun" team → board loads with real tasks
3. Add a task "Implement password reset endpoint" in Backlog
4. Drag to To Do → task file created in `~/.claude/tasks/femrun/`
5. Wait for triage (OpenClaw or polling) → task gets assigned
6. Verify auto-advance works when agent sets `status: "in_progress"`

**Step 3: Clean up unused files**

Remove any empty directories, unused imports, dead code.

**Step 4: Final commit**

```bash
git add -A && git commit -m "feat: femrun agent platform — MVP complete"
```

---

## Summary

| Phase | Task | What it builds |
|-------|------|---------------|
| 1 | Task 1 | Clean slate + Tailwind + shadcn/ui |
| 1 | Task 2 | json-server + Claude Code file integration |
| 2 | Task 3 | Teams list view |
| 3 | Task 4 | Kanban board with drag-and-drop + state machine |
| 4 | Task 5 | OpenClaw triage skill |
| 5 | Task 6 | Team creation UI + agent spawning |
| 6 | Task 7 | Team sidebar with agent status |
| 6 | Task 8 | Integration test + cleanup |
