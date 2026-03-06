# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (starts Postgres, Redis via Docker + Vite dev server)
npm run dev

# Individual services
npm run dev:gateway          # Hono on :8080 (bun --watch)
npm run dev:web              # Vite on :5173

# Build all packages (core → gateway → worker → web)
npm run build

# Typecheck (run before committing)
bun run typecheck            # tsc --noEmit across all packages

# Tests
cd packages/web && npx vitest run                          # all web tests (Vitest)
cd packages/web && npx vitest run src/__tests__/foo.test.ts # single web test
cd packages/gateway && bun test                             # all gateway tests (Bun)
cd packages/gateway && bun test src/__tests__/foo.test.ts   # single gateway test
cd packages/worker && bun test                              # all worker tests (Bun)
```

**Known issue:** Gateway build has a pre-existing TS1343 in `packages/gateway/src/db/migrate.ts` — ignore it.

## Architecture

Monorepo with npm workspaces, Bun runtime for backend, Vite for frontend.

```
packages/
  core/      @lobu/core     — Shared: logger (winston), Redis, OpenTelemetry, Sentry
  gateway/   @lobu/gateway  — Hono HTTP server (:8080), orchestration, auth, DB, all routes
  worker/    @lobu/worker   — AI agent runtime, spawned per-project in Docker containers
  web/       @peon/web      — React 19 SPA (Vite, Tailwind v4, shadcn/ui, React Router v7)
```

**Path aliases:** `@lobu/core`, `@lobu/gateway`, `@lobu/worker` resolve to source `.ts` files via tsconfig paths (not compiled output). Web uses `@` → `packages/web/src/`.

### Request Flow

```
Browser (:5173) → Vite proxy → Gateway (:8080) → Postgres / Redis
                                    ↕ Docker (spawns worker containers)
                               Worker containers
                                    ↕ SSE + REST back to gateway
```

- **Gateway** (Hono + Drizzle ORM + BullMQ): Auth (Google/GitHub/Claude OAuth → JWT cookies), project CRUD, API key management (AES-256-GCM encrypted), chat routing, SSE fan-out via Redis pub/sub
- **Worker**: Runs OpenClaw AI agent inside Docker containers with network isolation. Connects back to gateway via SSE (`GatewayClient`). Each project gets its own container with tmux terminal sessions
- **Web**: Cookie-credentialed fetch in `lib/api.ts` (auto-redirects on 401). Real-time via SSE on `/api/projects/:id/chat/stream`

### Gateway Route Layout

- `src/routes/api/` — User-facing (auth-protected): projects, keys, chat
- `src/routes/internal/` — Worker-facing: agent-activity, tasks, boot-progress, hook-events
- `src/routes/public/` — Unauthenticated: OAuth callbacks

### SSE Events (on `/api/projects/:id/chat/stream`)

`agent_activity` (tool events), `task_update`/`task_delete`, `message`, `chat_delta`/`chat_status`, `project_status`, `ping`

### Worker → Gateway Pipeline

Workers POST to internal endpoints: `/internal/agent-activity`, `/internal/tasks`, `/internal/boot-progress`, `/internal/hook-events`. Gateway broadcasts to frontend via Redis pub/sub → SSE.

### Docker Networking

- `peon-public` — internet access for gateway
- `peon-internal` — isolated network for workers; internet only via gateway's HTTP proxy (:8118)
- Gateway mounts Docker socket to spawn/manage worker containers via Dockerode

## Conventions

- **No custom CSS** — Tailwind classes only
- **Strict TypeScript** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`
- **Database migrations** — Drizzle Kit, migration files in `packages/gateway/drizzle/`
- **Schema** — `packages/gateway/src/db/schema.ts` (users, projects, api_keys, chat_messages, tasks, teams, team_members)
