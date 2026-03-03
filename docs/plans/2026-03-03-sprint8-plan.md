# Sprint 8 — Core Functionality Fixes

## Tasks

### 1. Fix board column persistence (web)
`moveTask` sends `status`/`owner` in the PATCH but never `boardColumn`. Column assignments are lost on reload.
- Files: `packages/web/src/hooks/use-board.ts`

### 2. Add container restart (gateway + web)
No way to restart a stopped project. Need:
- `restartContainer()` in container-manager.ts
- `POST /api/projects/:id/restart` endpoint in projects.ts
- Restart button on ProjectPage when status is "stopped"
- Files: `packages/gateway/src/web/container-manager.ts`, `packages/gateway/src/routes/api/projects.ts`, `packages/web/src/pages/ProjectPage.tsx`

### 3. Optimistic chat messages (web)
User messages vanish after send() until SSE echoes them back. Add optimistic insert.
- Files: `packages/web/src/hooks/use-chat.ts`

### 4. Dashboard status polling (web)
Project statuses never refresh after initial load. Add periodic polling.
- Files: `packages/web/src/pages/DashboardPage.tsx`
