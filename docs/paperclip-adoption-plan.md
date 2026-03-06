# Paperclip → Peon Adoption Plan

How to lift the best coding-relevant patterns from Paperclip into Peon without breaking existing infrastructure. All changes are additive — no removal of existing systems.

Paperclip is MIT licensed. Code can be borrowed directly.

---

## Phase 1 — Quick Wins (1–2 days each, zero infrastructure risk)

### 1.1 Task Checkout Locking

**Problem:** Peon uses last-write-wins on task `owner` field. Two agents can grab the same task. On crash, task stays `in_progress` forever.

**Paperclip's solution:** `executionRunId` + `executionLockedAt` + `executionLockedBy` on issues table. Atomic checkout via `SELECT FOR UPDATE SKIP LOCKED`.

**Peon implementation:**

Add to `packages/gateway/src/db/schema.ts`:
```typescript
// On tasks table
lockedBy: text("locked_by"),                          // agent role name
lockedAt: timestamp("locked_at"),                     // when checkout happened
lockedRunId: text("locked_run_id"),                   // unique run ID per checkout
```

Add to `packages/gateway/src/routes/internal/tasks.ts`:
```typescript
// POST /internal/tasks/:id/checkout
// Uses db.transaction() + FOR UPDATE SKIP LOCKED
// Returns 409 if already locked

// POST /internal/tasks/:id/release
// Clears lock fields, sets status back to pending if needed
```

Add a cleanup job in `packages/gateway/src/orchestration/scheduled-wakeup.ts`:
```typescript
// Every 5 min: release locks older than 30min (dead agent detection)
```

**Risk:** Zero. Additive columns. Existing code still works — it just ignores locks until workers start using the new endpoints.

---

### 1.2 Audit Log

**Problem:** Agent activity (tool calls, file edits, decisions) is broadcast over SSE and lost on reconnect/restart. Nothing is persisted.

**Paperclip's solution:** `activity_log` table — every action saved with `actor`, `entityType`, `entityId`, `action`, `details` (JSONB).

**Peon implementation:**

Add to `packages/gateway/src/db/schema.ts`:
```typescript
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  actorRole: text("actor_role"),          // "lead", "frontend", etc.
  entityType: text("entity_type"),        // "task", "file", "command"
  entityId: text("entity_id"),            // task ID or file path
  action: text("action").notNull(),       // "checkout", "edit", "bash", "complete"
  details: jsonb("details"),              // { filePath, command, output snippet }
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
```

In `packages/gateway/src/routes/internal/hook-events.ts` (where agent activity arrives):
```typescript
// Before SSE broadcast, insert into activity_log
await db.insert(activityLog).values({ ... })
```

Add to web frontend: a collapsible "Activity" panel per project showing the log. No new API needed — just query `activity_log` by `projectId`.

**Risk:** Zero. Existing SSE broadcast unchanged. Log is a parallel write.

---

### 1.3 Cost Tracking

**Problem:** Users bring their own API keys and have zero visibility into spend. No limits, no alerts, no stopping a runaway agent.

**Paperclip's solution:** `cost_events` table (per-LLM-call recording) + budget fields on agents/companies + auto-pause when limit hit.

**Peon implementation — Phase 1 (visibility only, no enforcement):**

Add to `packages/gateway/src/db/schema.ts`:
```typescript
export const costEvents = pgTable("cost_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  agentRole: text("agent_role"),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }),
  model: text("model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
```

Worker already receives token usage data from Claude Code output — parse it in `packages/worker/src/openclaw/worker.ts` and POST to gateway alongside activity events.

Add a `GET /api/projects/:id/cost` endpoint returning total spend + per-agent breakdown.

Show spend on the project dashboard (small token counter near the chat input, like a fuel gauge).

**Phase 2 (budget enforcement) — add later:**
- `monthlyBudgetUsd` on projects table
- Gateway checks running total before dispatching next job
- Auto-pause + notify user when 80% / 100% hit

**Risk:** Phase 1 is zero risk. Phase 2 requires a gateway dispatch check — minimal.

---

## Phase 2 — Session Persistence (2–3 days, moderate complexity)

**Problem:** When a worker container restarts, the agent starts fresh. No memory of what task it was working on or what it already tried.

**Paperclip's solution:** `agent_task_sessions` table — keyed on `(agentId, taskKey)`, stores `sessionParams` JSONB. The `claude-local` adapter uses this to pass `--resume <sessionId>` to Claude Code CLI when the working directory matches.

**Peon implementation:**

Add to `packages/gateway/src/db/schema.ts`:
```typescript
export const agentTaskSessions = pgTable("agent_task_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  agentRole: text("agent_role").notNull(),
  taskId: uuid("task_id").references(() => tasks.id),
  sessionId: text("session_id"),           // Claude Code session ID (--resume target)
  workingDir: text("working_dir"),         // workspace path at time of session
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [unique().on(t.projectId, t.agentRole, t.taskId)])
```

In worker (`packages/worker/src/openclaw/worker.ts`):
1. When starting a task, check gateway for existing `agentTaskSessions` row
2. If found and working dir matches, pass `--resume <sessionId>` to OpenClaw/Claude Code
3. After each successful turn, POST updated `sessionId` to gateway to keep it current
4. On task complete/fail, mark session as closed

In `packages/gateway/src/routes/internal/`:
- `POST /internal/sessions/agent-task` — upsert session record
- `GET /internal/sessions/agent-task?projectId=&agentRole=&taskId=` — lookup

**Risk:** Medium. Changes the worker startup flow. Needs testing that `--resume` works correctly in OpenClaw. Can be feature-flagged off initially.

---

## Phase 3 — Approval Gates (3–5 days, new UX surface)

**Problem:** No checkpoint between "agents are coding" and "code is committed to main." No way for a user to say "don't push without my approval."

**Paperclip's solution:** `approvals` table with state machine (`pending → approved/rejected`). Agents pause and wait for human action before proceeding.

**Peon implementation:**

Add to schema:
```typescript
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  taskId: uuid("task_id").references(() => tasks.id),
  type: text("type"),                      // "merge", "deploy", "delete"
  requestedBy: text("requested_by"),       // agent role
  status: text("status").default("pending"), // pending | approved | rejected
  details: jsonb("details"),               // PR link, diff summary, etc.
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
```

Worker: when Lead agent signals it's ready to merge/deploy (detected from chat output or explicit `RequestApproval` tool), gateway creates approval row and SSEs a "waiting for approval" state to frontend.

Frontend: approval card appears in chat. User clicks Approve/Reject. Gateway updates row and SSEs unblock signal to worker.

**Risk:** Medium-high. New tool the agent needs to know about. Requires prompt engineering to make Lead reliably use it. Can ship as opt-in per-project setting initially.

---

## What NOT to Port

| Paperclip Feature | Why Skip |
|---|---|
| Org charts / reporting lines | Peon's team is fixed (lead/FE/BE/QA). No org tree needed. |
| Multi-company isolation | Peon is SaaS with per-user isolation already. |
| Heartbeat scheduler | Peon uses BullMQ which is more reliable. |
| ClipMart / templates export | Not relevant until Peon has a marketplace. |
| `agent_config_revisions` | Nice-to-have but low impact. Add if agents go wrong in prod. |
| CLI tool | Peon is web-only by design. |
| Goal hierarchy (multi-level) | Peon's flat task list is sufficient for project scope. |

---

## Implementation Order

```
Week 1:
  Day 1-2:  Task checkout locking (1.1) — schema + endpoints + worker usage
  Day 3-4:  Audit log (1.2) — schema + hook into existing activity events
  Day 5:    Cost visibility (1.3 Phase 1) — schema + worker parsing + dashboard widget

Week 2:
  Day 1-3:  Session persistence (2) — schema + worker startup flow + feature flag
  Day 4-5:  Cost budget enforcement (1.3 Phase 2) — dispatch check + pause + notify

Week 3+:
  Approval gates (3) — new tool + frontend approval card + opt-in setting
```

---

## Schema Migration Strategy

All changes are additive (new tables + nullable columns). No existing queries break.

1. Add new tables with `CREATE TABLE IF NOT EXISTS`
2. Add nullable columns to existing tables (tasks: `lockedBy`, `lockedAt`, `lockedRunId`)
3. Deploy gateway — new tables exist, nothing uses them yet
4. Deploy worker with feature flags off — smoke test
5. Enable feature flags per-project in staging, then prod

Zero-downtime. No backfill needed.
