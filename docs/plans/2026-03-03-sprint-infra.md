# Sprint: Infrastructure & UX Overhaul

**Goal:** Wire up the real agent infrastructure (tmux, CLAUDE.md bootstrap, activity pipeline), fix task board visibility, stabilize SSE, and redesign the project page layout.

**Team:** Lead (coordinator), Designer (UI), Backend (gateway/worker), Infra (containers/worker), Web (frontend)

---

## Item 1: CLAUDE.md Bootstrap (INFRA)

**Problem:** When a user's repo doesn't have a `.claude/CLAUDE.md`, the agent has no project context. We need to auto-run `claude init` to bootstrap it.

**Current state:** `project-launcher.ts:initProjectWorkspace()` already writes a `.claude/CLAUDE.md` with team config, but only in the worker's workspace — not in the cloned repo. If the user's repo lacks a CLAUDE.md, agents start without project-specific instructions.

**Files:**
- Modify: `packages/worker/src/openclaw/worker.ts` — after workspace setup, check if CLAUDE.md exists in cloned repo, if not run `claude init`
- Modify: `packages/gateway/src/web/project-launcher.ts` — ensure template-specific CLAUDE.md content is passed to worker

**Acceptance criteria:**
- After repo clone, if no `.claude/CLAUDE.md` exists, worker runs `claude init` to create one
- Template-specific instructions (agent roles, project type) are injected into the generated CLAUDE.md
- Existing CLAUDE.md files in repos are preserved (not overwritten)

---

## Item 2: tmux for Claude Code Agents (INFRA)

**Problem:** Agents are spawned as raw `spawn("claude", ...)` subprocesses. No session persistence, no monitoring, no ability to attach/detach.

**Current state:** `packages/worker/src/openclaw/plugins/peon-gateway/index.ts:429-485` spawns Claude Code with `spawn()`, captures stdout. The `activeTeams` map tracks processes.

**Files:**
- Modify: `packages/worker/src/openclaw/plugins/peon-gateway/index.ts` — replace `spawn("claude", ...)` with tmux session creation
- Create: `packages/worker/src/openclaw/tmux-manager.ts` — tmux session lifecycle (create, attach, list, kill, capture output)

**Approach:**
```
tmux new-session -d -s "agent-{projectId}" "claude -p '{task}' --output-format stream-json --allowedTools '{tools}'"
```
- Capture output via `tmux pipe-pane` or by reading the tmux pane buffer
- Parse stream-json output from tmux capture
- Track session state (running, completed, errored)

**Acceptance criteria:**
- Each Claude Code agent runs in a named tmux session
- Output is captured and parsed (stream-json format)
- Sessions can be listed and killed
- Worker can query tmux session status instead of process handles

---

## Item 3: Agent Activity Pipeline (BACKEND)

**Problem:** Worker already POSTs basic events to `/internal/agent-activity`, but the data is too generic. Need to parse Claude Code's `stream-json` output and extract rich, human-readable events.

**Current state:**
- Worker posts: `tool_start`, `tool_end`, `thinking`, `turn_end`, `error` (worker.ts:660-687)
- Processor.ts parses stream-json events but only extracts text content
- Agent activity route broadcasts raw events to SSE

**Files:**
- Modify: `packages/worker/src/openclaw/processor.ts` — extract tool names, file paths, commands from stream-json
- Modify: `packages/worker/src/openclaw/worker.ts` — post richer events with parsed metadata
- Modify: `packages/gateway/src/routes/internal/agent-activity.ts` — validate and normalize enriched events

**Stream-json event types to parse:**
```json
{"type":"tool_use","tool_name":"Read","tool_input":{"file_path":"src/App.tsx"}}
{"type":"tool_use","tool_name":"Edit","tool_input":{"file_path":"src/App.tsx","old_string":"...","new_string":"..."}}
{"type":"tool_use","tool_name":"Bash","tool_input":{"command":"npm test"}}
{"type":"tool_use","tool_name":"Write","tool_input":{"file_path":"src/new-file.ts"}}
{"type":"tool_use","tool_name":"Glob","tool_input":{"pattern":"**/*.tsx"}}
{"type":"tool_use","tool_name":"Grep","tool_input":{"pattern":"useEffect","path":"src/"}}
```

**Enriched event payload:**
```typescript
{
  type: "tool_start",
  tool: "Read",
  text: "Reading src/App.tsx",       // Human-readable
  filePath: "src/App.tsx",           // Structured metadata
  agentName: "backend",
  timestamp: 1709481234567
}
```

**Acceptance criteria:**
- Each tool event includes human-readable `text` field
- File operations include `filePath`
- Bash commands include `command` (truncated to 100 chars)
- Existing event types still work

---

## Item 4: Fix Tasks Not Showing in Board (BACKEND)

**Problem:** Tasks created by agents don't appear in the kanban board UI.

**Diagnosis needed:** The board fetches tasks via `GET /api/projects/:id/tasks` which calls `getProjectTasks()` from task-sync.ts. Tasks come from the DB (drizzle). The question is: are tasks being created at all? Is the agent calling task creation tools? Is the board column mapping correct?

**Files:**
- Check: `packages/gateway/src/web/task-sync.ts` — task upsert and fetch logic
- Check: `packages/gateway/src/web/chat-routes.ts` — task CRUD endpoints
- Check: `packages/web/src/hooks/use-board.ts` — frontend task fetching
- Check: `packages/web/src/components/board/Board.tsx` — column mapping
- Check: DB schema for tasks table

**Likely issues:**
1. Agent creates tasks via Claude Code's TaskCreate tool, but those go to Claude's internal task system — not our DB
2. The `handleWorkerTaskUpdate()` function needs to be called when agent tasks change
3. Board expects `boardColumn` field but agent tasks may not have it (defaults to "backlog")

**Acceptance criteria:**
- Tasks created by agents appear in the board within 5s
- Task status changes (pending→in_progress→completed) update the board in real-time
- Manual task creation from the board still works

---

## Item 5: Human-Readable Activity Feed (WEB)

**Problem:** Activity feed shows generic "tool used" messages. Need to show actual file paths, commands, and meaningful descriptions.

**Current state:** `ActivityFeed.tsx` renders events with `toolLabel()` function. `use-agent-activity.ts` processes `agent_activity` SSE events.

**Files:**
- Modify: `packages/web/src/components/project/ActivityFeed.tsx` — render rich event data
- Modify: `packages/web/src/hooks/use-agent-activity.ts` — consume enriched event payloads

**Display examples:**
- `Read` → "Reading `src/App.tsx`" (with monospace file path)
- `Edit` → "Editing `src/App.tsx`"
- `Bash` → "Running `npm test`"
- `Write` → "Creating `src/new-file.ts`"
- `Grep` → "Searching for `useEffect` in `src/`"
- `Glob` → "Finding files matching `**/*.tsx`"

**Acceptance criteria:**
- Tool events show human-readable descriptions with file paths/commands
- File paths rendered in monospace
- Long commands truncated with ellipsis
- Existing event types still render correctly

---

## Item 6: SSE Connection Stability (WEB)

**Problem:** SSE keeps disconnecting and reconnecting, causing "Reconnecting..." flicker.

**Current state:** `use-chat.ts` creates `EventSource` with no custom reconnection. Browser default can cause rapid reconnect cycles. No heartbeat detection.

**Files:**
- Modify: `packages/web/src/hooks/use-chat.ts` — add heartbeat monitoring, manual reconnection with exponential backoff
- Modify: `packages/web/src/hooks/use-agent-activity.ts` — same SSE stability improvements
- Modify: `packages/gateway/src/web/chat-routes.ts` — add server-side heartbeat (ping every 15s)

**Approach:**
1. Server sends `ping` event every 15s on SSE stream
2. Client tracks last event time; if no event in 30s, close and reconnect
3. Manual reconnection with exponential backoff (1s, 2s, 4s, max 30s)
4. Deduplicate reconnection attempts (single reconnect timer)
5. Re-fetch history on reconnect (already done for chat, add for tasks)

**Acceptance criteria:**
- SSE reconnects cleanly within 5s of disconnect
- No rapid reconnection cycling
- "Connected" indicator accurate (reflects actual data flow, not just TCP state)
- Server heartbeat prevents stale connection detection

---

## Item 7: Project Page UI Redesign (DESIGNER)

**Problem:** Current layout is functional but rough. Need a clean, professional project page.

**Current layout:**
```
┌─ Header (back + title + agents/board toggle + avatar) ──┐
├─── Main Area (AgentDashboard or Board) ─┬── Chat ───────┤
│                                          │  (380px)      │
│                                          │               │
└──────────────────────────────────────────┴───────────────┘
```

**Target vision (from Ed):**
- Left sidebar: team/agents list
- Center: board/chat (Slack-like chat)
- Right: activity feed timeline
- Clean agent cards with status indicators
- Professional, modern dark theme

**Files:**
- Modify: `packages/web/src/pages/ProjectPage.tsx` — new 3-column layout
- Modify: `packages/web/src/components/project/AgentDashboard.tsx` — redesign as sidebar
- Modify: `packages/web/src/components/project/AgentStatusCards.tsx` — compact card design
- Modify: `packages/web/src/components/project/ActivityFeed.tsx` — timeline-style layout
- Modify: `packages/web/src/components/chat/ChatPanel.tsx` — Slack-like chat design

**Acceptance criteria:**
- 3-column layout: agents sidebar | board+chat center | activity feed right
- Slack-like chat with clear message threading
- Agent cards show status, current task, and tool activity
- Activity feed as timeline with grouped events
- Responsive and clean dark theme
- No layout shifts during loading/transitions

---

## Execution Order

**Phase 1 (parallel):**
- INFRA: Items 1 + 2 (CLAUDE.md bootstrap + tmux)
- BACKEND: Item 4 (diagnose + fix task board)
- WEB: Item 6 (SSE stability)
- DESIGNER: Item 7 (UI audit + mockups)

**Phase 2 (depends on Phase 1):**
- BACKEND: Item 3 (activity pipeline — needs tmux output from Item 2)
- WEB: Item 5 (activity feed — needs enriched events from Item 3)
- DESIGNER: Item 7 continued (implement approved designs)

**Phase 3 (integration):**
- Wire everything together
- End-to-end testing
- Polish pass
