# Sprint 9 — Agent Identity + Activity Pipeline

## Problem
The agent activity pipeline (worker → gateway → SSE → frontend) is fully wired but:
1. No agent name in events — all activity attributed to generic "agent"
2. fetchTeamConfig returns empty members — Board sidebar shows nothing
3. Tool events lack context (e.g., which file is being read)

## Tasks

### 1. Add agentName to activity events (worker + gateway + web)
Worker sends agent identity in POST body, gateway forwards it, frontend uses it.
- Files: `packages/worker/src/openclaw/worker.ts`, `packages/gateway/src/routes/internal/agent-activity.ts`, `packages/web/src/hooks/use-agent-activity.ts`

### 2. Fix fetchTeamConfig (web)
Derive real team members from project's templateId using the template registry.
Update TeamSidebar to render template-sourced colors.
- Files: `packages/web/src/lib/api.ts`, `packages/web/src/components/board/TeamSidebar.tsx`

### 3. Enrich tool_start with context (worker)
Include file path or command summary in tool_start events for better activity feed.
- Files: `packages/worker/src/openclaw/worker.ts`
