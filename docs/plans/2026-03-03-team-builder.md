# Team Builder — Goal-Driven Project Creation & Real Team Display

**Date**: 2026-03-03
**Team 3 Focus**: Product UX — team builder, project creation flow, command center view
**Do NOT touch**: Container bootstrap, status/restart UI, ChatPanel reconnection logic

---

## Overview

Replace the template-based project creation with a goal-driven team builder. Users describe what they want to build, Peon suggests a team composition, users customize it, then launch. The project page shows the real team members from the DB instead of hardcoded template agents.

---

## Task 1: Goal-Driven Team Builder (Project Creation Flow)

### 1A. New Onboarding Step Flow

Replace `OnboardingPage.tsx` steps from `"apikey" | "repo-template" | "launch"` to:

```
"apikey" | "name-repo" | "goal" | "team" | "launch"
```

**Step 1 — "name-repo"**: Project name + GitHub repo picker
- Project name field (required, no longer deferred to launch step)
- GitHub repo picker (reuse existing repo list or manual URL input)
- "Next" button to proceed

**Step 2 — "goal"**: Describe your goal
- Single textarea: "What do you want to build or accomplish?"
- Placeholder: "e.g. I want to build a React app with a Postgres backend"
- "Suggest team" button → runs keyword matcher → transitions to "team" step

**Step 3 — "team"**: Review & edit suggested team
- Show suggested team members as editable cards
- Each card: role name (editable input), system prompt (expandable textarea), color dot, delete button
- "Add member" button opens inline form (role + prompt)
- "Launch project" button at bottom

**Step 4 — "launch"**: Summary + launch (simplified from current)
- Shows: project name, repo, team members count
- Launch button → creates project with team

### 1B. Keyword-Based Team Suggestion Engine

New file: `packages/web/src/lib/team-suggestions.ts`

```typescript
interface SuggestedMember {
  role: string
  name: string
  prompt: string
  color: string
}

function suggestTeam(goal: string): SuggestedMember[]
```

Keyword mapping (case-insensitive, check if goal contains any):
- `react|frontend|ui|css|tailwind|component` → Lead + Frontend Engineer + QA
- `api|backend|server|database|postgres|mongo|express|node` → Lead + Backend Engineer + QA
- `fullstack|full-stack|app|web app` → Lead + Frontend Engineer + Backend Engineer + QA
- `mobile|ios|android|react native|flutter` → Lead + Mobile Engineer + QA
- Default (no keywords match) → Lead + Engineer + QA

Each role has a pre-written system prompt constant:

```typescript
const ROLE_PROMPTS: Record<string, string> = {
  lead: "You are the project lead. You coordinate the team, break down tasks into sub-tasks, assign work, and ensure delivery quality.",
  frontend: "You specialize in React, TypeScript, and Tailwind CSS. You own all UI components, pages, hooks, and styling.",
  backend: "You specialize in Node.js, APIs, and databases. You own API routes, database schema, migrations, and server logic.",
  qa: "You write and run tests, catch regressions, and review code for quality. You own the test suite.",
  mobile: "You specialize in mobile development. You own native/cross-platform implementation, navigation, and platform APIs.",
  engineer: "You are a generalist software engineer. You implement features, fix bugs, and write clean, tested code.",
}
```

Color assignments:
```
lead → bg-blue-500, frontend → bg-emerald-500, backend → bg-violet-500,
qa → bg-amber-500, mobile → bg-cyan-500, engineer → bg-zinc-500
```

### 1C. UI Components for Team Editor

New component: `packages/web/src/components/onboarding/TeamEditor.tsx`

Props:
```typescript
interface TeamEditorProps {
  members: SuggestedMember[]
  onChange: (members: SuggestedMember[]) => void
}
```

Renders:
- Grid of member cards (2 columns on wider screens)
- Each card: color dot, role input, expandable prompt textarea, delete (X) button
- "Add member" button at bottom — adds a blank member with role "Engineer" and default prompt
- Minimal, clean design matching existing Peon aesthetic

---

## Task 2: Team Data Model (Backend)

### 2A. Database Schema

Add to `packages/gateway/src/db/schema.ts`:

```typescript
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  roleName: text("role_name").notNull(),
  displayName: text("display_name").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  color: text("color").notNull().default("bg-zinc-500"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})
```

### 2B. Drizzle Migration

Generate migration `0004_team_builder.sql`:
```sql
CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "role_name" text NOT NULL,
  "display_name" text NOT NULL,
  "system_prompt" text NOT NULL,
  "color" text NOT NULL DEFAULT 'bg-zinc-500',
  "created_at" timestamp DEFAULT now() NOT NULL
);
```

### 2C. API Endpoints

New route file: `packages/gateway/src/routes/api/teams.ts`

**POST /api/projects/:id/teams** — Create a team with members
```json
Request: { "name": "Default Team", "members": [{ "roleName": "lead", "displayName": "Lead", "systemPrompt": "...", "color": "bg-blue-500" }] }
Response: { "team": { id, projectId, name, createdAt, members: [...] } }
```

**GET /api/projects/:id/teams** — List teams for a project (with members)
```json
Response: { "teams": [{ id, projectId, name, createdAt, members: [{ id, roleName, displayName, systemPrompt, color }] }] }
```

**POST /api/teams/:id/members** — Add a member to a team
```json
Request: { "roleName": "designer", "displayName": "Designer", "systemPrompt": "...", "color": "bg-pink-500" }
Response: { "member": { id, teamId, roleName, displayName, systemPrompt, color } }
```

**DELETE /api/teams/:id/members/:memberId** — Remove a member
```json
Response: { "ok": true }
```

### 2D. Update Project Creation

Modify `POST /api/projects` to accept optional `team` field:
```json
{ "name": "My App", "repoUrl": "...", "team": { "name": "Default Team", "members": [...] } }
```

When `team` is provided:
1. Create project record
2. Create team record linked to project
3. Create team_member records
4. Generate CLAUDE.md using team member prompts instead of template prompts
5. Continue with container provisioning

Make `templateId` optional on the projects table (default to "custom" for goal-driven projects).

### 2E. Update Project Launcher

Modify `initProjectWorkspace()` to accept team members instead of just templateId. Build the CLAUDE.md team prompt from the actual member roles and prompts:

```
### Agents
- **frontend** (Frontend Engineer) — You specialize in React...
- **backend** (Backend Engineer) — You specialize in Node.js...
- **qa** (QA Engineer) — You write and run tests...
```

---

## Task 3: Show Real Team in Project Page

### 3A. Frontend API Client

Add to `packages/web/src/lib/api.ts`:

```typescript
export interface TeamMember {
  id: string
  roleName: string
  displayName: string
  systemPrompt: string
  color: string
}

export interface Team {
  id: string
  projectId: string
  name: string
  members: TeamMember[]
}

export const getProjectTeams = (projectId: string) =>
  request<{ teams: Team[] }>(`/api/projects/${projectId}/teams`)
```

### 3B. Update AgentSidebar

Replace template-derived agent display with DB-backed team members:

1. `ProjectPage.tsx` fetches teams via `getProjectTeams(projectId)` on mount
2. Pass `teamMembers: TeamMember[]` to AgentSidebar instead of `templateId`
3. AgentSidebar maps each TeamMember to an agent card:
   - Name = `displayName`
   - Color = `color` field from DB
   - Status = match against `agents` array from `useAgentActivity` by `roleName`
4. If no team exists → show "Set up your team" CTA linking to onboarding/team editor

### 3C. Update useAgentActivity

Currently `templateAgentNames` is passed to seed idle agents when no tasks exist.
Change to accept `teamMemberNames: string[]` from the DB team members instead of template.
Match SSE `agentName` to team member `roleName` (lowercased).

---

## Task 4: Needs Attention / Blocker Panel

### 4A. Frontend Component

New component: `packages/web/src/components/project/NeedsAttention.tsx`

Renders above the board/chat area in ProjectPage when there are blockers:

```
┌─ Needs your attention ──────────────────────┐
│ 🔸 Team has gone quiet (no activity 5+ min) │
│ 🔸 backend: "What database should I use?"   │
│ 🔸 Task "Set up auth" stuck 30+ min         │
└─────────────────────────────────────────────┘
```

Each blocker is a card with:
- Agent name + color dot
- Reason text
- Dismiss (X) button
- Click → scrolls to / focuses chat

### 4B. Blocker Detection Logic (Frontend)

New hook: `packages/web/src/hooks/use-blockers.ts`

Takes: `agents`, `feed`, `tasks`, `chatMessages` (from existing hooks)

Detects:
1. **Idle too long**: If project is "running" and no `agent_activity` SSE event received for 5+ minutes → "Team has gone quiet"
2. **Question in chat**: If a chat message from "assistant" role ends with "?" or contains "blocked", "waiting", "need input", "could you", "please clarify" → surface as blocker with the message content
3. **Stuck task**: If a task has been `in_progress` for 30+ minutes (compare `updatedAt` to now) → "Task X stuck for Y minutes"

Each blocker has:
```typescript
interface Blocker {
  id: string
  agentName?: string
  type: "idle" | "question" | "stuck_task"
  message: string
  taskId?: string
  dismissedAt?: number
}
```

Dismissed blockers are stored in component state (not persisted — reset on page refresh is fine).

### 4C. SSE Event (Optional Enhancement)

Add `agent_blocked` SSE event type to gateway for future use:
```json
{ "type": "agent_blocked", "agentName": "backend", "reason": "Asking a question", "taskId": "..." }
```

For now, frontend-side detection is sufficient. The SSE event can be added when the agent system can detect blockers server-side.

---

## Task 5: Template Cleanup

### 5A. Make templateId Optional

- Alter `projects.templateId` to be nullable (migration)
- Update `POST /api/projects` to not require templateId when team is provided
- Update frontend `CreateProjectInput` type

### 5B. Remove Template Picker from Onboarding

- The new flow replaces the template picker entirely
- Keep `TEMPLATES` constant and `templates.ts` as internal reference (used by existing projects)
- Keep `TEMPLATE_TEAM_PROMPTS` in project-launcher.ts for backward compatibility with existing projects
- Remove template picker UI from OnboardingPage

### 5C. Update DashboardPage

- Replace template dot display on project cards with actual team member dots from DB
- Fetch team data alongside projects (or include in project response)

---

## File Ownership

### Backend engineer owns:
- `packages/gateway/src/db/schema.ts` — add teams + teamMembers tables
- `packages/gateway/drizzle/0004_*.sql` — migration
- `packages/gateway/src/routes/api/teams.ts` — new route file
- `packages/gateway/src/routes/api/projects.ts` — update project creation
- `packages/gateway/src/web/project-launcher.ts` — update CLAUDE.md generation

### Frontend engineer owns:
- `packages/web/src/lib/team-suggestions.ts` — new file, suggestion engine
- `packages/web/src/components/onboarding/TeamEditor.tsx` — new component
- `packages/web/src/pages/OnboardingPage.tsx` — rewrite flow
- `packages/web/src/components/project/AgentSidebar.tsx` — use real team data
- `packages/web/src/components/project/NeedsAttention.tsx` — new component
- `packages/web/src/hooks/use-blockers.ts` — new hook
- `packages/web/src/pages/ProjectPage.tsx` — integrate team + blockers
- `packages/web/src/lib/api.ts` — add team API calls + types
- `packages/web/src/pages/DashboardPage.tsx` — show real team dots

---

## Build Sequence

1. **Backend: DB schema + migration** (no frontend dependency)
2. **Backend: Teams API endpoints** (depends on 1)
3. **Backend: Update project creation + launcher** (depends on 2)
4. **Frontend: Team suggestion engine** (no backend dependency)
5. **Frontend: TeamEditor component** (depends on 4)
6. **Frontend: Rewrite OnboardingPage** (depends on 4, 5)
7. **Frontend: API client updates** (depends on 2)
8. **Frontend: AgentSidebar + ProjectPage updates** (depends on 7)
9. **Frontend: NeedsAttention + use-blockers** (no backend dependency)
10. **Frontend: DashboardPage updates** (depends on 7)
11. **Typecheck + verify** (depends on all)

Steps 1-3 (backend) and 4-6 (frontend) can run in parallel.
Steps 7-10 depend on backend being done.
Step 9 can run in parallel with 7-8.
