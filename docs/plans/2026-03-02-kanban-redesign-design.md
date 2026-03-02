# Femrun Kanban — Agent Team Management Platform

## Overview

A local agent team management platform. Create teams, spawn Claude Code agents, and manage work through Kanban boards — one board per team. The board is a UI layer on top of Claude Code's native team/task files, so agents see board changes instantly and the board reflects agent activity in real time.

## Stack

- **Frontend:** Vite + React 19 + TypeScript + shadcn/ui + Tailwind + @dnd-kit
- **Backend:** json-server (serves db.json for board-specific config) + custom middleware (reads/writes Claude Code files, handles tmux if needed)
- **No auth** — single user, local only
- **No custom Express server** — json-server replaces it

## Columns (Workflow Stages)

| Column | What happens | Triggered by |
|--------|-------------|-------------|
| **Backlog** | Ideas and future work. No agent assigned. | User creates task |
| **To Do** | Ready for work. Board lead agent analyzes context and assigns the right agent. | User drags from Backlog |
| **In Progress** | Agent is actively working. | Auto: agent sets `status: "in_progress"` |
| **QA** | Coding done, needs review. Board auto-reassigns `owner: "qa"`. | Auto: coding agent sets `status: "completed"` |
| **Done** | Shipped. QA passed. | Auto: QA agent sets `status: "completed"` |

Only **Backlog → To Do** is a manual drag. Everything else is automated.

## Orchestration: OpenClaw Meta-Layer

OpenClaw runs alongside the board as a meta-orchestrator. It does NOT replace Claude Code teams — it sits above them.

### Architecture

```
┌─────────────────────────────────────┐
│           Kanban Board UI           │  ← You interact here
├─────────────────────────────────────┤
│     OpenClaw Gateway (local)        │  ← Meta-orchestrator
├──────────┬──────────┬───────────────┤
│ designer │ backend  │ mobile │ qa   │  ← Claude Code agents
└──────────┴──────────┴───────────────┘
     └── all read/write ~/.claude/tasks/{team}/ ──┘
```

### OpenClaw's Roles

1. **Task Triage** — watches for unassigned tasks in To Do, analyzes context, assigns to the right agent (replaces custom board lead agent)
2. **Complex Routing** — "this task needs backend AND mobile" → splits into subtasks with dependencies
3. **Self-Improvement** — user can tell OpenClaw "add a burndown chart to the board" and it modifies the Kanban app code directly
4. **Escalation** — if an agent is stuck or a task fails, OpenClaw can reassign, retry, or flag for human review

### How It Connects

- OpenClaw runs as a local process via its Gateway
- It watches `~/.claude/tasks/{team}/` for unassigned tasks (same files the board reads)
- It writes `owner` and `tag` to task files to assign work
- For self-improvement, it has access to the Kanban app source code at the project root
- Communication with the user via the board UI (not Telegram/Discord — we skip OpenClaw's messaging layer)

### Board Lead = OpenClaw Skill

Instead of a custom Node process for task triage, we create an OpenClaw AgentSkill that:
1. Polls the task directory for untagged To Do items
2. Reads task description + team config
3. Uses Claude Haiku to classify
4. Writes the assignment

This is ~30 lines as an OpenClaw skill vs ~80 lines as a custom Node process.

## Task Tags & Auto-Assignment

Each task gets a `tag` assigned by the board lead agent:

| Tag | Agent |
|-----|-------|
| `design` | designer |
| `backend` | backend |
| `mobile` | mobile |

The board lead agent:
1. Detects untagged task in To Do (no `owner`, `status: "pending"`)
2. Calls Claude API with task description + team member list
3. Writes `owner: "{agent}"` and tag to the task file
4. The coding agent picks it up on next poll

## Auto-Advance State Machine

The board polls task files every 5s and applies this logic:

```
Task in "To Do" + board lead assigns owner
  → card stays in To Do (waiting for agent pickup)

Task in "To Do" + agent sets status: "in_progress"
  → board moves card to "In Progress"

Task in "In Progress" + coding agent sets status: "completed"
  → board moves card to "QA"
  → board rewrites: owner: "qa", status: "pending"
  → QA agent picks it up on next poll

Task in "QA" + QA agent sets status: "completed"
  → board moves card to "Done"
```

The board maintains a `boardColumn` field in its own db.json to track which column each task is in, since Claude Code's task files only have `status` and `owner`.

## Data Integration

### Reading from Claude Code

The backend polls/reads these files:

- `~/.claude/teams/{team}/config.json` → team members, their colors, models
- `~/.claude/tasks/{team}/*.json` → all tasks with id, subject, description, owner, status, blocks, blockedBy

### Writing to Claude Code

When the board creates or moves a task:

- Creates `~/.claude/tasks/{team}/{id}.json` with the standard format
- Updates `owner` and `status` fields on drag

### Board-Specific Data (db.json / json-server)

json-server manages board-only data that doesn't belong in Claude Code's files:

```json
{
  "board": {
    "activeTeam": "femrun",
    "columnMap": {}
  }
}
```

The `columnMap` tracks which board column each task is in (since Claude Code tasks don't have a "column" concept — they have `status` and `owner`).

### Mapping: Board Columns ↔ Claude Code Task State

| Board Column | Claude Code `status` | Claude Code `owner` | Transition trigger |
|-------------|---------------------|-------------------|--------------------|
| Backlog | `pending` | (none) | User creates task |
| To Do | `pending` | (assigned agent) | User drags to To Do |
| In Progress | `in_progress` | (assigned agent) | Agent sets in_progress |
| QA | `pending` | `qa` | Board detects coding agent completed → rewrites owner/status |
| Done | `completed` | `qa` | QA agent sets completed |

## Team Creation & Management

### Views

The app has two main views:

1. **Teams List** (home/dashboard) — shows all teams, create new team button
2. **Team Board** — the Kanban board for a specific team

### Team Creation Flow

1. User clicks "New Team"
2. **Step 1: Basics** — team name, project directory (cwd for agents), description
3. **Step 2: Choose template** — preset templates or start blank
   - **Full Stack Team** — designer + backend + mobile + qa
   - **Backend Only** — backend + qa
   - **Mobile Only** — mobile + designer + qa
   - **Custom** — start blank, add agents manually
4. **Step 3: Customize agents** — review/edit each agent before launch
   - Name, role, model (Haiku/Sonnet/Opus), color
   - Custom system prompt (pre-filled from template, editable)
   - Agent .md file content (instructions the agent follows)
5. User clicks "Launch Team"

### What "Launch Team" Does

1. Creates `~/.claude/teams/{name}/config.json` with the team config
2. Creates `~/.claude/tasks/{name}/` directory
3. Creates `.claude/agents/{role}.md` files in the project directory
4. Spawns each agent as a Claude Code process via CLI:
   ```
   claude --team {name} --agent-name {name} --model {model} --cwd {project-dir}
   ```
5. Board lead agent starts watching for untagged tasks
6. Redirects to the team's Kanban board

### Team Lifecycle

- **Active** — agents are running, board is live
- **Paused** — agents stopped, board still shows tasks (can restart)
- **Archived** — team removed, tasks preserved for reference

### API Routes for Team Management

Custom middleware:
- `POST /api/teams` — create team (writes config.json, creates dirs, spawns agents)
- `DELETE /api/teams/:name` — archive/delete team (stops agents, removes config)
- `POST /api/teams/:name/agents/:agent/restart` — restart a specific agent
- `GET /api/teams/:name/agents/:agent/status` — check if agent process is alive

## Frontend Components

All built with shadcn/ui:

### Teams List View
- **TeamCard** — Card showing team name, member avatars, task count, status Badge
- **CreateTeamDialog** — multi-step Dialog for team creation (basics → template → customize)

### Team Board View
- **Board** — main layout, DndContext wrapper
- **Column** — Card with ScrollArea, column header with count Badge
- **TaskCard** — Card with drag handle, tag Badge, agent avatar, delete Button
- **AddTask** — Dialog with Input for title and description (no tag — board lead assigns it)
- **TeamSidebar** — shows team members from config.json (name, model, color dot, alive/dead status)

## API Routes (json-server + middleware)

json-server auto-provides:
- `GET/POST/PATCH/DELETE /board` — board config

Custom middleware provides:
- `GET /api/teams` — lists teams from `~/.claude/teams/`
- `GET /api/teams/:name/config` — reads team config.json
- `GET /api/teams/:name/tasks` — reads all task files from `~/.claude/tasks/{name}/`
- `POST /api/teams/:name/tasks` — creates a new task file
- `PATCH /api/teams/:name/tasks/:id` — updates a task file (owner, status)
- `DELETE /api/teams/:name/tasks/:id` — deletes a task file

## Polling Strategy

- Poll `GET /api/teams/{name}/tasks` every 5 seconds
- Lightweight — just reads JSON files from disk
- Updates board state when agents change task status

## What Gets Deleted From Current Code

- `server/index.ts` (120 lines) — replaced by json-server + ~40-line middleware
- `src/styles/global.css` (290 lines) — replaced by Tailwind + shadcn
- `express`, `cors`, `uuid` dependencies — removed
- Hardcoded 5-column layout — replaced by dynamic workflow columns

## What Gets Added

- `tailwindcss`, `@tailwindcss/vite`, shadcn/ui components
- `json-server` with middleware file
- Claude Code file integration layer
- OpenClaw (local install) + custom AgentSkill for task triage
- OpenClaw self-improvement skill (access to project source)

## Running Processes

When the app is running, these processes are active:

1. **Vite dev server** (port 5173) — frontend
2. **json-server + middleware** (port 3001) — API
3. **OpenClaw Gateway** (local) — meta-orchestrator + task triage
4. **Claude Code agents** (per team) — the actual coding agents

All started via a single `npm run dev` using concurrently.
