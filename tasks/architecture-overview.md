# Peon Architecture Overview

## Current State (What's Built)

### Infrastructure Layer (Complete)

- **Per-project Docker containers** via Lobu orchestration (Docker + K8s backends)
- **Credential proxy** — containers never see real API keys; proxy injects at request time
- **Session lifecycle** — Redis sessions with TTL, idle scale-to-zero, volume persistence
- **SSE streaming** — real-time chat via server-sent events
- **Container isolation** — internal network, non-root, gvisor, unique worker tokens

### What's Missing

- **Agent intelligence layer** inside containers (currently a generic worker)
- **UI for configuring agents** (skills, models, team composition)
- **Per-user container model** (currently per-project — wasteful)

---

## Target Architecture: Per-User Containers + OpenClaw

### Key Decision: One Container Per User, Not Per Project

Lobu's per-conversation container model was designed for multi-tenant (different users, different orgs). Peon is different: **one user, many projects**. A container per project means:

- Duplicate containers sharing the same API key and preferences
- Slow project creation (wait for Docker spin-up each time)
- Agent memory fragmented across containers (can't learn the user's style)
- Wasted resources when user has 5+ projects

**Per-user model:**

- Container created once (first project or at signup)
- Projects become **workspaces** inside the container: `/workspace/projects/{projectId}/`
- Agent memory and preferences accumulate across projects
- Project creation is instant — just mkdir + config write
- Credential bridging happens once per user

### Data Model Changes

```
BEFORE: projects.lobuAgentId  (one agent per project)
AFTER:  users.lobuAgentId     (one agent per user)
        — or —
        user_agents table      (if we want multiple agent profiles per user)
```

`launchProject()` becomes two operations:
1. **`ensureUserContainer(userId)`** — idempotent, creates container if user doesn't have one
2. **`initializeProjectWorkspace(projectId)`** — writes config files to workspace volume

---

## Integration Phases

### Phase 1: OpenClaw Inside Worker Containers

The `lobu-worker:latest` image already has Bun, Node, Python, Docker CLI. Add OpenClaw as the agent runtime.

**Dockerfile changes:**
```dockerfile
# Add OpenClaw to existing worker image
RUN npm install -g @anthropic/openclaw  # or clone + build
RUN mkdir -p /workspace/.openclaw/skills
```

**Config bridge** — when worker boots and calls `/worker/session-context`, translate into OpenClaw's expected files:

| Session Context Field | OpenClaw File |
|----------------------|---------------|
| `agentInstructions` | `/workspace/.openclaw/SOUL.md` |
| `skillsInstructions` | `/workspace/.openclaw/skills/` |
| `providerConfig` | `/workspace/.openclaw/agents.md` |

**What stays unchanged:**
- Credential proxy (OpenClaw just uses the `ANTHROPIC_API_KEY` env var, proxy handles the rest)
- Container isolation (same Docker/K8s setup)
- SSE streaming (worker sends responses back via existing transport)
- Session lifecycle (touch on activity, idle cleanup)

**What changes:**
- Worker process starts OpenClaw Gateway on `localhost` inside the container
- Messages route through OpenClaw's agent system instead of raw LLM calls
- OpenClaw's memory files live on the persistent volume — survive idle scale-down

### Phase 2: Multi-Agent Within a Single Container

OpenClaw natively supports multi-agent routing. Inside one container, the user configures:

```markdown
<!-- /workspace/.openclaw/agents.md -->

## researcher
- model: claude-haiku
- role: Research and gather information
- skills: web-search, summarize

## coder
- model: claude-sonnet
- role: Write and review code
- skills: code-gen, test-runner, git

## orchestrator
- model: claude-opus
- role: Coordinate the team, make decisions
- delegates-to: researcher, coder
```

The UI writes this file to the workspace volume. OpenClaw picks it up. No container restart needed.

**Project-level agent overrides:**
```
/workspace/projects/{projectId}/.openclaw/
    agents.md        # project-specific agent config (overrides user defaults)
    SOUL.md          # project-specific instructions
    skills/          # project-specific skills
```

### Phase 3: Claude Code Agent Teams (Premium)

The worker image already has Docker CLI and supports nested Docker. For Agent Teams:

1. User triggers "Launch Agent Team" from UI
2. Backend sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in container env
3. OpenClaw's orchestrator agent spawns a Claude Code session with a team prompt
4. Team lead creates teammates (separate Claude Code processes inside the container)
5. SSE layer streams progress back to UI
6. Outputs persist to workspace volume, OpenClaw memory captures results

---

## End-to-End Flow (Target State)

### User Signup / First Project

```
1. User signs up (Google OAuth)
2. User adds Anthropic API key in settings
3. User creates first project
    ├── ensureUserContainer(userId)
    │   ├── Generate lobuAgentId (UUID) → store on user
    │   ├── bridgeCredentials(userId, lobuAgentId)
    │   ├── Create Lobu session
    │   ├── Enqueue bootstrap message
    │   └── MessageConsumer → create Docker container
    │       ├── lobu-worker:latest + OpenClaw
    │       ├── Volume: lobu-workspace-{lobuAgentId}
    │       └── Internal network, proxy, non-root
    └── initializeProjectWorkspace(projectId)
        ├── mkdir /workspace/projects/{projectId}/
        ├── Write project-specific SOUL.md
        ├── Clone repo (if provided)
        └── Notify container via SSE: "new project ready"
```

### Subsequent Projects (Container Already Running)

```
1. User creates another project
    ├── ensureUserContainer(userId) → already exists, no-op
    └── initializeProjectWorkspace(projectId)
        ├── mkdir /workspace/projects/{projectId}/
        ├── Write config files
        └── Instant — no container spin-up
```

### Sending a Chat Message

```
1. POST /api/projects/:id/chat { content }
2. Look up user.lobuAgentId → if missing: 409 "Not ready"
3. Store message in Postgres + broadcast via SSE
4. touchSession(lobuAgentId) → keep alive
5. enqueueMessage() with projectId in metadata
6. Return 201
    ↓
7. Container receives message
8. OpenClaw routes to correct project context
9. Agent processes (may delegate to sub-agents)
10. Response streams back via SSE
```

### Architecture Diagram

```
User Browser
    ↓ POST /api/projects/:id/chat
Peon Gateway
    ↓ enqueueMessage({ projectId, ... })
User's Container (one per user, always running or scale-from-zero)
    ├── OpenClaw Gateway (localhost)
    │   ├── /workspace/.openclaw/          ← user-level agent config
    │   ├── /workspace/projects/proj-1/    ← project A workspace
    │   ├── /workspace/projects/proj-2/    ← project B workspace
    │   │
    │   ├── Agent: Orchestrator (routes by projectId)
    │   ├── Agent: Researcher (shared across projects)
    │   └── Agent: Coder (shared across projects)
    │
    ├── Claude Code Agent Teams (when triggered)
    │   ├── Team Lead
    │   ├── Teammate: Backend
    │   └── Teammate: Frontend
    │
    └── Workspace Volume (persists across idle/restart)
            ↓ HTTP via proxy
        Credential Proxy → api.anthropic.com
```

---

## Credential Flow (Unchanged)

```
Postgres (encrypted key)
    ↓ bridgeCredentials() — once per user
Redis (AgentSettingsStore)
    ↓ at request time
Proxy intercepts worker's HTTP call
    ↓ looks up real credential by agentId
Injects Authorization header
    ↓
Forwards to real API
```

Container never has real keys. Proxy resolves by `agentId` at request time.

---

## Container Isolation (Unchanged)

| Property | Value |
|----------|-------|
| **User** | UID 1001 (non-root) |
| **Network** | Internal bridge — no direct internet |
| **Volume** | `lobu-workspace-{agentId}` per user |
| **Auth** | Unique `workerToken` per container |
| **Runtime** | gvisor if available |
| **Resources** | CPU/memory limits from config |

Each user's container is isolated. No cross-user access.

---

## Agent Team Templates (UI Feature)

Pre-built templates that generate `agents.md` configurations:

| Template | Agents | Use Case |
|----------|--------|----------|
| **Solo** | 1 general-purpose agent (Sonnet) | Default, simple tasks |
| **Dev Team** | Architect (Opus) + Implementer (Sonnet) + Reviewer (Haiku) | Software projects |
| **Content Team** | Writer (Sonnet) + Editor (Haiku) + SEO (Haiku) | Content creation |
| **Research Team** | Researcher (Sonnet) + Analyst (Opus) + Summarizer (Haiku) | Deep research |

Users can customize after selecting a template. The UI writes to the workspace volume.

---

## Implementation Priority

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Move `lobuAgentId` from projects to users table | Small | Unlocks per-user model |
| 2 | Split `launchProject()` into `ensureUserContainer()` + `initProjectWorkspace()` | Medium | Per-user containers |
| 3 | Add OpenClaw to worker Dockerfile | Small | Agent intelligence layer |
| 4 | Build session-context → OpenClaw config bridge | Medium | Wires everything together |
| 5 | Container readiness feedback (health check → status flip) | Small | UX fix |
| 6 | Gate project creation on API key presence | Small | UX fix |
| 7 | Agent team template UI | Medium | Differentiator |
| 8 | Claude Code Agent Teams integration | Large | Premium feature |

---

## Worker Image Contents

**Image:** `lobu-worker:latest` (from `docker/Dockerfile.worker`)

Current: Bun 1.2.9, Node.js 20, Python3 + pip + uv, Nix, Docker CLI, GitHub CLI

**To add:** OpenClaw Gateway, pre-created config directory structure

---

## Deployment Backends

- **Docker** (`docker-deployment.ts`) — local dev, single server
- **Kubernetes** (`k8s/deployment.ts`) — production, Kata runtime, PVCs, init containers
- Both use `BaseDeploymentManager` — per-user model works with either
