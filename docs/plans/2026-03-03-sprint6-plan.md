# Sprint 6 — Board Fix + Auth Resilience

## Tasks

### 1. Add boardColumn to task PATCH endpoint (gateway)
Board drag-drop fails silently — PATCH only accepts status/owner/metadata, not boardColumn.
- Files: `packages/gateway/src/web/chat-routes.ts`

### 2. Add 401 interceptor + auth redirect (web)
JWT expiry leaves users on dead pages. Add response interceptor to api.ts that redirects to /login on 401.
- Files: `packages/web/src/lib/api.ts`

### 3. Periodic auth validation (web)
Auth check only runs on mount. Add periodic /api/auth/me check to catch expired sessions.
- Files: `packages/web/src/hooks/use-auth.ts`
