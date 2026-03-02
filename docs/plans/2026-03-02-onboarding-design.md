# Multi-User Agent Platform — Onboarding & Architecture Design

**Date:** 2026-03-02
**Status:** Approved

## Goal

Transform the local femrun-kanban tool into a hosted multi-user platform where non-technical users can sign up, connect their GitHub repos, launch AI agent teams per project, and interact primarily through chat with a team lead agent — with a live Kanban dashboard as the visualization layer.

## Foundation

Fork **Lobu** (Apache 2.0) — a production-quality multi-tenant Claude Code platform with Docker container orchestration, network isolation, multi-provider auth, and a module system. This provides weeks of security and infrastructure work out of the box.

## Onboarding Flow

```
Google OAuth → Connect GitHub → Pick Repo → Choose Team Template → Add API Key → Launch → Dashboard
```

1. **Sign In** — Google OAuth (one-click)
2. **Connect GitHub** — OAuth flow grants repo access for cloning and PRs
3. **Pick Repo** — Select from user's GitHub repos (or create new)
4. **Choose Template** — Full Stack, Backend Only, Mobile Only (pre-configured agent teams)
5. **Add API Key** — User provides their own Anthropic/OpenAI key (they pay for agent usage, we don't)
6. **Launch** — Spin up a Docker container for the team, clone repo, start agents
7. **Dashboard** — Split view: Kanban board (left) + Chat with Team Lead (right)

## Core UX: Chat-First + Kanban Dashboard

### Split View Layout

```
+---------------------------------------------+---------------------------+
|           KANBAN DASHBOARD                   |    CHAT WITH TEAM LEAD    |
|                                              |                           |
| Backlog | To Do | In Progress | QA | Done    | You: "Add user auth with  |
|         |       |             |    |         |  Google OAuth"            |
| [card]  |[card] | [card]      |    | [card]  |                           |
| [card]  |       | [card]      |    | [card]  | Lead: "I'll break this    |
|         |       |             |    |         |  into 5 tasks..."         |
|         |       |             |    |         |                           |
|         |       |             |    |         | [task cards appear on     |
|         |       |             |    |         |  kanban in real-time]     |
+---------------------------------------------+---------------------------+
```

### Interaction Model

- **Chat is the primary input** — Users describe features/bugs in natural language
- **Team lead agent** breaks requests into Kanban tasks and assigns them to specialist agents
- **Kanban board is the dashboard** — Real-time visualization of what agents are doing
- Users can still manually edit/reorder tasks on the board
- Chat history persists per team/project

## Multi-Project Dashboard

Users can manage multiple teams across multiple repos:

```
+------------------------------------------------------------------+
|  MY PROJECTS                                    [+ New Project]   |
|                                                                   |
|  +------------------+  +------------------+  +------------------+ |
|  | femrun-web       |  | api-backend      |  | mobile-app       | |
|  | 3 agents active  |  | 2 agents idle    |  | Not started      | |
|  | 12 tasks done    |  | 5 tasks done     |  |                  | |
|  | Last: 2min ago   |  | Last: 1hr ago    |  | [Launch]         | |
|  +------------------+  +------------------+  +------------------+ |
+------------------------------------------------------------------+
```

## Architecture

### Infrastructure

```
                    ┌──────────────────────────┐
                    │    Vercel (Free Tier)     │
                    │    React Frontend         │
                    │    Next.js / Vite         │
                    └──────────┬───────────────┘
                               │ HTTPS
                    ┌──────────▼───────────────┐
                    │   GCP Compute Engine VM   │
                    │                           │
                    │  ┌─────────────────────┐  │
                    │  │   Lobu Gateway       │  │
                    │  │   (Hono API)         │  │
                    │  │   + Postgres         │  │
                    │  │   + Redis            │  │
                    │  └─────────┬───────────┘  │
                    │            │               │
                    │  ┌─────────▼───────────┐  │
                    │  │  Docker Containers   │  │
                    │  │                      │  │
                    │  │  ┌────────────────┐  │  │
                    │  │  │ Team Worker 1  │  │  │
                    │  │  │ (user A proj1) │  │  │
                    │  │  │ Team Lead +    │  │  │
                    │  │  │ Specialist     │  │  │
                    │  │  │ Agents         │  │  │
                    │  │  └────────────────┘  │  │
                    │  │  ┌────────────────┐  │  │
                    │  │  │ Team Worker 2  │  │  │
                    │  │  │ (user A proj2) │  │  │
                    │  │  └────────────────┘  │  │
                    │  │  ┌────────────────┐  │  │
                    │  │  │ Team Worker 3  │  │  │
                    │  │  │ (user B proj1) │  │  │
                    │  │  └────────────────┘  │  │
                    │  └──────────────────────┘  │
                    └────────────────────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React + Vite (Vercel) | Dashboard, chat, onboarding |
| API Gateway | Lobu Gateway (Hono) | Auth, routing, container orchestration |
| Database | Postgres | Users, teams, API keys, chat history |
| State/Queue | Redis + BullMQ | Job queue, real-time state, SSE |
| Containers | Docker + Dockerode | One per team, network-isolated |
| Auth | Google OAuth + GitHub OAuth | User sign-in + repo access |
| Agent Runtime | Claude Code (in worker) | Team lead + specialist agents |

### Container Model

- **One container per team** (not per user) — a user with 3 projects has 3 containers
- Containers run on Docker's internal network (no direct internet access)
- HTTP proxy controls egress (allowlisted domains only)
- Each container gets: cloned repo, Claude Code, team agent config
- Team lead agent runs inside the container, receives chat messages via SSE

### Data Flow

1. User sends chat message → Frontend → API Gateway
2. Gateway routes message to correct worker container via SSE
3. Team lead agent processes message, creates/assigns tasks
4. Task updates flow back via SSE → Gateway → Frontend
5. Kanban board updates in real-time

### Security

- Network isolation: workers on internal Docker network, no direct internet
- HTTP proxy for controlled egress
- User API keys encrypted at rest in Postgres
- Container resource limits (CPU, memory, disk)
- Read-only root filesystem in containers
- No privileged containers, all capabilities dropped

### Cost Model

- **Users pay for:** Their own LLM API usage (Anthropic/OpenAI keys)
- **We pay for:** GCP VM hosting, Vercel (free tier), domain
- **Estimated GCP cost:** ~$30-50/month for a small e2-standard-4 VM (scalable)

## Tech Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Foundation | Fork Lobu | Production-quality container orchestration, auth, security — saves weeks |
| Deployment | GCP Compute Engine | Full Docker control, predictable cost, no vendor lock-in |
| Frontend hosting | Vercel free tier | Zero cost, great DX, CDN |
| Auth provider | Google OAuth | Widest reach for non-technical users |
| Code workflow | Git-based | Clone repo → agents work → commit/PR back |
| Container per | Team (not user) | Right isolation boundary — each project is independent |
| API key model | User-provided | We don't subsidize LLM costs, scales naturally |

## Out of Scope (v1)

- Custom domain per user
- Team collaboration (multiple users on one team)
- Billing/subscription system
- Mobile app
- Self-hosted option
- Preview URLs for web projects
- File browser / code editor in UI
