# Sprint 7 — Make Templates Real

## Problem
The onboarding UI shows 3 team templates (Full Stack, Backend, Mobile) with specific agent roles (Lead, Frontend, Backend, QA, etc.), but:
1. Template IDs don't match: frontend sends `backend`/`mobile`, backend expects `backend-only`/`data`
2. Templates are just a one-liner system prompt — no real agent team configuration
3. Project page shows no agents until tasks exist — users see empty state after launch
4. Dashboard doesn't show which template a project uses

## Tasks

### 1. Fix template ID alignment + write real CLAUDE.md configs (gateway)
Backend `TEMPLATE_TEAM_PROMPTS` keys must match frontend IDs (`fullstack`, `backend`, `mobile`).
Replace one-liner prompts with substantive CLAUDE.md team configurations: agent roles, file ownership, workflow.
- Files: `packages/gateway/src/web/project-launcher.ts`

### 2. Extract template registry (web)
Move `TEMPLATES` array from OnboardingPage to `packages/web/src/lib/templates.ts`.
Add agent role metadata usable by both onboarding and project page.
- Files: `packages/web/src/lib/templates.ts`, `packages/web/src/pages/OnboardingPage.tsx`

### 3. Show template agents on project page (web)
Before task-derived agents exist, show expected agents from the template in "idle" state.
Use `project.templateId` to look up template, get agent roles.
- Files: `packages/web/src/hooks/use-agent-activity.ts`, `packages/web/src/components/project/AgentStatusCards.tsx`

### 4. Template badge on dashboard cards (web)
Show template name on each project card in the dashboard.
- Files: `packages/web/src/pages/DashboardPage.tsx`
