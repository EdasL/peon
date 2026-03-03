# Sprint 4 — Core Infrastructure Hardening

## Goal
Fix the foundational gaps: task persistence, container readiness, activity routing, and health checks.

## Tasks (priority order)

### 1. Task persistence — migrate to Postgres (gateway)
Tasks are currently stored in an in-memory Map, lost on every gateway restart.
- Add `tasks` table to Drizzle schema (id, projectId, title, description, status, column, assignee, createdAt, updatedAt)
- Replace in-memory Map in `task-sync.ts` with Postgres queries
- Keep SSE broadcast for real-time updates
- Migrate CRUD endpoints in `chat-routes.ts` to use Postgres
- Files: `packages/gateway/src/db/schema.ts`, `packages/gateway/src/web/task-sync.ts`, `packages/gateway/src/web/chat-routes.ts`

### 2. Container readiness feedback (gateway)
When a project is created, there's no confirmation the container actually started. Status can be stuck on "creating" forever.
- After `ensureUserContainer()`, poll container health (Docker inspect or HTTP health check)
- Update project status to "running" or "error" based on container state
- Add timeout (60s) — if container isn't ready, mark as "error"
- Emit `project_status` SSE event when status changes
- Files: `packages/gateway/src/web/project-launcher.ts`, `packages/gateway/src/web/container-manager.ts`

### 3. Activity routing fix (gateway)
Agent activity events route to "most recently updated project" — wrong for multi-project users.
- Add `activeProjectId` field to worker token or session metadata
- When worker posts activity, include the project context
- Fall back to "most recent" only if no explicit project context
- Files: `packages/gateway/src/routes/internal/agent-activity.ts`, `packages/gateway/src/web/project-launcher.ts`

### 4. Gateway health endpoint (gateway)
No health check endpoint for Docker or monitoring.
- Add `GET /health` returning `{ status: "ok", uptime, version }`
- Add to docker-compose healthcheck
- Files: `packages/gateway/src/cli/gateway.ts`, `docker/docker-compose.yml`
