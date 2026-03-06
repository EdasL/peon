# Paperclip vs Peon — Technical Comparison

> Deep-dive engineering comparison between [Peon](https://github.com/edaslakavicius/peon) and [Paperclip](https://github.com/paperclipai/paperclip) (5.7k stars, MIT license, 536 commits).

## TL;DR

Peon is a **project-scoped agent runtime** — it spawns Docker containers, manages Claude Code sessions, and streams real-time activity to a React frontend. Paperclip is a **company-level control plane** — it sits above agents and provides org structure, budgets, approval gates, and audit trails. Paperclip explicitly does not run agents; it orchestrates them through adapters. Peon explicitly runs agents inside Docker containers.

They solve different layers of the same problem. The interesting gaps are where Paperclip has mature systems that Peon lacks entirely: cost tracking, approval gates, audit logging, session persistence, and task atomicity.

---

## 1. Architecture

### Peon

Monorepo with npm workspaces, Bun runtime for backend, Vite for frontend.

```
packages/
  core/      — Shared: logger, Redis, OpenTelemetry, encryption, AsyncLock
  gateway/   — Hono HTTP server (:8080), Drizzle ORM, Docker orchestration, BullMQ
  worker/    — AI agent runtime in Docker containers, OpenClaw integration
  web/       — React 19 SPA (Tailwind v4, shadcn/ui, React Router v7)
```

**Request flow:** Browser → Vite proxy → Gateway → Postgres/Redis/Docker → Worker containers → SSE back to gateway → SSE to browser.

**Key design:** One container per user (shared across projects). Gateway manages container lifecycle via Docker socket. Worker connects back to gateway via SSE for job dispatch and HTTP POST for activity relay. Real-time via Redis pub/sub → SSE fan-out.

**Schema:** 7 tables (`users`, `projects`, `apiKeys`, `chatMessages`, `tasks`, `teams`, `teamMembers`) in `packages/gateway/src/db/schema.ts`.

### Paperclip

Monorepo with pnpm workspaces, Node.js 20+ runtime.

```
packages/
  db/              — Drizzle ORM schema (34+ tables), migrations
  adapter-utils/   — Shared adapter interfaces
  adapters/        — 7 adapter packages (claude-local, codex-local, cursor-local, openclaw, opencode-local, process, http)
server/            — Hono REST API, services (22+ files), auth, realtime
cli/               — CLI tool (onboard, doctor, run, configure)
ui/                — React + Vite frontend
```

**Request flow:** UI/CLI → Hono REST API → PostgreSQL (PGlite for dev, external for prod) → Heartbeat scheduler → Adapter → External agent process/HTTP.

**Key design:** Multi-tenant "company" isolation. No containers — agents are external processes invoked via adapters. In-process EventEmitter for real-time (no Redis). Heartbeat-based scheduling controls when agents run.

**Schema:** 34+ tables across 26 migrations. Core tables: `companies`, `agents`, `issues`, `goals`, `projects`, `approvals`, `cost_events`, `activity_log`, `heartbeat_runs`, `agent_runtime_state`, `agent_task_sessions`, plus many more.

### Key Architectural Differences

| Dimension | Peon | Paperclip |
|-----------|------|-----------|
| Runtime model | Runs agents in Docker containers | Invokes agents via adapters (no containers) |
| Multi-tenancy | Per-user containers, per-project isolation | Multi-company, data-isolated at company level |
| Real-time | Redis pub/sub → SSE | In-process EventEmitter |
| Job queue | BullMQ (Redis) | Heartbeat scheduler (DB-driven) |
| DB complexity | 7 tables | 34+ tables |
| Agent identity | OpenClaw session (peonAgentId) | Agent row in DB with org position |

---

## 2. Session Persistence

### Peon

Agent state lives in three places:

1. **Redis sessions** (`packages/gateway/src/services/session-manager.ts`): `ThreadSession` objects stored with 24h TTL. Key: `session:<peonAgentId>`. Contains `conversationId`, `channelId`, `userId`, `status`, `provider`. If TTL expires, gateway recreates on next API call.

2. **Docker volumes**: `/workspace/projects/<id>/` persists across container restarts. Contains cloned repos, `CLAUDE.md`, and Claude Code working state.

3. **Postgres**: Chat history (`chatMessages`), tasks, team config all survive container destruction.

**Restart flow** (`packages/gateway/src/routes/api/projects.ts:280-333`): On restart, gateway sets status to "creating", restarts container (or re-provisions if removed), and polls for readiness. Workspace directory is preserved on mounted volumes so agent context survives.

**Gap:** No per-task session tracking. If an agent was mid-task when the container died, there's no mechanism to resume that specific task's context. The agent starts fresh with access to the workspace files but loses conversational context.

### Paperclip

Three-tier persistence model:

1. **`agent_runtime_state` table** (one row per agent): Stores current `sessionId`, arbitrary `stateJson`, `lastRunId`, `lastRunStatus`, and accumulated token/cost totals. This is the global agent state across all runs.

2. **`agent_task_sessions` table**: Per-task session data, unique on `(companyId, agentId, adapterType, taskKey)`. Stores `sessionParams` as JSONB. Allows resuming work on a specific task with exact session parameters from the previous run.

3. **`AdapterSessionCodec` interface** (`packages/adapter-utils/src/types.ts`): Each adapter defines custom serialization/deserialization. The Claude adapter uses this to pass `--resume` with the session ID when the working directory matches.

**Run tracking:** `heartbeat_runs` records `sessionIdBefore` and `sessionIdAfter` to document state transitions across execution boundaries.

### What Peon Should Consider

Peon has no equivalent to `agent_task_sessions`. When a worker container restarts, OpenClaw sessions may or may not resume depending on Claude Code's internal state. There's no DB record mapping "agent X was working on task Y with session Z." Adding a `agent_task_sessions` equivalent would enable deterministic session resumption.

**Concrete gap in Peon:**
- `packages/gateway/src/db/schema.ts` — No session tracking table
- `packages/worker/src/` — No session ID persistence across runs
- `packages/gateway/src/services/session-manager.ts` — Redis TTL is the only session lifecycle; no per-task granularity

---

## 3. Budget/Cost Tracking

### Peon

**Not implemented.** Search across all packages for `cost`, `budget`, `token`, `usage`, `billing` yields zero functional code. No database tables, no middleware, no token counting. Users have effectively unlimited budget.

**Relevant files that would need changes:**
- `packages/gateway/src/db/schema.ts` — Needs cost/budget tables
- `packages/gateway/src/routes/internal/agent-activity.ts` — Could intercept token usage from agent activity events
- `packages/worker/src/` — Would need to report usage back to gateway

### Paperclip

First-class budget system with three layers:

**Schema:**
- `cost_events` table: `companyId`, `agentId`, `issueId`, `projectId`, `goalId`, `provider`, `model`, `inputTokens`, `outputTokens`, `costCents`, `billingCode`, `occurredAt`
- `agents` table: `budgetMonthlyCents`, `spentMonthlyCents` fields
- `companies` table: `budgetMonthlyCents`, `spentMonthlyCents` fields
- `agent_runtime_state`: `totalInputTokens`, `totalOutputTokens`, `totalCachedInputTokens`, `totalCostCents`

**Service** (`server/src/services/costs.ts`):
- `createEvent()` — Inserts cost event, atomically increments agent's `spentMonthlyCents`, **auto-pauses agent when budget exceeded**
- `summary()` — Company-level aggregation with date range filtering
- `byAgent()` — Per-agent breakdown with token counts
- `byProject()` — Project-level cost attribution via issue joins

**Adapter reporting:** Every `AdapterExecutionResult` includes `usage` (inputTokens, outputTokens, cachedInputTokens), `costUsd`, `billingType` ("api" | "subscription" | "unknown"), `provider`, `model`.

**Cross-team cost attribution:** Issues carry a `billingCode` field. When Agent A delegates to Agent B, B's costs track against A's billing code. `requestDepth` tracks delegation hops.

**Three control tiers:**
1. **Visibility** — Dashboards at every level (agent, task, project, company)
2. **Soft alerts** — Configurable threshold warnings (e.g., 80% of budget)
3. **Hard ceiling** — Auto-pause agent, notify Board, Board can override

### Gap Analysis for Peon

This is the largest functional gap. Peon users bring their own API keys and have zero visibility into spend. Minimum viable implementation would need:
1. A `cost_events` table in `packages/gateway/src/db/schema.ts`
2. Token usage extraction from OpenClaw activity events in `packages/gateway/src/routes/internal/agent-activity.ts`
3. Per-project spend aggregation in a new service
4. Budget limit enforcement in the worker job dispatch path

---

## 4. Task Atomicity

### Peon

**Optimistic, last-write-wins.** Tasks use Postgres `INSERT ... ON CONFLICT(id) DO UPDATE` for upserts (`packages/gateway/src/web/task-sync.ts:19-76`).

- `tasks.owner` field is advisory — agents claim tasks by setting `owner = agentName`
- No lock field, no checkout mechanism, no lock timeout
- Multiple agents can update the same task concurrently; last write wins
- Coordination relies on **agent discipline** via system prompts (`packages/gateway/src/web/config-bridge.ts:195-198`): "Each teammate owns their scope — do not duplicate their work"

**AsyncLock** (`packages/core/src/utils/lock.ts:20-69`) exists but is process-local (in-memory Promise chain). Used for SSE stream delta accumulation, not task-level locking.

### Paperclip

**Single-assignment with atomic checkout.** Issues have dedicated lock fields:
- `executionRunId` — Which run holds the lock
- `executionLockedAt` — When the lock was acquired
- `executionAgentNameKey` — Which agent holds the lock

**Service** (`server/src/services/issues.ts`):
- `checkout()` — Atomically sets lock fields. If another agent holds the lock, request fails with the lock holder's identity
- `assertCheckoutOwner()` — Validates lock ownership before modifications
- `release()` — Clears the lock
- `staleCount()` — Monitors long-running in-progress tasks

**Crash recovery:** Intentionally manual. Paperclip surfaces stale tasks on dashboards but does NOT auto-reassign. The spec says: "Paperclip reports problems, it doesn't silently fix them."

**Wakeup coalescing:** `agent_wakeup_requests` has `idempotencyKey` and `coalescedCount` to prevent duplicate wakeups.

### Gap Analysis for Peon

Peon's task system works because agents are cooperative (they follow system prompt instructions). But there's no protection against:
- Two agents updating the same task simultaneously
- An agent crashing mid-task with no one knowing it held the task
- Stale in-progress tasks with no timeout detection

**Minimum fix:** Add `lockedBy` and `lockedAt` fields to `packages/gateway/src/db/schema.ts` tasks table, with a checkout/release API in `packages/gateway/src/web/chat-routes.ts`.

---

## 5. Audit Logging

### Peon

**Minimal and mostly ephemeral.**

What IS persisted (Postgres):
- Chat messages (`chatMessages` table) — immutable, no TTL
- Task current state (`tasks` table) — only latest values, no change history
- Project status (`projects.status`) — only current state

What IS NOT persisted:
- Agent activity events (SSE only, lost on gateway restart) — `packages/gateway/src/routes/internal/agent-activity.ts`
- Hook events (SSE only) — `packages/gateway/src/routes/internal/hook-events.ts`
- Boot progress (SSE only)
- User login/logout, API key changes, project creation/deletion
- Task change history (who changed what, when)
- Error history, cost data

### Paperclip

**Comprehensive multi-layer audit system.**

1. **`activity_log` table** (`server/src/services/activity-log.ts`): Records `actorType`, `actorId`, `action`, `entityType`, `entityId`, `details` (JSONB). Three indexes: `(companyId, createdAt)`, `(runId)`, `(entityType, entityId)`. Simultaneously publishes live events for real-time UI.

2. **`agent_config_revisions` table**: Full before/after snapshots for every config change. Stores `changedKeys`, `beforeConfig`, `afterConfig`, supports rollback via `rolledBackFromRevisionId`.

3. **`heartbeat_runs` + `heartbeat_run_events`**: Complete execution logs with stdout/stderr excerpts, exit codes, signals, errors, token usage, `contextSnapshot` JSONB.

4. **`run-log-store`** (`server/src/services/run-log-store.ts`): NDJSON file-based storage with SHA256 checksums, byte counts, optional compression. Organized by `companyId/agentId/runId`.

5. **`cost_events`**: Every token expenditure as a discrete event.

6. **`issue_comments`** + **`approval_comments`**: Full discussion trails.

### Gap Analysis for Peon

Peon's biggest observability gap. Agent activity events are fire-and-forget via SSE. If the browser isn't connected, events are lost. There's no way to answer "what did agent X do yesterday?" or "what changed in project Y between T1 and T2?"

**Minimum fix:**
1. Add an `activity_log` table to `packages/gateway/src/db/schema.ts`
2. Persist agent activity events in `packages/gateway/src/routes/internal/agent-activity.ts` before broadcasting via SSE
3. Add task change history (before/after values on update)

---

## 6. Goal/Context Hierarchy

### Peon

**Flat, project-scoped context.** The hierarchy is:

```
User → Project → Tasks (flat list with owner)
                → Team (flat list of members)
                → Chat (linear message history)
```

Context flows to agents via:
1. `CLAUDE.md` written to workspace (`packages/gateway/src/web/project-launcher.ts:146-198`) — includes project ID, template, repo URL, team specs
2. `SOUL.md` per agent (`~/.openclaw/agents/project-<id>/agent/SOUL.md`) — system prompt
3. System messages in chat — enqueued via BullMQ, delivered to worker via SSE
4. `/public/session-context` endpoint — returns instructions + config for agent

No goal hierarchy. No initiative → project → milestone → issue tree. Tasks are a flat list with `boardColumn` for kanban position and `owner` for agent assignment.

### Paperclip

**Deep hierarchical goal tree:**

```
Company → Initiative (goal, level="initiative")
  → Project (goal + project row)
    → Milestone (goal, level="milestone")
      → Issue (assignable, lockable, budget-tracked)
        → Sub-issue (self-referential parentId)
```

Context delivery is configurable per agent:
- **Fat payload** — Paperclip bundles relevant context into the heartbeat invocation
- **Thin ping** — Just a wake-up signal; agent calls API for context

Key functions:
- `getAncestors()` in issue service — walks parent chain with batch-loaded projects/goals
- `getChainOfCommand()` in agent service — builds management hierarchy
- `orgForCompany()` — complete org tree structure
- `contextSnapshot` JSONB on `heartbeat_runs` — captures execution context at run time

### Gap Analysis for Peon

Peon's flat task list works for small projects but doesn't scale to complex, multi-agent work with dependencies. There's no way to express "this task blocks that task" or "these tasks all serve this milestone."

**Concrete gaps:**
- `packages/gateway/src/db/schema.ts` tasks table — No `parentId`, no `goalId`, no `priority`, no `blockedBy`
- `tasks.metadata` JSONB has placeholder for `blockedBy` but it's not enforced or queryable

---

## 7. Approval Gates

### Peon

**Not implemented.** No approval system. No human-in-the-loop checkpoints. Agents operate autonomously within their system prompt constraints. Search for "approval", "approve", "confirm", "review", "gate" yields zero functional code.

### Paperclip

**Full state machine** with `approvals` table:

```
pending → approved | rejected | revision_requested
revision_requested → pending (via resubmit)
```

**Service** (`server/src/services/approvals.ts`):
- `create()` — Creates pending approval with arbitrary `type` and `payload` (JSONB)
- `approve()` — For `hire_agent` type: activates pending agent or creates new agent from payload
- `reject()` — For `hire_agent` type: terminates pending agent
- `requestRevision()` — Sends back for revision
- `resubmit()` — Agent resubmits with updated payload
- `listComments()` / `addComment()` — Threaded discussion

**Company-level control:** `companies.requireBoardApprovalForNewAgents` defaults `true`.

**Board powers:** Unrestricted — set/modify budgets, pause/resume agents, override decisions, full project management access.

### Gap Analysis for Peon

No approval gates means no guardrails for high-risk agent actions. Peon relies entirely on Claude Code's built-in permission system (tool approval prompts). There's no Peon-level checkpoint for actions like "deploy to production" or "create a PR."

---

## 8. Agent Adapters

### Peon

**Single adapter: OpenClaw (Claude Code).** Tightly coupled.

- Worker spawns OpenClaw sessions via WebSocket (`packages/worker/src/`)
- Agent config written to `~/.openclaw/` in container
- Model selection via `packages/worker/src/` model resolver
- No adapter interface — OpenClaw is hardcoded throughout the worker

**Supported providers:** Whatever OpenClaw supports (Claude via Anthropic API, potentially others via OpenClaw's provider config). But the orchestration layer is Claude-only.

### Paperclip

**Plugin architecture with 7 built-in adapters.**

Core interface (`packages/adapter-utils/src/types.ts`):
```typescript
interface ServerAdapterModule {
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult>;
  sessionCodec?: AdapterSessionCodec;
  supportsLocalAgentJwt?: boolean;
  models?: AdapterModel[];
  listModels?: () => Promise<AdapterModel[]>;
  onHireApproved?: (payload, adapterConfig) => Promise<HireApprovedHookResult>;
}
```

| Adapter | Transport | Description |
|---------|-----------|-------------|
| `claude-local` | Child process (claude CLI) | Claude Code with session resumption |
| `codex-local` | Child process | OpenAI Codex |
| `cursor-local` | Child process | Cursor |
| `opencode-local` | Child process | OpenCode |
| `openclaw` | SSE/Webhook HTTP | OpenClaw |
| `process` | Generic child process | Any CLI tool |
| `http` | Generic HTTP endpoint | Any HTTP API |

**Registry:** `server/src/adapters/registry.ts` — Map-based lookup. Each adapter exports execution logic, output parsing, environment testing, CLI formatting, and UI config form builder.

**Minimum adapter contract:** "Be callable. That's it." Three progressive integration levels: callable → status reporting → fully instrumented.

### Gap Analysis for Peon

Peon is locked to OpenClaw/Claude Code. Supporting other agents (Codex, Cursor, custom LLMs) would require extracting an adapter interface from the worker code. The worker's `packages/worker/src/` mixes OpenClaw-specific logic with general orchestration.

---

## 9. GitHub Integration

### Peon

**Built-in repo cloning and workspace management.**

- `projects.repoUrl` and `projects.repoBranch` in schema
- `users.githubAccessToken` — OAuth token used to auth `gh` CLI in worker
- Worker clones repo to `/workspace/projects/<id>/repo/` during initialization
- GitHub OAuth for user auth (`packages/gateway/src/routes/public/`)
- No PR creation from Peon itself — agents create PRs via Claude Code's git tools

### Paperclip

**Explicitly hands-off.** From the spec: "Paperclip does not manage work artifacts — code repos, file systems, deployments, documents."

- `project_workspaces` table stores `repoUrl`, `repoRef`, `cwd`, `isPrimary`
- Heartbeat service resolves execution directory from workspace config
- All actual git operations are performed by agents through their adapters
- No GitHub OAuth, no repo cloning, no `gh` CLI integration

### Comparison

Peon has stronger GitHub integration — it handles OAuth, repo cloning, and provides `githubAccessToken` to workers. Paperclip delegates all git operations to agents and only tracks workspace metadata.

---

## 10. What Peon Has That Paperclip Doesn't

| Feature | Peon Implementation | Paperclip Equivalent |
|---------|-------------------|---------------------|
| **Docker container runtime** | Per-user containers with network isolation (`peon-internal` network), HTTP proxy for internet access | No runtime — adapters invoke external processes |
| **Real-time agent activity streaming** | SSE with tool_start/tool_end/thinking/error events, 10s TTL auto-clear on agent cards | Event log, but no live tool-level streaming |
| **Chat-first interface** | Slack-style chat panel with avatar bubbles, streaming deltas | Task-comment-based communication |
| **GitHub OAuth + repo cloning** | Built-in OAuth flow, automatic repo cloning to workspace | Workspace metadata only, no git operations |
| **Team agent spawning** | Automatic tmux session creation per team member in container | Agents are standalone entities, not spawned per-team |
| **Boot progress visualization** | Multi-step progress indicator (container → workspace → engine → ready) | No equivalent |
| **Network isolation** | Docker networks with internet-only-via-proxy for workers | No network isolation (agents run locally) |
| **BullMQ job queue** | Reliable message delivery with retries | Heartbeat scheduler (simpler, DB-driven) |

---

## 11. What Paperclip Has That Peon Should Consider Adopting

### Priority 1: High Impact, Addresses Real Gaps

**1. Cost Tracking (`cost_events` table + budget enforcement)**
- Peon users bring their own API keys with zero spend visibility
- Paperclip's per-event cost recording with agent/project/company budget limits and auto-pause is the gold standard
- Start with: token usage extraction from agent activity events, per-project aggregation

**2. Audit Logging (`activity_log` table)**
- Peon's agent activity is ephemeral (SSE only)
- Paperclip persists every action with actor, entity, and JSONB details
- Start with: persisting agent activity events before SSE broadcast in `packages/gateway/src/routes/internal/agent-activity.ts`

**3. Task Checkout/Locking (`executionRunId` + `executionLockedAt`)**
- Peon's last-write-wins is fragile for concurrent multi-agent work
- Paperclip's atomic checkout with lock holder identification prevents conflicts
- Start with: `lockedBy`/`lockedAt` fields on tasks table, checkout/release API

### Priority 2: Medium Impact, Improves Robustness

**4. Per-Task Session Persistence (`agent_task_sessions` table)**
- Peon loses conversational context on container restart
- Paperclip's per-task session params enable deterministic resumption
- Would allow agents to resume exactly where they left off on a specific task

**5. Agent Config Revisions (`agent_config_revisions` table)**
- Peon has no config change history
- Paperclip tracks before/after snapshots with rollback support
- Useful for debugging "why did the agent behavior change?"

**6. Hierarchical Goals (`goals` table with `parentId` + `level`)**
- Peon's flat task list doesn't express dependencies or milestones
- Start with: `parentId` on tasks for sub-tasks, optional `priority` field

### Priority 3: Future Consideration

**7. Approval Gates (`approvals` table + state machine)**
- Important for enterprise/team use cases
- Peon currently relies on Claude Code's built-in permission prompts
- Add when Peon targets multi-user teams with governance needs

**8. Multi-Adapter Support (adapter interface)**
- Peon is locked to OpenClaw/Claude Code
- Paperclip's plugin architecture supports 7 adapters
- Add when there's demand for non-Claude agents

**9. Exportable Org Configs**
- Paperclip supports template export (structure only) and snapshot export (full state)
- Would enable Peon project templates with pre-configured agent teams

**10. CLI Tool**
- Paperclip has `onboard`, `doctor`, `run`, `configure` CLI commands
- Peon has no CLI — everything is web-only

---

## 12. Schema Comparison

### Peon (`packages/gateway/src/db/schema.ts`)

```
users            — id, email, name, avatarUrl, googleId, githubId, githubAccessToken, peonAgentId
projects         — id, userId, name, repoUrl, repoBranch, templateId, status, deploymentName
apiKeys          — id, userId, provider, encryptedKey, label
chatMessages     — id, projectId, userId, role, content, contentBlocks
tasks            — id, projectId, subject, description, status, owner, boardColumn, metadata
teams            — id, projectId, name
teamMembers      — id, teamId, roleName, displayName, systemPrompt, color
```

**Total: 7 tables**

### Paperclip (`packages/db/src/schema/`)

```
companies                — Multi-tenant root with budget fields
agents                   — Hierarchical org with adapter config, budget, heartbeat
issues                   — Work items with checkout locking, billing codes, goal links
goals                    — Hierarchical goal tree (initiative > project > milestone > issue)
projects                 — Project containers with lead agent, goal link
project_workspaces       — Git workspace definitions per project
approvals                — Human-in-the-loop approval state machine
approval_comments        — Threaded approval discussions
cost_events              — Granular per-event cost attribution
activity_log             — Full audit trail with actor/entity/action/details
heartbeat_runs           — Complete execution run records with logs/usage
heartbeat_run_events     — Fine-grained events within runs
agent_runtime_state      — Persistent per-agent state with token totals
agent_task_sessions      — Per-task session persistence
agent_config_revisions   — Config change audit trail with rollback
agent_wakeup_requests    — Wakeup queue with deduplication
company_secrets          — Encrypted secret storage
issue_comments           — Task-level communication trail
users                    — User accounts
sessions                 — Auth sessions (Better Auth)
accounts                 — OAuth accounts (Better Auth)
verifications            — Email verification (Better Auth)
+ more auth/system tables
```

**Total: 34+ tables**

---

## 13. Summary

Paperclip is an enterprise control plane with deep governance. Peon is a developer-facing agent runtime with strong real-time UX. They're complementary rather than competitive — Paperclip could theoretically use Peon as an adapter backend.

The most actionable gaps for Peon are cost tracking, audit logging, and task locking — these are table stakes for any production agent orchestration system and can be implemented incrementally without architectural changes.
