# Paperclip → Peon Adoption Plan (Updated)

## Golden Rule

**Before implementing anything from Paperclip, verify:**
1. How does Paperclip actually implement it? (read the source)
2. How does Peon currently implement it? (read the source)
3. Does the Paperclip way conflict with Peon's working architecture?

If it conflicts → don't port it. If it's additive → port it.

---

## Peon's Core Architecture (Do Not Break)

```
User → Peon UI (React)
     → Gateway (Hono + Postgres + Redis + BullMQ)
     → Docker container per user
         → OpenClaw gateway (subprocess)
             → Claude Code teams (tmux sessions per agent)
     → SSE stream → Kanban board (live task progress)
```

- **Docker is mandatory.** Peon is SaaS. Isolation is required.
- **OpenClaw is the agent runtime.** Claude Code runs inside OpenClaw inside Docker.
- **Claude Code teams** are the coding unit — lead + frontend + backend + QA agents.
- **Kanban board** shows live progress from agent activity via SSE.

Paperclip runs Claude Code as a child process on the host (no Docker, no OpenClaw). That entire approach is incompatible with Peon. Do not port the execution model.

---

## Claude Code Integration Issues (Priority 0)

These are **blocking issues** that prevent Peon from working at all. Fix before anything else.

### Problem 1: First-run onboarding wizard (theme selection, permissions)

**What happens:** Claude Code's first run in a container shows an interactive TTY wizard (theme selection, dark mode, onboarding steps). OpenClaw starts Claude Code in a tmux session with a TTY, so the wizard appears and blocks everything.

**How Paperclip avoids it:** Runs Claude Code in headless mode — no TTY, no wizard.
```bash
claude --print - --output-format stream-json --verbose
```
This is irrelevant to Peon because Peon uses OpenClaw, not direct `claude` invocation.

**Fix for Peon:** Pre-populate `~/.claude/settings.json` in the container before OpenClaw starts:
```json
{
  "skipDangerousModePermissionPrompt": true,
  "theme": "dark",
  "hasCompletedOnboarding": true
}
```

Where to do it: in the container entrypoint script or in `packages/worker/src/core/workspace.ts` during workspace init — write this file to `~/.claude/settings.json` before `openclaw gateway` is spawned.

**Verify:** Check what keys Claude Code reads from `~/.claude/settings.json` to determine onboarding state. The key `skipDangerousModePermissionPrompt: true` is confirmed to exist (from host machine). Find the onboarding/theme key by running `claude` fresh in a clean container and watching what gets written to `~/.claude/settings.json`.

### Problem 2: Auth (`~/.claude/`) persistence across container restarts

**What happens:** OAuth tokens live in `~/.claude/` inside the container. Container dies, tokens gone, re-auth required.

**Peon's approach:** Mount `~/.claude/` as a named Docker volume per user (or pass the OAuth path in). This is already partially implemented.

**What to verify:** Confirm the Docker volume for `~/.claude/` is actually mounted and persisted in `packages/gateway/src/orchestration/` (wherever containers are provisioned). If not, add the volume mount.

**Paperclip's approach for comparison:** Not relevant — it runs on host directly.

---

## Phase 1 — Task Checkout Locking

**Problem:** Peon uses last-write-wins on task `owner` field. Two agents can grab the same task simultaneously. On crash, task stays `in_progress` forever with no recovery.

**Paperclip's solution:** `executionRunId` + `executionLockedAt` + `executionLockedBy` on issues table. Atomic checkout via `SELECT FOR UPDATE SKIP LOCKED`. Stale lock detection without auto-reassignment (surfaces on dashboard, human decides).

**Verify Peon's current state:** Check `packages/gateway/src/db/schema.ts` tasks table and `packages/gateway/src/web/chat-routes.ts` for any existing locking. Check how agents currently claim tasks (`owner` field assignment).

**If Peon has no locking → implement:**

Add to `packages/gateway/src/db/schema.ts` tasks table:
```typescript
lockedBy: text("locked_by"),       // agent role name
lockedAt: timestamp("locked_at"),  // when checkout happened
lockedRunId: text("locked_run_id") // unique ID per checkout
```

Add to `packages/gateway/src/routes/internal/tasks.ts`:
```
POST /internal/tasks/:id/checkout  — atomic SELECT FOR UPDATE SKIP LOCKED, returns 409 if locked
POST /internal/tasks/:id/release   — clears lock fields
```

Add stale lock cleanup in `packages/gateway/src/orchestration/scheduled-wakeup.ts`:
```
Every 5min: release locks older than 30min (dead agent detection, no auto-reassign)
```

**Risk:** Additive columns. Existing code ignores locks until workers start using new endpoints.

---

## Phase 2 — Audit Log

**Problem:** Agent activity (tool calls, file edits, bash commands) is broadcast over SSE and lost on gateway restart or browser disconnect. No way to answer "what did the agent do yesterday?"

**Paperclip's solution:** `activity_log` table — every action saved with actor, entity, action, and JSONB details. Simultaneously publishes live events for real-time UI. File-based run logs with SHA256 checksums as secondary storage.

**Verify Peon's current state:** Check `packages/gateway/src/routes/internal/hook-events.ts` and `packages/gateway/src/routes/internal/agent-activity.ts` — confirm that activity events are currently SSE-only (not persisted).

**If no persistence → implement:**

Add to `packages/gateway/src/db/schema.ts`:
```typescript
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  actorRole: text("actor_role"),       // "lead", "frontend", "backend"
  entityType: text("entity_type"),     // "task", "file", "command"
  entityId: text("entity_id"),         // task ID or file path
  action: text("action").notNull(),    // "checkout", "edit", "bash", "complete"
  details: jsonb("details"),           // { filePath, command, output snippet }
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
```

In `packages/gateway/src/routes/internal/hook-events.ts`:
```typescript
// Before SSE broadcast → insert into activity_log
await db.insert(activityLog).values({ ... })
```

**Risk:** Zero. Parallel write alongside existing SSE broadcast. Nothing changes for existing consumers.

---

## Phase 3 — Session Persistence (Resume Claude Code after restart)

**Problem:** Container restart or crash → OpenClaw starts fresh → Claude Code loses context of what it was working on mid-task.

**Paperclip's solution:** `agent_task_sessions` table keyed on `(agentId, taskKey)`. Stores `sessionId` (Claude Code `--resume` target) and `cwd`. On next run, passes `--resume <sessionId>` to Claude Code. If session is gone, retries with fresh session automatically.

**Verify Peon's current state:**
1. Check if OpenClaw exposes session IDs from Claude Code runs
2. Check if Peon's worker (`packages/worker/src/openclaw/`) captures or stores any Claude Code session ID
3. Check if OpenClaw supports `--resume` passthrough to the underlying `claude` process

**This depends on OpenClaw internals.** If OpenClaw doesn't expose the Claude Code session ID, this cannot be implemented at the Peon layer without modifying OpenClaw.

**If feasible → implement:**

Add to `packages/gateway/src/db/schema.ts`:
```typescript
export const agentTaskSessions = pgTable("agent_task_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  agentRole: text("agent_role").notNull(),
  taskId: uuid("task_id").references(() => tasks.id),
  sessionId: text("session_id"),        // Claude Code session ID for --resume
  workingDir: text("working_dir"),      // workspace path when session was saved
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [unique().on(t.projectId, t.agentRole, t.taskId)])
```

**Risk:** Medium. Requires verifying OpenClaw's session ID exposure. Gate behind feature flag.

---

## What NOT to Port

| Paperclip Feature | Why Skip |
|---|---|
| **Direct `claude` child process execution** | Peon uses OpenClaw + Docker. Completely different model. |
| **`--print - --output-format stream-json`** | Paperclip's headless invocation. Peon uses OpenClaw which manages this internally. |
| **`runClaudeLogin` / login URL flow** | Peon mounts `~/.claude/` as a volume. Auth is handled at the Docker level. |
| **Hello probe (`testEnvironment`)** | Paperclip probes before each run. OpenClaw handles agent health internally. |
| **Cost tracking (`cost_events`)** | Not required for Peon. |
| **Multi-company isolation** | Peon is per-user isolated at Docker container level. |
| **Heartbeat scheduler** | Peon uses BullMQ which is more reliable. |
| **Adapter plugin architecture** | Peon is OpenClaw-only by design. |
| **Goal hierarchy** | Peon's flat task list is sufficient. |
| **Approval gates** | Future consideration, not now. |
| **CLI tool** | Peon is web-only. |
| **`agent_config_revisions`** | Low impact, nice-to-have later. |

---

## Implementation Order

```
Priority 0 (blocking — do first):
  Verify ~/.claude/ volume persistence in Docker provisioning
  Pre-populate ~/.claude/settings.json to skip onboarding wizard
  Test: launch team → agents start without wizard → tasks appear on board

Week 1:
  Task checkout locking — schema + endpoints + worker usage
  Audit log — schema + persist before SSE broadcast

Week 2:
  Investigate OpenClaw session ID exposure
  Session persistence — if feasible, implement with feature flag

Later:
  Approval gates (opt-in per project)
```

---

## Schema Migration Strategy

All changes are additive (new tables + nullable columns on tasks). No existing queries break.

1. Add nullable columns to tasks: `lockedBy`, `lockedAt`, `lockedRunId`
2. Add new tables: `activity_log`, `agent_task_sessions`
3. Deploy gateway — new tables exist, nothing uses them yet
4. Deploy worker with locking disabled — smoke test
5. Enable locking per-project in staging, then prod

Zero-downtime. No backfill needed.
