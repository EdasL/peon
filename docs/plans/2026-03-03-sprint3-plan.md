# Sprint 3 — Production Polish

## Goal
Make peon feel like a finished product. Fix reliability issues, polish UX, and fill feature gaps.

## Tasks (priority order)

### 1. Landing page (web)
Current landing page is a 16-line stub. Build a real one that sells peon.
- Hero section: headline + subline + CTA
- Feature highlights: agent teams, real-time visibility, GitHub integration
- Social proof placeholder
- Dark aesthetic matching the app
- File: `packages/web/src/pages/LandingPage.tsx`

### 2. Dashboard polish (web)
- Add "last activity" timestamp on project cards (use project.updatedAt)
- Better empty state when no projects exist
- Project status badge improvements (color-coded)
- File: `packages/web/src/pages/DashboardPage.tsx`

### 3. Chat panel reliability (web + gateway)
- Add error state UI when chat fails to load or SSE disconnects
- Show message timestamps in chat bubbles
- Add connection status indicator (connected/reconnecting)
- Add SSE onerror handler with reconnection feedback
- Files: `packages/web/src/components/chat/ChatPanel.tsx`, `packages/web/src/hooks/use-chat.ts`

### 4. Agent error visibility (web)
- Wire agent_activity error events into agent status cards
- Show "error" status on agent card when error event arrives
- Add error message tooltip/detail
- Files: `packages/web/src/hooks/use-agent-activity.ts`, `packages/web/src/components/project/AgentStatusCards.tsx`

### 5. Project rename (gateway + web)
- Add PATCH /api/projects/:id endpoint (name, repoUrl)
- Add inline rename on dashboard project cards
- Files: `packages/gateway/src/routes/api/projects.ts`, `packages/web/src/pages/DashboardPage.tsx`

### 6. API key validation (gateway)
- Validate API key format before saving (sk-ant-* for Anthropic, sk-* for OpenAI)
- Return clear error if format doesn't match
- File: `packages/gateway/src/routes/api/keys.ts`

### 7. Gateway health check (gateway)
- Add GET /health endpoint returning { status: "ok", uptime, version }
- Add to docker-compose healthcheck
- Files: `packages/gateway/src/cli/gateway.ts`, `docker/docker-compose.yml`
