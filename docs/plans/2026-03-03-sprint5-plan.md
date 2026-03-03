# Sprint 5 — Multi-Instance SSE, Chat Polish, Template UI

## Goal
Enable multi-instance gateway deployment via Redis pub/sub for SSE broadcasts. Improve chat UX with markdown rendering. Add agent team template preview UI to onboarding.

## Tasks (priority order)

### 1. SSE Redis pub/sub for multi-instance support (gateway)
Replace in-memory `sseClients` Map with Redis pub/sub so SSE broadcasts work across gateway instances.

**Key insight:** `broadcastToProject()` is the single chokepoint — all 12 call sites across 4 files go through it. Only the implementation needs to change; callers stay identical.

**Approach:**
- Create `packages/gateway/src/web/redis-broadcast.ts` — shared pub/sub module
  - Shared publisher Redis client (reuse existing ioredis from queue)
  - Shared subscriber Redis client (new connection — ioredis requires dedicated connection for subscribe mode)
  - Channel naming: `peon:project:{projectId}`
  - `channelListeners` Map for local delivery from subscriber
  - `broadcastToProject()` publishes to Redis; subscriber delivers to local SSE clients
  - Graceful fallback: if Redis not initialized, deliver locally only (dev mode)
- Modify `packages/gateway/src/web/chat-routes.ts` — swap `sseClients` Map for subscribe/unsubscribe via redis-broadcast
- Modify `packages/gateway/src/cli/gateway.ts` — initialize broadcast module on startup with Redis URL
- All 12 callers of broadcastToProject keep working unchanged

**Files:**
- Create: `packages/gateway/src/web/redis-broadcast.ts`
- Modify: `packages/gateway/src/web/chat-routes.ts`
- Modify: `packages/gateway/src/cli/gateway.ts`

### 2. Chat markdown rendering (web)
Assistant messages render as plain text. Add markdown support for code blocks, links, lists, bold/italic.

**Approach:**
- Install `react-markdown` + `remark-gfm` (GitHub-flavored markdown)
- Create a `MarkdownMessage` component for assistant bubbles
- Style code blocks with monospace + dark background
- Apply to both completed messages and streaming content
- Fix error banner dark mode colors (currently uses light mode red)

**Files:**
- Create: `packages/web/src/components/chat/MarkdownMessage.tsx`
- Modify: `packages/web/src/components/chat/ChatPanel.tsx`

### 3. Agent team template preview (web)
Onboarding template picker shows template names but no detail about what agents are in each team. Add a preview showing team composition.

**Approach:**
- Define template metadata (agents, roles, descriptions) in a config
- Show agent avatars/roles when hovering or selecting a template
- Keep the selection flow simple — click to pick, then launch

**Files:**
- Modify: `packages/web/src/pages/OnboardingPage.tsx`
