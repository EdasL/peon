# Peon — Backlog (MVP)

## The three things
1. Create a Claude Code team
2. Give them tasks via chat
3. See what they're working on via the board

---

## Current state vs spec

| Area | Current | Spec |
|---|---|---|
| Dashboard | MasterChat + ProjectsSidebar | Project list only, no chat |
| Project layout | Left + Center + Right (activity) | Left + Center only |
| Board columns | 5 (Backlog/Todo/In Progress/QA/Done) + drag/drop + editable | 3 (To Do / In Progress / Done), read-only |
| Left panel | SessionList | TeamPanel: name + status dot + token bar + [+][↻] |
| Chat | Direct Anthropic call | Peon lead agent receives, breaks into tasks, assigns to team |
| Tasks → board | Manual only | Peon creates tasks via TodoWrite → auto-appear on board |
| Agent status | None | green filled = working, green hollow = idle, red = error |

---

## Testing requirements (apply to every task)

Every task must have **both** before it's considered done:
1. **Passing tests** — unit or integration tests covering the changed code. No skipped tests.
2. **Manual verification** — curl commands and/or browser steps that prove it works end-to-end.

If something can't be unit tested (pure UI), browser steps are required. If it's a pure API change, curl steps are required. Both where applicable.

---

## Tasks

---

### TASK 1 — Strip dashboard to project list only

**Files:**
- `packages/web/src/pages/DashboardPage.tsx` — remove `MasterChatPanel`, make `ProjectsSidebar` full width

**Spec:**
- Full-page centered project list, max-width ~640px
- Header: "peon" (left) + "Settings" link (right)
- Section label: "Your Projects" + `[+ New]` button → `/onboarding`
- Each card: project name + status dot + "● Running / ○ Stopped / ⚡ Creating" + agent count + last active time
- Click card → `/project/:id`
- Empty state: "No projects yet. Create your first project."
- Remove `MasterChatPanel` component from this page entirely (don't delete file yet, just don't render it)

**Tests:**
- Unit: render `DashboardPage` with mocked projects API — assert no chat textarea/input rendered, assert project cards render with name/status/agent count
- Unit: empty state renders when projects array is empty
- Browser: log in → `/dashboard` → confirm no chat UI, confirm project cards visible, confirm `[+ New]` navigates to `/onboarding`, confirm clicking a card navigates to `/project/:id`

---

### TASK 2 — Project page: remove right panel, fix layout

**Files:**
- `packages/web/src/pages/ProjectPage.tsx` — remove `ActivityFeed` right panel, remove right panel toggle button

**Spec:**
- Layout: `[TeamPanel 220px] [Center flex-1]`
- No right panel, no right toggle button
- Keep left panel toggle button
- Keep header (back arrow, project name, status badge, team dots, avatar)
- Keep Chat / Board tab switcher

**Tests:**
- Unit: render `ProjectPage` — assert `ActivityFeed` not in DOM, assert right panel toggle button not rendered
- Browser: open any project → confirm two-panel layout (team left, content right), confirm no right panel, confirm left panel toggles correctly

---

### TASK 3 — TeamPanel (replaces SessionList)

**Files:**
- `packages/web/src/features/sessions/SessionList.tsx` → replace with `TeamPanel`
- `packages/web/src/features/sessions/index.ts` — update export
- `packages/web/src/pages/ProjectPage.tsx` — import `TeamPanel`

**Spec per agent row:**
```
● lead          ← name
```
- Status dot only: green filled `bg-emerald-500` = working, green outline `border-emerald-500` = idle, `bg-red-500` = error
- No token bar
- Agent name from `teamMembers` (use `displayName` / `roleName`)

**Footer (sticky bottom of panel):**
- `[+]` → `POST /api/projects/:id/agents` to spawn new agent, then refresh list
- `[↻]` → re-fetch team members + statuses

**Data source:**
- `GET /api/projects/:id/teams` for member list
- SSE `agent_status` events derived from Claude Code hooks (see TASK 6)

**Tests:**
- Unit: render `TeamPanel` with mocked team members — assert name rendered, correct dot color per status, token bar width proportional to `tokenUsage`
- Unit: `[+]` button calls spawn agent API, `[↻]` re-fetches team
- curl: `GET /api/projects/:id/teams` → assert returns members with `displayName`, `roleName`, `color`
- Browser: open project → confirm team members listed with dots, manually change agent status via SSE mock and confirm dot updates live

---

### TASK 4 — Board: 3 columns, read-only

**Files:**
- `packages/web/src/features/kanban/KanbanPanel.tsx` — strip to read-only 3-column view
- `packages/web/src/features/kanban/` — remove drag-and-drop (`@dnd-kit` usage), remove create/edit/delete task UI

**Spec:**
- Columns: **To Do** | **In Progress** | **Done**
- Column mapping from current DB `boardColumn` field:
  - `backlog` + `todo` → **To Do**
  - `in_progress` → **In Progress**
  - `qa` + `done` → **Done** (or keep qa separate if tasks ever land there)
- Each card:
  ```
  ┌────────────────────┐
  │ Add GitHub OAuth   │
  │ backend  ●         │  ← owner name + active dot if status=working
  └────────────────────┘
  ```
- Active dot (green pulsing) = the owning agent currently has `status: "working"` on this task
- No click, no drag, no context menu — purely observational
- Real-time: SSE `task_update` events move cards between columns instantly

**Tests:**
- Unit: column mapping logic — `backlog`/`todo` → "To Do", `in_progress` → "In Progress", `qa`/`done` → "Done"
- Unit: render board with mocked tasks — assert no drag handles, no add/delete buttons, cards show owner + active dot when `status=working`
- curl: `GET /api/projects/:id/tasks` → assert returns tasks with correct `boardColumn` values
- Browser: open Board tab → confirm 3 columns only, confirm cards are not draggable, confirm no create task button

---

### TASK 5 — Peon creates tasks from chat → board

**This is the core flow: user message → Peon → tasks on board.**

**How it works:**
1. User sends message in chat
2. Peon (lead agent in worker container) receives it
3. Peon calls `TodoWrite` (Claude Code native) or a custom `CreateTask` gateway tool
4. Gateway receives task creation → inserts into `tasks` table (projectId, subject, owner, boardColumn='todo')
5. Gateway broadcasts `task_update` SSE event
6. Board re-renders with new card in **To Do**

**Files:**
- `packages/worker/src/openclaw/plugins/peon-gateway/index.ts` — verify/add `CreateTask` tool that POSTs to gateway
- `packages/gateway/src/web/task-sync.ts` — `handleWorkerTaskUpdate()` is ready, confirm it's reachable from worker
- `packages/gateway/src/routes/internal/` — confirm internal route for worker to call task sync
- `packages/worker/src/openclaw/processor.ts` — parse agent output for task status changes, fire gateway calls

**Board column transitions:**
- Peon creates task → `boardColumn: 'todo'`
- Agent picks up task → `boardColumn: 'in_progress'`, task gets `owner` set to agent name
- Agent completes task → `boardColumn: 'done'`

**Peon system prompt must include:**
```
When you receive a task from the user:
1. Break it into subtasks
2. Call CreateTask for each subtask with an owner (backend/web/qa/etc.)
3. Start working or delegate to teammates
4. Update task status as work progresses
5. Report back in chat when done
```

**Tests:**
- Integration: POST a message to `/api/projects/:id/chat` → after agent responds, `GET /api/projects/:id/tasks` returns ≥1 task with `boardColumn: 'todo'`
- Integration: simulate agent picking up task → task row has `boardColumn: 'in_progress'` and `owner` set
- Integration: simulate agent completing task → task row has `boardColumn: 'done'`
- curl:
  ```bash
  # Send chat message
  curl -X POST /api/projects/:id/chat -d '{"content":"Add login page"}' -H "Cookie: session=..."
  # Poll tasks
  curl /api/projects/:id/tasks -H "Cookie: session=..."
  # Expect tasks with boardColumn: todo
  ```
- Browser: type "Add login page" in chat → confirm tasks appear on Board tab within seconds

---

### TASK 6 — Agent status from Claude Code hooks (disler pattern)

**What:** Use Claude Code's own hook system to derive agent status — no custom processor instrumentation needed. Adapted from https://github.com/disler/claude-code-hooks-multi-agent-observability.

**How hooks map to status:**
| Hook event | Agent status |
|---|---|
| `PreToolUse` | `working` |
| `PostToolUse` | `working` (still in turn) |
| `PostToolUseFailure` | `error` |
| `Notification` with `notification_type: idle_prompt` | `idle` |
| `Stop` / `SessionEnd` | `idle` |
| `SubagentStart` | `working` |
| `SubagentStop` | `idle` |

**Files:**
- Copy `send_event.py` from disler repo into `packages/worker/src/.claude/hooks/` — already posts events to a server endpoint; point it at gateway instead of disler's Bun server
- `packages/gateway/src/routes/internal/hook-events.ts` — receive hook POSTs, derive status, broadcast `agent_status` SSE event to project subscribers
- `packages/worker/src/.claude/settings.json` — wire up the 12 hook events per disler's `settings.json` pattern, with `--source-app {agentId}` so gateway knows which agent fired it
- No changes to `processor.ts` — hooks handle this entirely

**SSE payload broadcast to client (simplified — no tokenUsage):**
```ts
{
  type: "agent_status",
  agentId: string,
  status: "working" | "idle" | "error",
}
```

**Tests:**
- Unit: hook event → status mapping function (pure function, easy to test all cases)
- Integration: POST a fake `PreToolUse` hook event to gateway → SSE stream emits `agent_status` with `status: "working"`
- curl:
  ```bash
  # Simulate a hook firing
  curl -X POST /api/internal/hooks \
    -H "Content-Type: application/json" \
    -d '{"event_type":"PreToolUse","source_app":"agent-123","project_id":"proj-456"}'
  # Watch SSE stream
  curl -N /api/projects/proj-456/chat/stream -H "Cookie: session=..." | grep agent_status
  ```
- Browser: send a chat message → confirm team panel dot turns green filled during agent tool use, hollow after `Stop` fires

---

### TASK 7 — Wire it all together: end-to-end test

One flow to verify everything works:

1. Open project → TeamPanel shows agents with correct dots
2. Type "Add user authentication" in chat
3. Peon responds and creates 3–4 tasks → appear in **To Do** on board
4. Agents pick them up → cards move to **In Progress**, active dots appear
5. Agents finish → cards move to **Done**
6. Peon sends summary in chat

If any step breaks, fix it before calling MVP done.

**Tests:**
- All previous task tests must be passing
- Browser end-to-end:
  1. Open project → TeamPanel shows agents with correct dots
  2. Type "Add GitHub OAuth login" in chat, hit send
  3. Watch board — tasks appear in To Do within ~5s
  4. Watch team panel — dots go green filled as agents pick up work
  5. Watch board — cards move to In Progress
  6. Cards eventually move to Done
  7. Peon sends summary message in chat
- If full agent run is too slow for CI, write an integration test that mocks worker responses and verifies board state transitions via the API

---

## Build order

```
1 → Dashboard strip (quick win, unblocks clean testing)
2 → Project layout fix (remove right panel)
3 → Board read-only 3 columns (parallel with 2)
4 → TeamPanel (needs agent_status SSE from task 6)
5+6 → Peon task creation + agent status (core, do together)
7 → End-to-end test
```

## What to NOT build in MVP
- Onboarding changes (keep as-is)
- Settings page
- Ticket classification (Info/Task/Critical) — simplify to just the board
- Activity feed / notifications
- Git/file change events in UI
- Multi-user / auth changes
- Mobile layout
