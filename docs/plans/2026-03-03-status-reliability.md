# Container Status Reliability + Restart UI

**Date**: 2026-03-03
**Team**: Status reliability team (team 2)
**Scope**: Container status state machine, status UI, restart button, chat connection banner

## Current State

### Backend
- DB enum: `creating | running | stopped | error`
- API maps `creating` → `starting` for frontend
- Docker states mapped via `container-manager.ts`: running/starting/stopped/error
- 90s timeout in `project-launcher.ts` `waitForContainerReady()`
- Restart endpoint exists: `POST /api/projects/:id/restart`
- SSE broadcasts at: creation polling, first agent response, error response, restart
- Redis pub/sub for SSE broadcast via `broadcastToProject()`

### Frontend
- ProjectPage: overlay (creating), error page (error), amber banner (stopped w/ restart)
- DashboardPage: colored badges (running/creating/error), 10s polling
- ChatPanel: green "live" dot or amber "reconnecting", disables send when disconnected
- AgentSidebar: "offline" indicator when SSE disconnected

## Problems Identified

1. **Timeout too short**: 90s may not be enough for slow provisions → stuck "creating"
2. **Error messages not surfaced**: Error page shows generic text, not actual failure reason
3. **No restart on error state**: Restart button only on "stopped" banner, not on error page
4. **Dashboard lacks restart**: No way to restart from project cards
5. **Chat disables input on disconnect**: Users can't even read/scroll properly
6. **"retrying" text**: Frontend shows "reconnecting" text that's confusing; should be non-intrusive banner

## Plan

### Task 1: Backend — Status state machine fixes

**Files**: `packages/gateway/src/web/project-launcher.ts`, `packages/gateway/src/routes/api/projects.ts`

1. Change `waitForContainerReady` timeout from 90s to 120s (2 min)
2. Ensure error messages are stored: add `statusMessage` column or use existing field to pass error reason through `project_status` SSE event payload (`{ status, message? }`)
3. Verify all state transitions broadcast `project_status` SSE immediately
4. In restart endpoint: ensure status transitions broadcast at every step (creating → running/error)
5. Add `statusMessage` to the `project_status` SSE payload so frontend can display actual errors

### Task 2: Frontend — Status UI cleanup

**Files**: `packages/web/src/pages/ProjectPage.tsx`, `packages/web/src/components/project/ProvisioningOverlay.tsx`

1. Status badge component with clear states:
   - Running: green badge with dot
   - Starting/Creating: amber badge with spinner + "Setting up your workspace..."
   - Stopped: gray badge
   - Error: red badge + error message text
2. Error state: show actual error message from SSE payload, not generic text
3. ProvisioningOverlay: keep as-is (already has 4-step progress), but ensure it shows error message when transitioning to error

### Task 3: Restart button (frontend + backend)

**Frontend files**: `packages/web/src/pages/ProjectPage.tsx`, `packages/web/src/pages/DashboardPage.tsx`
**Backend files**: `packages/gateway/src/routes/api/projects.ts`

Frontend:
1. ProjectPage error state: replace "Back to dashboard" with "Restart" button (primary) + "Back" link
2. ProjectPage stopped banner: keep existing restart button (already works)
3. DashboardPage: add restart icon button on stopped/error project cards
4. After restart click: transition to "creating" with ProvisioningOverlay

Backend:
1. Restart endpoint already exists — verify it works correctly
2. Ensure restart broadcasts `project_status: { status: "creating" }` immediately
3. Ensure restart cleans up old container before re-provisioning
4. Return error message in response if restart fails

### Task 4: Chat connection banner

**Files**: `packages/web/src/components/chat/ChatPanel.tsx`

1. When disconnected: show non-intrusive top banner "Reconnecting..." with spinner
2. Keep existing messages visible and scrollable
3. Do NOT disable send button or input — let users type (queue or show error on send attempt)
4. Auto-hide banner when connection restores
5. Remove the current approach of showing "reconnecting" in the connection indicator dot area — use banner instead

## File Ownership (avoid conflicts with team 1)

### We own (safe to modify):
- `packages/gateway/src/web/project-launcher.ts` — timeout changes
- `packages/gateway/src/routes/api/projects.ts` — restart endpoint, status mapping
- `packages/gateway/src/web/container-manager.ts` — docker state mapping (if needed)
- `packages/web/src/pages/ProjectPage.tsx` — status display, restart UI
- `packages/web/src/pages/DashboardPage.tsx` — restart button on cards
- `packages/web/src/components/chat/ChatPanel.tsx` — connection banner
- `packages/web/src/components/project/ProvisioningOverlay.tsx` — error messages

### Team 1 owns (DO NOT TOUCH):
- Container bootstrap files
- Chat context files
- `packages/gateway/src/web/chat-routes.ts` — SSE stream setup
- `packages/web/src/hooks/use-chat.ts` — chat hook internals (but we can use its exports)

## Execution Order

1. Backend fixes first (Task 1) — state machine + error messages in SSE
2. Frontend status UI (Task 2) — consume new error messages
3. Restart button (Task 3) — both ends
4. Chat banner (Task 4) — independent of others

Backend and frontend can work in parallel since Task 2-4 frontend work uses existing API contracts (the error message enhancement in Task 1 is additive).
