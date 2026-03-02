# peon.work — Architecture Overview

## What's Running Right Now

```
Browser (localhost:5174)          Gateway (localhost:3000)           Infrastructure
┌─────────────────────┐          ┌──────────────────────┐          ┌──────────────┐
│  React + Vite       │          │  Hono HTTP server    │          │  Postgres    │
│                     │  proxy   │                      │          │  (users,     │
│  /login             │ ──────── │  /api/auth/*         │ ──────── │   projects,  │
│  /onboarding        │  /api/*  │  /api/projects/*     │          │   api_keys,  │
│  /dashboard         │          │  /api/keys/*         │          │   chat_msgs) │
│  /project/:id       │          │  /api/projects/:id/  │          ├──────────────┤
│    ├─ Board (left)  │          │    chat, tasks       │          │  Redis       │
│    └─ Chat (right)  │          │                      │          │  (Lobu queue │
└─────────────────────┘          └──────────────────────┘          │   + state)   │
                                                                    └──────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind v4, shadcn/ui, react-router-dom |
| Backend | Hono (HTTP framework from Lobu), Bun runtime |
| Database | PostgreSQL 16 via Drizzle ORM |
| Queue/State | Redis 7 (BullMQ, used by Lobu internally) |
| Auth | Google OAuth 2.0 → JWT sessions (httpOnly cookies) |
| Encryption | AES-256-GCM for API keys and GitHub tokens at rest |
| AI | Anthropic API (Claude Sonnet) called directly from gateway |

### Auth Flow

1. User clicks "Sign in with Google"
2. Redirects to Google consent screen
3. Google calls back to `/api/auth/google/callback`
4. Gateway exchanges code for Google profile, finds/creates user in Postgres
5. Creates JWT (7-day expiry), sets as `session` httpOnly cookie
6. Redirects to `/onboarding` (new user) or `/dashboard` (returning user)

### Onboarding (5 steps)

1. **Connect GitHub** — OAuth flow, stores encrypted access token
2. **Select Repository** — Lists user's GitHub repos via their token
3. **Choose Template** — Selects project type (e.g., "fullstack", "api")
4. **Add API Key** — Stores Anthropic/OpenAI key (AES-256-GCM encrypted)
5. **Launch Project** — Creates project record, triggers container launch (scaffolded)

### Chat Flow (current, simplified)

1. User types message in the chat panel
2. `POST /api/projects/:id/chat` stores the message in Postgres
3. Gateway loads full chat history from Postgres
4. Gateway calls Anthropic API directly using the user's stored (decrypted) API key
5. Response stored in Postgres
6. Both user message and AI response broadcast via SSE to the chat panel
7. No streaming — full response arrives at once

### Kanban Board

- In-memory task store on the gateway (resets on restart)
- CRUD operations: create tasks in backlog, drag between columns, delete
- Columns: Backlog → Todo → In Progress → QA → Done
- Drag-and-drop via @dnd-kit
- Polls every 5 seconds for updates
- No AI connection to the board yet — tasks are manually created

---

## What's Scaffolded But Not Wired

The Lobu framework we forked has a full container orchestration system. Here's how the intended architecture works:

```
User message
    │
    ▼
Gateway ──enqueue──► Redis (BullMQ)
                         │
                         ▼
                    Orchestrator
                         │
                    ┌────▼─────┐
                    │  Docker   │
                    │ Container │
                    │           │
                    │ OpenClaw  │  ← Full AI agent with:
                    │  Worker   │     - File read/write tools
                    │           │     - Bash execution
                    │           │     - Git operations
                    │           │     - Workspace management
                    │           │     - Plugin system
                    └─────┬─────┘
                          │
                    SSE stream back
                          │
                          ▼
                    Gateway broadcasts
                    to frontend
```

In this model, each project gets its own Docker container with a persistent workspace. The AI agent (OpenClaw) can clone the user's repo, edit files, run tests, and push commits — not just chat.

### OpenClaw (packages/worker/src/openclaw/)

OpenClaw is the AI agent framework inside Lobu's worker containers:

- `worker.ts` — Main executor. Sets up workspace, tools, instructions, runs AI session
- `processor.ts` — Processes streaming events from the AI model
- `tools.ts` — File editing, bash, git, and other workspace tools
- `custom-tools.ts` — Gateway-integrated tools (channel history, file upload)
- `session-context.ts` — Fetches runtime config from the gateway
- `plugin-loader.ts` — Loads OpenClaw plugins for extended functionality

It uses `@mariozechner/pi-coding-agent` under the hood — a full coding agent with tool use, session management, and multi-turn conversation support.

### Container Lifecycle (intended)

1. User creates a project → `project-launcher.ts` generates a deployment name
2. Orchestrator creates a Docker container (`lobu-worker:latest`) with env vars:
   - `PROJECT_ID`, `USER_ID`, `TEMPLATE_ID`
   - `ANTHROPIC_API_KEY` (from user's stored key)
   - `REPO_URL` (user's GitHub repo)
3. Worker container starts, connects back to gateway via SSE
4. Messages are queued via Redis, consumed by the worker
5. Worker streams responses back through the gateway to the frontend
6. Worker has network isolation (internal Docker network, HTTP proxy for allowed domains)

---

## Status of Each Piece

| Piece | Status | Notes |
|-------|--------|-------|
| Google OAuth | **Working** | Sign-in, session management, JWT cookies |
| GitHub OAuth | **Working** | Token stored encrypted, repo listing works |
| Project CRUD | **Working** | Create, list, view, delete projects |
| API key storage | **Working** | AES-256-GCM encrypted at rest |
| Chat with AI | **Working** | Direct Anthropic API call (no streaming) |
| Chat history | **Working** | Persisted in Postgres, loaded on page open |
| SSE real-time updates | **Working** | Messages broadcast to connected clients |
| Kanban board UI | **Working** | Drag-and-drop, CRUD, 5-column layout |
| Task persistence | **Not done** | In-memory only, resets on restart |
| Docker container launch | **Scaffolded** | Code exists, not connected to project creation |
| OpenClaw worker agent | **Exists** | Full agent in codebase, not invoked by our chat |
| Message routing via Redis | **Exists** | Lobu infra works, not wired to our chat flow |
| Agent → task board sync | **Scaffolded** | `task-sync.ts` ready, no real data flowing |
| Streaming responses | **Not done** | Chat is request/response, not streamed |
| Multi-agent teams | **Not done** | Designed, not implemented |
| Deployment (GCP) | **Scaffolded** | `deploy-gcp.sh` + `docker-compose.prod.yml` ready |

---

## Key Files

### Frontend (packages/web/)
- `src/App.tsx` — Router with AuthGuard
- `src/pages/LoginPage.tsx` — Google sign-in
- `src/pages/OnboardingPage.tsx` — 5-step wizard
- `src/pages/DashboardPage.tsx` — Project grid
- `src/pages/ProjectPage.tsx` — Board + Chat split view
- `src/components/board/Board.tsx` — Kanban board with drag-and-drop
- `src/components/chat/ChatPanel.tsx` — Chat UI
- `src/hooks/use-chat.ts` — Chat hook with SSE EventSource
- `src/hooks/use-board.ts` — Board hook with polling
- `src/lib/api.ts` — All API calls

### Gateway (packages/gateway/)
- `src/cli/gateway.ts` — Main Hono app, route mounting
- `src/auth/google-oauth.ts` — Google OAuth flow
- `src/auth/github-oauth.ts` — GitHub OAuth flow
- `src/auth/session.ts` — JWT creation/verification
- `src/auth/middleware.ts` — Auth middleware (cookie → session)
- `src/routes/public/auth.ts` — Auth routes
- `src/routes/api/projects.ts` — Project CRUD
- `src/routes/api/keys.ts` — API key management
- `src/web/chat-routes.ts` — Chat + task endpoints
- `src/web/task-sync.ts` — In-memory task state
- `src/web/project-launcher.ts` — Container launch (scaffolded)
- `src/services/encryption.ts` — AES-256-GCM encrypt/decrypt
- `src/db/schema.ts` — Drizzle schema (users, projects, api_keys, chat_messages)
- `src/db/connection.ts` — Postgres connection pool

### Worker (packages/worker/) — not yet invoked
- `src/openclaw/worker.ts` — OpenClaw agent executor
- `src/openclaw/processor.ts` — Streaming event processor
- `src/openclaw/tools.ts` — Agent tools (file, bash, git)
- `src/server.ts` — Worker HTTP server

### Infrastructure
- `docker/docker-compose.yml` — Dev environment (Postgres, Redis, Gateway)
- `docker/docker-compose.prod.yml` — Production environment
- `docker/Dockerfile.gateway` — Gateway container
- `docker/Dockerfile.worker` — Worker container
- `scripts/deploy-gcp.sh` — GCP deployment script
- `.env` — Environment variables (secrets, URLs, config)

---

## Next Steps (architectural decision)

Two paths forward:

### Path A: Evolve the simple approach
Keep calling Anthropic directly from the gateway. Add streaming, persist tasks to Postgres, and build features on top. Simpler, faster to ship, but limited to chat — no actual code editing or repo interaction.

### Path B: Wire up OpenClaw containers
Connect the full Lobu orchestration pipeline. Each project gets a Docker container with a real coding agent that can clone repos, edit files, run tests, and push commits. More complex, but delivers the actual product vision.
