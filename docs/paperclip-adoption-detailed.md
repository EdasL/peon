# Paperclip Adoption — Detailed Implementation Spec

> Peon-specific implementation plan for adopting 4 features from Paperclip.
> Every code sample matches Peon's stack: Bun, Drizzle ORM, Hono, BullMQ, Redis pub/sub, Docker containers, OpenClaw worker, SSE fan-out.

---

## 1. Task Checkout Locking

### Why it matters for Peon

Peon's multi-agent architecture spawns Claude Code teammates inside a single Docker container via tmux sessions. When the lead agent creates tasks on the board and delegates to teammates, nothing prevents two agents from claiming the same task — `task-sync.ts` uses `INSERT ... ON CONFLICT DO UPDATE` with last-write-wins semantics. In practice, agents cooperate because of system prompt instructions ("each teammate owns their scope"), but this is fragile. A teammate crash leaves a task stuck in `in_progress` with no timeout detection. Adding atomic checkout with dead-lock cleanup gives Peon hard guarantees instead of soft conventions.

### Schema additions

Add three columns to the existing `tasks` table in `packages/gateway/src/db/schema.ts`:

```typescript
// In the existing tasks pgTable definition, add these columns:
import { pgTable, text, timestamp, uuid, jsonb, integer } from "drizzle-orm/pg-core"

export const tasks = pgTable("tasks", {
  // ... existing columns unchanged ...
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  description: text("description").default("").notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed"] }).default("pending").notNull(),
  owner: text("owner"),
  boardColumn: text("board_column", { enum: ["backlog", "todo", "in_progress", "qa", "done"] }).default("backlog").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // NEW: checkout locking
  lockedBy: text("locked_by"),
  lockedAt: timestamp("locked_at"),
  lockToken: uuid("lock_token"),
})
```

- `lockedBy` — agent name that holds the lock (e.g. `"backend"`, `"frontend"`)
- `lockedAt` — when the lock was acquired (used for stale lock detection)
- `lockToken` — random UUID issued at checkout time; must match for release/update (prevents stale clients from releasing a re-acquired lock)

### SQL migration

```sql
-- packages/gateway/drizzle/XXXX_task_checkout_locking.sql
ALTER TABLE "tasks" ADD COLUMN "locked_by" text;
ALTER TABLE "tasks" ADD COLUMN "locked_at" timestamp;
ALTER TABLE "tasks" ADD COLUMN "lock_token" uuid;
```

### Files to modify

#### `packages/gateway/src/web/task-sync.ts` — Add checkout/release/stale-cleanup functions

```typescript
import { db } from "../db/connection.js"
import { tasks } from "../db/schema.js"
import { eq, and, isNotNull, lt, sql } from "drizzle-orm"
import { broadcastToProject } from "./chat-routes.js"
import crypto from "node:crypto"

const LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export interface CheckoutResult {
  success: boolean
  lockToken?: string
  heldBy?: string
}

export async function checkoutTask(
  projectId: string,
  taskId: string,
  agentName: string
): Promise<CheckoutResult> {
  const lockToken = crypto.randomUUID()
  const now = new Date()

  // Atomic checkout: only succeeds if task is unlocked or lock is stale
  const result = await db
    .update(tasks)
    .set({
      lockedBy: agentName,
      lockedAt: now,
      lockToken,
      status: "in_progress",
      owner: agentName,
      boardColumn: "in_progress",
      updatedAt: now,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.projectId, projectId),
        sql`("locked_by" IS NULL OR "locked_at" < NOW() - INTERVAL '${sql.raw(String(LOCK_TIMEOUT_MS / 1000))} seconds')`
      )
    )
    .returning({ id: tasks.id })

  if (result.length === 0) {
    // Lock held by someone else — find who
    const existing = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)),
      columns: { lockedBy: true },
    })
    return { success: false, heldBy: existing?.lockedBy ?? undefined }
  }

  broadcastToProject(projectId, "task_update", {
    id: taskId,
    status: "in_progress",
    owner: agentName,
    boardColumn: "in_progress",
    lockedBy: agentName,
  })

  return { success: true, lockToken }
}

export async function releaseTask(
  projectId: string,
  taskId: string,
  lockToken: string,
  finalStatus: "completed" | "pending" = "completed"
): Promise<boolean> {
  const boardColumn = finalStatus === "completed" ? "done" : "todo"
  const now = new Date()

  const result = await db
    .update(tasks)
    .set({
      lockedBy: null,
      lockedAt: null,
      lockToken: null,
      status: finalStatus,
      boardColumn,
      updatedAt: now,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.projectId, projectId),
        eq(tasks.lockToken, lockToken)
      )
    )
    .returning({ id: tasks.id })

  if (result.length > 0) {
    broadcastToProject(projectId, "task_update", {
      id: taskId,
      status: finalStatus,
      boardColumn,
      lockedBy: null,
    })
  }
  return result.length > 0
}

export async function cleanupStaleLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MS)

  const stale = await db
    .update(tasks)
    .set({
      lockedBy: null,
      lockedAt: null,
      lockToken: null,
      status: "pending",
      boardColumn: "todo",
      updatedAt: new Date(),
    })
    .where(
      and(
        isNotNull(tasks.lockedBy),
        lt(tasks.lockedAt, cutoff)
      )
    )
    .returning({ id: tasks.id, projectId: tasks.projectId })

  for (const row of stale) {
    broadcastToProject(row.projectId, "task_update", {
      id: row.id,
      status: "pending",
      boardColumn: "todo",
      lockedBy: null,
    })
  }
  return stale.length
}
```

#### `packages/gateway/src/routes/internal/tasks.ts` — Add checkout/release endpoints

Add two new routes inside `createInternalTaskRoutes()`:

```typescript
// POST /internal/tasks/:taskId/checkout — atomic task claim
router.post("/internal/tasks/:taskId/checkout", async (c) => {
  const token = authMiddleware(c)
  if (!token) return c.json({ error: "Unauthorized" }, 401)

  const taskId = c.req.param("taskId")
  const body = await c.req.json<{ agentName: string }>().catch(() => null)
  if (!body?.agentName) return c.json({ error: "agentName required" }, 400)

  const projectId = await resolveProjectId(token.conversationId)
  if (!projectId) return c.json({ error: "No active project found" }, 404)

  const result = await checkoutTask(projectId, taskId, body.agentName)
  if (!result.success) {
    return c.json({ error: "Task locked", heldBy: result.heldBy }, 409)
  }
  return c.json({ ok: true, lockToken: result.lockToken })
})

// POST /internal/tasks/:taskId/release — release lock
router.post("/internal/tasks/:taskId/release", async (c) => {
  const token = authMiddleware(c)
  if (!token) return c.json({ error: "Unauthorized" }, 401)

  const taskId = c.req.param("taskId")
  const body = await c.req.json<{ lockToken: string; status?: "completed" | "pending" }>().catch(() => null)
  if (!body?.lockToken) return c.json({ error: "lockToken required" }, 400)

  const projectId = await resolveProjectId(token.conversationId)
  if (!projectId) return c.json({ error: "No active project found" }, 404)

  const released = await releaseTask(projectId, taskId, body.lockToken, body.status)
  if (!released) return c.json({ error: "Lock token mismatch or expired" }, 409)
  return c.json({ ok: true })
})
```

#### `packages/gateway/src/index.ts` — Register stale lock cleanup interval

```typescript
import { cleanupStaleLocks } from "./web/task-sync.js"

// Run stale lock cleanup every 2 minutes
setInterval(async () => {
  const cleaned = await cleanupStaleLocks()
  if (cleaned > 0) logger.info(`Cleaned up ${cleaned} stale task locks`)
}, 2 * 60_000)
```

### Integration with Peon's flow

1. **Worker → Gateway**: When an agent picks up a task (via `UpdateTaskStatus` tool call in OpenClaw), the peon-gateway MCP plugin calls `POST /internal/tasks/:id/checkout` instead of the current upsert. If the checkout fails (409), the agent is told the task is held by another agent.
2. **Task completion**: When the agent finishes, it calls `POST /internal/tasks/:id/release` with the `lockToken` received at checkout.
3. **Crash recovery**: The gateway's 2-minute `cleanupStaleLocks` interval detects any task locked for >10 minutes and auto-releases it back to `pending`. The SSE broadcast notifies connected frontends.
4. **Backward compatibility**: The existing `handleWorkerTaskUpdate` upsert path continues to work for task creation (no lock needed at creation time). Only status transitions to `in_progress` require checkout.

### Effort estimate

**6-8 hours** — migration, task-sync functions, two new API routes, MCP plugin changes to use checkout, cleanup interval, manual testing with concurrent agents.

### Risks

- **Lock timeout tuning**: 10 minutes may be too short for complex tasks where an agent is legitimately working. Mitigation: make timeout configurable per-project via `projects.metadata`.
- **OpenClaw MCP plugin coupling**: The peon-gateway plugin needs to be updated to call checkout/release. If the plugin crashes between checkout and release, the lock goes stale. The cleanup interval handles this but there's a 10-minute window.
- **Existing task upserts**: The current `handleWorkerTaskUpdate` path doesn't acquire locks. Need to ensure hook-events.ts task handling (lines 218-256) either goes through checkout or only creates tasks (never transitions to `in_progress` without a lock).

---

## 2. Audit Log

### Why it matters for Peon

Agent activity events (tool_start, tool_end, error) are currently fire-and-forget via SSE. If the browser isn't connected, events are lost permanently. There is no way to answer "what did the backend agent do 2 hours ago?" or "what changed in the project since yesterday?" or "which agent caused the test failure?". Persisting agent activity to Postgres gives Peon full observability, enables a timeline view in the frontend, and provides the data foundation for cost tracking (Feature 3) and debugging agent behavior.

### Schema additions

New table in `packages/gateway/src/db/schema.ts`:

```typescript
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorType: text("actor_type", { enum: ["agent", "user", "system"] }).default("agent").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export type ActivityLogEntry = typeof activityLog.$inferSelect
export type NewActivityLogEntry = typeof activityLog.$inferInsert
```

Indexes (add via migration, not in Drizzle schema since Peon's existing schema doesn't use inline indexes):

### SQL migration

```sql
-- packages/gateway/drizzle/XXXX_activity_log.sql
CREATE TABLE "activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "actor_type" text NOT NULL DEFAULT 'agent',
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "details" jsonb,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX "activity_log_project_created_idx" ON "activity_log" ("project_id", "created_at" DESC);
CREATE INDEX "activity_log_entity_idx" ON "activity_log" ("entity_type", "entity_id");
```

### Files to modify

#### `packages/gateway/src/services/activity-log.ts` — New service (create file)

```typescript
import { db } from "../db/connection.js"
import { activityLog, type NewActivityLogEntry } from "../db/schema.js"
import { eq, and, desc, lt } from "drizzle-orm"
import { createLogger } from "@lobu/core"

const logger = createLogger("activity-log")

// Batch insert buffer — flush every 2 seconds or when buffer hits 50 entries
const buffer: NewActivityLogEntry[] = []
const FLUSH_INTERVAL_MS = 2_000
const FLUSH_THRESHOLD = 50

export function logActivity(entry: NewActivityLogEntry): void {
  buffer.push(entry)
  if (buffer.length >= FLUSH_THRESHOLD) {
    flushBuffer()
  }
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)
  try {
    await db.insert(activityLog).values(batch)
  } catch (err) {
    logger.error(`Failed to flush ${batch.length} activity log entries:`, err)
    // Don't re-queue — activity log is best-effort, not critical path
  }
}

// Start flush timer
setInterval(() => flushBuffer(), FLUSH_INTERVAL_MS)

export async function queryActivityLog(
  projectId: string,
  opts: { limit?: number; before?: Date; entityType?: string; actorId?: string } = {}
) {
  const limit = Math.min(opts.limit ?? 100, 500)
  const conditions = [eq(activityLog.projectId, projectId)]

  if (opts.before) conditions.push(lt(activityLog.createdAt, opts.before))
  if (opts.entityType) conditions.push(eq(activityLog.entityType, opts.entityType))
  if (opts.actorId) conditions.push(eq(activityLog.actorId, opts.actorId))

  return db.query.activityLog.findMany({
    where: and(...conditions),
    orderBy: [desc(activityLog.createdAt)],
    limit,
  })
}

// Retention: delete entries older than 30 days
export async function pruneOldEntries(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const result = await db.delete(activityLog).where(lt(activityLog.createdAt, cutoff)).returning({ id: activityLog.id })
  return result.length
}
```

#### `packages/gateway/src/routes/internal/agent-activity.ts` — Persist before broadcasting

```typescript
import { logActivity } from "../../services/activity-log.js"

// Inside the POST handler, after validation and before the broadcast loop:
for (const event of body.events) {
  // Persist to audit log (non-blocking, buffered)
  logActivity({
    projectId: body.projectId,
    actorType: "agent",
    actorId: event.agentName ?? "unknown",
    action: event.type,               // tool_start, tool_end, error, etc.
    entityType: "tool",
    entityId: event.tool ?? undefined,
    details: {
      text: event.text,
      filePath: event.filePath,
      command: event.command,
      message: event.message,
      timestamp: event.timestamp,
    },
  })

  broadcastToProject(body.projectId, "agent_activity", event)
}
```

#### `packages/gateway/src/routes/internal/hook-events.ts` — Persist hook events

Add the same `logActivity()` call after the agent_status broadcast (line 298):

```typescript
import { logActivity } from "../../services/activity-log.js"

// After broadcastToProject(projectId, "agent_status", sseEvent) on line 298:
logActivity({
  projectId,
  actorType: "agent",
  actorId: body.agentId,
  action: body.eventType,
  entityType: body.toolName ? "tool" : "lifecycle",
  entityId: body.toolName ?? undefined,
  details: {
    status,
    toolInput: body.toolInput,
    error: body.error,
  },
})
```

#### `packages/gateway/src/routes/api/projects.ts` — Add activity query endpoint

```typescript
import { queryActivityLog } from "../../services/activity-log.js"

// GET /api/projects/:id/activity — query persisted activity
router.get("/api/projects/:id/activity", authMiddleware, async (c) => {
  const projectId = c.req.param("id")
  const limit = Number(c.req.query("limit") ?? 100)
  const before = c.req.query("before") ? new Date(c.req.query("before")!) : undefined
  const entityType = c.req.query("entityType") ?? undefined
  const actorId = c.req.query("actorId") ?? undefined

  const entries = await queryActivityLog(projectId, { limit, before, entityType, actorId })
  return c.json({ entries })
})
```

#### `packages/gateway/src/db/schema.ts` — Add Drizzle relations

```typescript
export const activityLogRelations = relations(activityLog, ({ one }) => ({
  project: one(projects, { fields: [activityLog.projectId], references: [projects.id] }),
}))
```

### Integration with Peon's flow

1. **Write path**: Agent activity events flow through two paths — `POST /internal/agent-activity` (from worker's `relayToolEvent`) and `POST /internal/hook-events` (from Claude Code hooks via `send_event.py`). Both paths call `logActivity()` which buffers entries and bulk-inserts every 2 seconds.
2. **Read path**: Frontend calls `GET /api/projects/:id/activity` to fetch historical activity. This powers a persistent timeline view that doesn't depend on SSE connection state.
3. **SSE unchanged**: The existing SSE broadcast (`broadcastToProject`) continues to work identically. The audit log is a side-effect, not a replacement.
4. **Retention**: A daily cron (or gateway startup interval) calls `pruneOldEntries()` to delete entries older than 30 days.

### Effort estimate

**5-6 hours** — migration, service with buffered writes, persisting in both agent-activity and hook-events routes, query endpoint, frontend integration (basic list view).

### Risks

- **Write volume**: Active agents generate ~1-5 events/second. Buffered batch inserts (50/batch or 2s interval) keep DB load manageable. If volume exceeds expectations, switch to a time-series approach or add partitioning on `created_at`.
- **JSONB details size**: Tool inputs (especially file contents from Read tool) can be large. Cap `details` stringified size at 10KB in `logActivity()` to prevent table bloat.
- **Index maintenance**: The `(project_id, created_at DESC)` index will grow linearly. The 30-day pruning keeps it bounded.

---

## 3. Cost Tracking

### Why it matters for Peon

Peon users bring their own Anthropic API keys with zero visibility into spend. There is no token counting, no per-project cost attribution, and no budget limits. A runaway agent can burn through an API key unchecked. Adding cost tracking gives users spend visibility per-project, enables budget caps that auto-pause agents, and provides the data needed for a billing/usage dashboard. Paperclip's `cost_events` table and per-agent budget enforcement is the reference implementation.

### Schema additions

New table and column additions in `packages/gateway/src/db/schema.ts`:

```typescript
export const costEvents = pgTable("cost_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
  costCents: integer("cost_cents").default(0).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export type CostEvent = typeof costEvents.$inferSelect
export type NewCostEvent = typeof costEvents.$inferInsert
```

Add budget fields to the existing `projects` table:

```typescript
// Add to the projects pgTable definition:
budgetMonthlyCents: integer("budget_monthly_cents"),
spentMonthlyCents: integer("spent_monthly_cents").default(0).notNull(),
```

### SQL migration

```sql
-- packages/gateway/drizzle/XXXX_cost_tracking.sql
CREATE TABLE "cost_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "cached_input_tokens" integer NOT NULL DEFAULT 0,
  "cost_cents" integer NOT NULL DEFAULT 0,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX "cost_events_project_occurred_idx" ON "cost_events" ("project_id", "occurred_at" DESC);

ALTER TABLE "projects" ADD COLUMN "budget_monthly_cents" integer;
ALTER TABLE "projects" ADD COLUMN "spent_monthly_cents" integer NOT NULL DEFAULT 0;
```

### Files to modify

#### `packages/gateway/src/services/cost-tracker.ts` — New service (create file)

```typescript
import { db } from "../db/connection.js"
import { costEvents, projects, type NewCostEvent } from "../db/schema.js"
import { eq, and, gte, sql, sum } from "drizzle-orm"
import { createLogger } from "@lobu/core"

const logger = createLogger("cost-tracker")

// Token-to-cost lookup (cents per 1M tokens) — update as pricing changes
const PRICING: Record<string, { input: number; output: number; cachedInput: number }> = {
  "claude-opus-4-6":              { input: 1500, output: 7500, cachedInput: 150 },
  "claude-sonnet-4-6":            { input: 300,  output: 1500, cachedInput: 30 },
  "claude-sonnet-4-5-20250929":   { input: 300,  output: 1500, cachedInput: 30 },
  "claude-haiku-4-5-20251001":    { input: 80,   output: 400,  cachedInput: 8 },
}

function calculateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
): number {
  const pricing = PRICING[model] ?? PRICING["claude-sonnet-4-5-20250929"]
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cachedInputTokens / 1_000_000) * pricing.cachedInput
  return Math.round(cost)
}

export interface UsageReport {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  costCents: number
  model: string
  provider: string
}

export async function recordUsage(
  projectId: string,
  agentId: string,
  usage: UsageReport
): Promise<{ budgetExceeded: boolean }> {
  const costCents = usage.costCents > 0
    ? usage.costCents
    : calculateCostCents(usage.model, usage.inputTokens, usage.outputTokens, usage.cachedInputTokens)

  // Insert cost event
  await db.insert(costEvents).values({
    projectId,
    agentId,
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    costCents,
    occurredAt: new Date(),
  })

  // Atomically increment project spend
  await db
    .update(projects)
    .set({
      spentMonthlyCents: sql`${projects.spentMonthlyCents} + ${costCents}`,
    })
    .where(eq(projects.id, projectId))

  // Check budget
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { budgetMonthlyCents: true, spentMonthlyCents: true },
  })

  const budgetExceeded = project?.budgetMonthlyCents != null &&
    (project.spentMonthlyCents ?? 0) >= project.budgetMonthlyCents

  if (budgetExceeded) {
    logger.warn(`Project ${projectId} exceeded monthly budget: spent=${project!.spentMonthlyCents} budget=${project!.budgetMonthlyCents}`)
  }

  return { budgetExceeded }
}

export async function getProjectCostSummary(projectId: string) {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const rows = await db
    .select({
      totalInputTokens: sum(costEvents.inputTokens).mapWith(Number),
      totalOutputTokens: sum(costEvents.outputTokens).mapWith(Number),
      totalCachedInputTokens: sum(costEvents.cachedInputTokens).mapWith(Number),
      totalCostCents: sum(costEvents.costCents).mapWith(Number),
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.projectId, projectId),
        gte(costEvents.occurredAt, startOfMonth)
      )
    )

  return rows[0] ?? { totalInputTokens: 0, totalOutputTokens: 0, totalCachedInputTokens: 0, totalCostCents: 0 }
}

export async function getProjectCostByAgent(projectId: string) {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  return db
    .select({
      agentId: costEvents.agentId,
      model: costEvents.model,
      totalInputTokens: sum(costEvents.inputTokens).mapWith(Number),
      totalOutputTokens: sum(costEvents.outputTokens).mapWith(Number),
      totalCostCents: sum(costEvents.costCents).mapWith(Number),
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.projectId, projectId),
        gte(costEvents.occurredAt, startOfMonth)
      )
    )
    .groupBy(costEvents.agentId, costEvents.model)
}

// Reset monthly spend counters on the 1st of each month
export async function resetMonthlySpend(): Promise<void> {
  await db.update(projects).set({ spentMonthlyCents: 0 })
  logger.info("Reset monthly spend counters for all projects")
}
```

#### `packages/gateway/src/routes/internal/agent-activity.ts` — Extract usage from turn_end events

The worker's `processOpenClawEvent` handler receives `turn_end` events that carry `usage` data from the OpenClaw chat final event. We need to relay this to the gateway.

```typescript
// In the POST handler, after persisting to audit log:
for (const event of body.events) {
  // Extract cost data from turn_end events
  if (event.type === "turn_end" && event.usage) {
    const { recordUsage } = await import("../../services/cost-tracker.js")
    const usage = event.usage as {
      inputTokens?: number
      outputTokens?: number
      cachedInputTokens?: number
      costUsd?: number
      model?: string
      provider?: string
    }
    const result = await recordUsage(body.projectId, event.agentName ?? "unknown", {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      costCents: usage.costUsd ? Math.round(usage.costUsd * 100) : 0,
      model: usage.model ?? "unknown",
      provider: usage.provider ?? "anthropic",
    })

    if (result.budgetExceeded) {
      broadcastToProject(body.projectId, "budget_exceeded", {
        projectId: body.projectId,
        timestamp: Date.now(),
      })
    }
  }

  broadcastToProject(body.projectId, "agent_activity", event)
}
```

#### `packages/worker/src/openclaw/worker.ts` — Relay usage data from chat final

In `processOpenClawEvent`, the `turn_end` case (line 687-692) needs to extract usage from the OpenClaw `chat final` event and include it in the relayed activity event:

```typescript
case "turn_end":
  logger.info("OpenClaw turn completed");
  if (event.contentBlocks) {
    this.workerTransport.setContentBlocks(event.contentBlocks);
  }
  // Relay turn_end with usage data to gateway for cost tracking
  this.relayToolEvent({
    type: "turn_end",
    timestamp: Date.now(),
    // usage is extracted from the chat final event in parseChatEvent
    // and attached to the turn_end OpenClawEvent
  });
  break;
```

The `parseChatEvent` method in `openclaw-ws-client.ts` already logs usage data (line 514-517). Extend the `turn_end` event type to carry it:

```typescript
// In OpenClawEvent union type, update turn_end:
| { type: "turn_end"; contentBlocks?: unknown[]; usage?: Record<string, unknown> }

// In parseChatEvent, the "final" state handler:
const usage = (data.usage ?? msg?.usage) as Record<string, unknown> | undefined;
events.push({ type: "turn_end", contentBlocks, usage });
```

#### `packages/gateway/src/routes/api/projects.ts` — Cost summary endpoints

```typescript
import { getProjectCostSummary, getProjectCostByAgent } from "../../services/cost-tracker.js"

// GET /api/projects/:id/costs — project cost summary
router.get("/api/projects/:id/costs", authMiddleware, async (c) => {
  const projectId = c.req.param("id")
  const summary = await getProjectCostSummary(projectId)
  return c.json(summary)
})

// GET /api/projects/:id/costs/agents — per-agent breakdown
router.get("/api/projects/:id/costs/agents", authMiddleware, async (c) => {
  const projectId = c.req.param("id")
  const breakdown = await getProjectCostByAgent(projectId)
  return c.json({ agents: breakdown })
})

// PATCH /api/projects/:id — extend to accept budgetMonthlyCents
// (already exists, just add to the allowed update fields)
```

#### `packages/gateway/src/routes/internal/agent-activity.ts` — Extend event type

```typescript
export interface AgentActivityEvent {
  type: AgentActivityEventType
  tool?: string
  text?: string
  message?: string
  agentName?: string
  filePath?: string
  command?: string
  timestamp: number
  usage?: Record<string, unknown>  // NEW: token usage from turn_end
}
```

### Integration with Peon's flow

1. **Data source**: OpenClaw's chat `final` WebSocket event includes `usage` (inputTokens, outputTokens) and `total_cost_usd`. The worker's `parseChatEvent` extracts this and attaches it to the `turn_end` event.
2. **Worker → Gateway**: `relayToolEvent` POSTs the `turn_end` event with usage data to `/internal/agent-activity`.
3. **Gateway recording**: `agent-activity.ts` handler detects `turn_end` events with usage data and calls `recordUsage()`, which inserts a `cost_events` row and atomically increments `projects.spentMonthlyCents`.
4. **Budget enforcement**: If `spentMonthlyCents >= budgetMonthlyCents`, the gateway broadcasts a `budget_exceeded` SSE event. The frontend can show a warning banner. Optionally, the gateway can refuse to dispatch new BullMQ jobs for over-budget projects.
5. **Monthly reset**: A cron job (or `setInterval` in gateway) calls `resetMonthlySpend()` on the 1st of each month.

### Effort estimate

**8-10 hours** — migration, cost service with pricing table, usage extraction from OpenClaw WS events, worker relay changes, two API endpoints, budget check logic, monthly reset cron, frontend cost display widget.

### Risks

- **Pricing accuracy**: Token-to-cost conversion uses hardcoded pricing that may drift from Anthropic's actual rates. Mitigation: prefer `total_cost_usd` from Claude output when available; fall back to calculated cost.
- **Usage data availability**: The `usage` field in OpenClaw's chat final event must be present. If OpenClaw changes its event format, the worker won't have usage data. Mitigation: gracefully handle missing usage (skip cost recording, log warning).
- **Atomicity of spend increment**: The `spentMonthlyCents` increment uses `SET spent = spent + N` which is atomic in Postgres. Under extreme concurrency (many agents completing simultaneously), this is safe.
- **No retroactive tracking**: Cost events only start recording after this feature ships. Historical usage is unknown.

---

## 4. Session Persistence

### Why it matters for Peon

When a worker container restarts (due to crash, deployment, or user restart), the OpenClaw session context is lost. The agent starts fresh with workspace files intact but no conversational memory of what it was working on. Paperclip solves this with `agent_task_sessions` — a per-task record of session parameters that enables deterministic `--resume` on the next run. For Peon, this means agents can pick up exactly where they left off on a specific task, preserving multi-turn reasoning context across container restarts.

### Schema additions

New table in `packages/gateway/src/db/schema.ts`:

```typescript
export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  sessionKey: text("session_key").notNull(),
  openclawSessionId: text("openclaw_session_id"),
  workingDirectory: text("working_directory"),
  lastTaskId: text("last_task_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type AgentSession = typeof agentSessions.$inferSelect
export type NewAgentSession = typeof agentSessions.$inferInsert
```

### SQL migration

```sql
-- packages/gateway/drizzle/XXXX_agent_sessions.sql
CREATE TABLE "agent_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "agent_id" text NOT NULL,
  "session_key" text NOT NULL,
  "openclaw_session_id" text,
  "working_directory" text,
  "last_task_id" text,
  "metadata" jsonb,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "agent_sessions_project_agent_key_idx" ON "agent_sessions" ("project_id", "agent_id", "session_key");
CREATE INDEX "agent_sessions_project_updated_idx" ON "agent_sessions" ("project_id", "updated_at" DESC);
```

### Files to modify

#### `packages/gateway/src/services/session-persistence.ts` — New service (create file)

```typescript
import { db } from "../db/connection.js"
import { agentSessions, type NewAgentSession } from "../db/schema.js"
import { eq, and } from "drizzle-orm"
import { createLogger } from "@lobu/core"

const logger = createLogger("session-persistence")

export async function saveSession(session: {
  projectId: string
  agentId: string
  sessionKey: string
  openclawSessionId?: string
  workingDirectory?: string
  lastTaskId?: string
  metadata?: Record<string, unknown>
  lastError?: string
}): Promise<void> {
  await db
    .insert(agentSessions)
    .values({
      projectId: session.projectId,
      agentId: session.agentId,
      sessionKey: session.sessionKey,
      openclawSessionId: session.openclawSessionId,
      workingDirectory: session.workingDirectory,
      lastTaskId: session.lastTaskId,
      metadata: session.metadata,
      lastError: session.lastError,
    })
    .onConflictDoUpdate({
      target: [agentSessions.projectId, agentSessions.agentId, agentSessions.sessionKey],
      set: {
        openclawSessionId: session.openclawSessionId,
        workingDirectory: session.workingDirectory,
        lastTaskId: session.lastTaskId,
        metadata: session.metadata,
        lastError: session.lastError,
        updatedAt: new Date(),
      },
    })

  logger.debug(`Saved session for agent=${session.agentId} project=${session.projectId}`)
}

export async function getSession(
  projectId: string,
  agentId: string,
  sessionKey: string
): Promise<{ openclawSessionId: string | null; workingDirectory: string | null; lastTaskId: string | null; metadata: Record<string, unknown> | null } | null> {
  const row = await db.query.agentSessions.findFirst({
    where: and(
      eq(agentSessions.projectId, projectId),
      eq(agentSessions.agentId, agentId),
      eq(agentSessions.sessionKey, sessionKey)
    ),
  })
  if (!row) return null
  return {
    openclawSessionId: row.openclawSessionId,
    workingDirectory: row.workingDirectory,
    lastTaskId: row.lastTaskId,
    metadata: row.metadata,
  }
}

export async function clearSession(
  projectId: string,
  agentId: string,
  sessionKey: string
): Promise<void> {
  await db
    .delete(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.agentId, agentId),
        eq(agentSessions.sessionKey, sessionKey)
      )
    )
}
```

#### `packages/gateway/src/routes/internal/agent-activity.ts` — Session save endpoint

Add a new route for workers to report their session ID after a successful run:

```typescript
// POST /internal/sessions — save session state
router.post("/internal/sessions", async (c) => {
  const body = await c.req.json<{
    projectId: string
    agentId: string
    sessionKey: string
    openclawSessionId?: string
    workingDirectory?: string
    lastTaskId?: string
    metadata?: Record<string, unknown>
    lastError?: string
  }>().catch(() => null)

  if (!body?.projectId || !body.agentId || !body.sessionKey) {
    return c.json({ error: "projectId, agentId, and sessionKey required" }, 400)
  }

  await saveSession(body)
  return c.json({ ok: true })
})

// GET /internal/sessions — retrieve session for resumption
router.get("/internal/sessions", async (c) => {
  const projectId = c.req.query("projectId")
  const agentId = c.req.query("agentId")
  const sessionKey = c.req.query("sessionKey")

  if (!projectId || !agentId || !sessionKey) {
    return c.json({ error: "projectId, agentId, and sessionKey required" }, 400)
  }

  const session = await getSession(projectId, agentId, sessionKey)
  return c.json({ session })
})
```

#### `packages/worker/src/openclaw/worker.ts` — Save session after run, resume on start

**Before the AI session starts** (in `runAISession`, around line 310):

```typescript
// Check for existing session to resume
const meta = this.config.platformMetadata as Record<string, unknown> | undefined
const projectId = meta?.projectId as string
const openclawAgentId = meta?.openclawAgentId as string
const sessionKey = `agent:${openclawAgentId}:peon:${this.config.conversationId}`

let resumeSessionId: string | undefined
try {
  const resp = await fetch(
    `${gatewayUrl}/internal/sessions?projectId=${projectId}&agentId=${openclawAgentId}&sessionKey=${encodeURIComponent(sessionKey)}`,
    { headers: { Authorization: `Bearer ${workerToken}` } }
  )
  if (resp.ok) {
    const data = await resp.json() as { session?: { openclawSessionId?: string } }
    if (data.session?.openclawSessionId) {
      resumeSessionId = data.session.openclawSessionId
      logger.info(`Found resumable session: ${resumeSessionId}`)
    }
  }
} catch (err) {
  logger.warn("Failed to fetch session for resumption:", err)
}
```

**After the AI session completes successfully** (after the event loop, around line 605):

```typescript
// Save session ID for future resumption
// The OpenClaw chat final event carries the session ID in the result
try {
  await fetch(`${gatewayUrl}/internal/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify({
      projectId,
      agentId: openclawAgentId,
      sessionKey,
      openclawSessionId: /* extracted from chat final event */ undefined,
      workingDirectory: workspaceDir,
    }),
  })
} catch (err) {
  logger.warn("Failed to save session state:", err)
}
```

#### `packages/worker/src/openclaw/openclaw-ws-client.ts` — Extract session ID from events

The OpenClaw WebSocket `chat final` event may carry a session ID. We need to extract it:

```typescript
// In parseChatEvent, "final" state handler, extract sessionId:
private parseChatEvent(data: Record<string, unknown>): OpenClawEvent[] {
  // ... existing code ...
  if (state === "final") {
    const sessionId = data.sessionId as string | undefined
    // Include sessionId in turn_end event
    events.push({ type: "turn_end", contentBlocks, usage, sessionId })
    return events
  }
}

// Update OpenClawEvent type:
| { type: "turn_end"; contentBlocks?: unknown[]; usage?: Record<string, unknown>; sessionId?: string }
```

Then in `processOpenClawEvent`, capture the session ID:

```typescript
case "turn_end":
  logger.info("OpenClaw turn completed");
  if (event.contentBlocks) {
    this.workerTransport.setContentBlocks(event.contentBlocks);
  }
  // Store session ID for persistence
  if (event.sessionId) {
    this.lastSessionId = event.sessionId;
  }
  break;
```

#### `packages/worker/src/openclaw/openclaw-ws-client.ts` — Pass resume session to sendMessage

```typescript
interface SendMessageParams {
  message: string
  sessionKey: string
  thinking?: string
  resumeSessionId?: string  // NEW
}

// In sendMessage, include resume params:
const reqParams: Record<string, unknown> = {
  message: params.message,
  sessionKey: params.sessionKey,
  idempotencyKey: crypto.randomUUID(),
}
if (params.thinking) reqParams.thinking = params.thinking
if (params.resumeSessionId) reqParams.resumeSessionId = params.resumeSessionId
```

### Integration with Peon's flow

1. **Session save**: After each successful OpenClaw turn, the worker extracts the session ID from the `chat final` event and POSTs it to `POST /internal/sessions`. The gateway upserts it into `agent_sessions` keyed by `(projectId, agentId, sessionKey)`.
2. **Session resume**: On the next message dispatch (via BullMQ → worker), the worker calls `GET /internal/sessions` before starting the OpenClaw WebSocket session. If a session exists, it passes `resumeSessionId` to the `chat.send` WebSocket request, which tells OpenClaw to resume the conversation context.
3. **Session invalidation**: If an OpenClaw session resume fails (unknown session error), the worker clears the session record and retries with a fresh session — same pattern as Paperclip's claude-local adapter.
4. **Container restart**: Docker volumes preserve workspace files. The session ID in Postgres survives container destruction. On restart, the worker resumes the exact conversation context.

### Effort estimate

**8-10 hours** — migration, session persistence service, session save/retrieve endpoints, worker integration (save after run, retrieve before run), OpenClaw WS client changes (extract session ID, pass resume param), error handling for stale sessions, manual testing with container restarts.

### Risks

- **OpenClaw session ID availability**: The `chat final` WebSocket event may not include a `sessionId` field. Need to verify the OpenClaw WebSocket protocol. If not available, fall back to parsing session files from `~/.openclaw/` in the container filesystem.
- **Session staleness**: If the OpenClaw gateway is restarted, stored session IDs may become invalid. The retry-with-fresh-session pattern handles this, but there's one wasted turn.
- **Session key format**: The `sessionKey` (`agent:<id>:peon:<conversationId>`) must be stable across restarts. Since `openclawAgentId` and `conversationId` are both derived from project/user config, this holds.
- **Multiple agents per project**: Each agent gets its own session row (keyed by `agentId`). The lead agent and each teammate have independent session persistence. This scales correctly with Peon's team model.

---

## Summary

| Feature | New Tables | Modified Files | Effort | Dependencies |
|---------|-----------|----------------|--------|-------------|
| 1. Task Checkout Locking | — (3 columns on `tasks`) | `schema.ts`, `task-sync.ts`, `tasks.ts`, `index.ts` | 6-8h | None |
| 2. Audit Log | `activity_log` | `schema.ts`, new `activity-log.ts` service, `agent-activity.ts`, `hook-events.ts`, `projects.ts` | 5-6h | None |
| 3. Cost Tracking | `cost_events` + 2 columns on `projects` | `schema.ts`, new `cost-tracker.ts` service, `agent-activity.ts`, `worker.ts`, `openclaw-ws-client.ts`, `projects.ts` | 8-10h | Feature 2 (audit log provides the persistence pattern) |
| 4. Session Persistence | `agent_sessions` | `schema.ts`, new `session-persistence.ts` service, `agent-activity.ts` (or new routes file), `worker.ts`, `openclaw-ws-client.ts` | 8-10h | None |

**Recommended build order**: 2 → 1 → 3 → 4

- Audit log (2) first — establishes the persistence pattern and gives immediate observability value
- Task locking (1) second — standalone, no dependencies, high impact for multi-agent reliability
- Cost tracking (3) third — depends on understanding the audit log write pattern, reuses the same gateway interception points
- Session persistence (4) last — requires the most integration work with the OpenClaw WS protocol and needs thorough testing with container restarts
