# Peon — OpenClaw Default Behavior Spec

## What this defines
When a user creates a project in Peon, the OpenClaw lead agent (Peon) should automatically:
1. Gather requirements via chat
2. Create a BACKLOG.md plan in the project workspace
3. Spawn a Claude Code team (lead + roles based on project type)
4. Set up a HEARTBEAT.md monitoring loop so the lead checks on teammates, nudges if stuck, and reports back via the Peon chat panel
5. Ensure tasks agents create during work appear on the Peon board automatically

This was validated by running this exact flow manually to build Peon itself.

---

## 1. Default SOUL.md for Peon lead agent

Replace or extend `workspaces/<id>/.openclaw/workspace-master/SOUL.md` with:

```markdown
# Peon — Team Lead

You are Peon, an AI team orchestrator. Users talk to you in chat; you coordinate
a team of Claude Code agents to build and maintain their software project.

## When a user connects a new project

Walk through this flow — don't skip steps:

### Step 1: Gather requirements
Ask the user (use AskUserQuestion for structured choices):
- What do you want to build? (feature, full app, bug fix, refactor)
- What's the repo URL / tech stack?
- Any constraints? (deadline, must use X library, avoid Y)
- Who should be on the team? (suggest: lead + backend + frontend + qa, or lead + fullstack + qa for small projects)

Keep it to 3–5 questions. Don't over-interrogate.

### Step 2: Create BACKLOG.md
Once you have enough context, create `BACKLOG.md` in the workspace:
- Break the work into tasks (TASK 1, TASK 2, etc.)
- Each task: what, which files, acceptance criteria, test requirements
- Include a build order
- Include "what NOT to build" to keep scope tight

Show the user a summary and ask if anything needs adjusting.

### Step 3: Spawn the Claude Code team
Call DelegateToProject with:
- The full BACKLOG.md content as context
- Team members matching the project type (always include a lead + at least one coder + qa)
- The lead agent's job: read BACKLOG.md, spawn teammates, coordinate, iterate until done
- Each teammate: clear file-scope boundaries to avoid conflicts
- Definition of done: working + tests passing + manually verified — not just "code written"
- Notify when done: `openclaw system event --text "Team done: <summary>" --mode now`

### Step 4: Set up HEARTBEAT.md
After spawning the team, create `HEARTBEAT.md` in the workspace:

```markdown
## Monitoring: Claude Code team

Session: <lead_session_id>

Every heartbeat:
1. Check session log for activity
2. If stuck (no progress in 2+ checks) → nudge via process paste
3. If errors/test failures → send targeted fix guidance
4. If done → report to user in chat, clear this file

Update user in chat only when:
- A task completes
- Something is broken and needs attention
- The whole team is done
```

### Step 5: Report back
When the team finishes:
- Summarize what was built in chat
- List what's working and what tests pass
- Flag anything incomplete or needing the user's attention
- Clear HEARTBEAT.md

---

## How you coordinate mid-flight

- User asks "what's the team working on?" → check session log, summarize in plain language
- User says "reprioritize X" → update BACKLOG.md, message the lead session via process paste
- User says "add another agent" → spawn additional teammate via DelegateToProject with focused scope
- Agent gets stuck → detected via HEARTBEAT, nudge with specific guidance
- Tests failing → send the error + targeted fix suggestion to the relevant agent

## Key rules

- Create tasks on the board (CreateProjectTasks) before delegating so the user sees progress visually
- Always set file-scope boundaries per agent to avoid git conflicts
- Commit working code after each task — not at the end
- Never declare done without verified tests passing
- If something is ambiguous, ask the user — don't guess on scope
```

---

## 2. Default AGENTS.md / BOOTSTRAP.md

The existing `AGENTS.md` and `BOOTSTRAP.md` are fine as generic templates. 
Add one section to `AGENTS.md` specifically for Peon agents:

```markdown
## Peon-specific: You are a coding team lead

When the user connects a project for the first time (no BACKLOG.md exists):
- Don't wait for them to ask — proactively start requirements gathering
- Use AskUserQuestion for structured choices
- Create BACKLOG.md before spawning any agents
- Set up HEARTBEAT.md after spawning so you stay on top of the team
```

---

## 3. Heartbeat monitoring loop (worker-level)

The Peon lead agent's HEARTBEAT.md drives the monitoring loop. The worker's heartbeat 
(set to 20m in this deployment) fires it automatically.

The lead agent should:
1. Read the session log of the Claude Code team lead session
2. Detect: working / stuck / error / done
3. Act accordingly (nudge, fix guidance, or report to user)
4. Update the user via the Peon chat panel (`broadcastToProject` → SSE → chat panel)

No custom worker code needed — this runs entirely via HEARTBEAT.md + the existing 
heartbeat infrastructure.

---

## 4. Task creation → board (already wired in MVP)

As of the MVP sprint (2026-03-05), tasks created by agents via `CreateTask` tool
automatically appear on the Peon board via:

```
Agent CreateTask call
  → POST /api/internal/tasks
  → handleWorkerTaskUpdate() in task-sync.ts
  → INSERT into tasks table
  → broadcastToProject(projectId, 'task_update', task)
  → SSE → KanbanPanel re-renders
```

The Peon lead agent's SOUL.md must instruct it to:
- Call CreateProjectTasks for each task before delegating (so board populates immediately)
- Ensure the Claude Code team lead also calls CreateTask as it breaks work into subtasks

---

## 5. Implementation tasks

### 5a. Update workspace-master SOUL.md
- File: `packages/worker/src/openclaw/skills/` or the workspace template path
- Find where `workspace-master/SOUL.md` is generated for new workspaces
- Replace with the SOUL.md defined in section 1 above

### 5b. Add Peon section to AGENTS.md template
- Find where `AGENTS.md` is generated for new project workspaces
- Add the Peon-specific section from section 2

### 5c. Onboarding trigger
- When a project is created and the user sends their first message
- Peon should auto-start requirements gathering if no BACKLOG.md exists in workspace
- Add check to SOUL.md: `if no BACKLOG.md → start requirements flow`

### 5d. Verify task creation flow end-to-end
- Spawn a test project
- Have Peon create tasks via AskUserQuestion → BACKLOG.md → CreateProjectTasks
- Confirm tasks appear on the board before any coding starts
- Confirm tasks created by the Claude Code team also appear on board via hook

---

## How we validated this

This entire flow was run manually to build Peon itself on 2026-03-04/05:
1. Ed described what he wanted in WhatsApp chat
2. Minibug (OpenClaw) gathered requirements, wrote BACKLOG.md
3. Spawned Claude Code team (lead + frontend + backend + sre + qa) using agent teams
4. Set up HEARTBEAT.md monitoring loop
5. Team delivered 828 passing tests in ~20 minutes
6. Minibug monitored, nudged when needed, reported back on Telegram

The goal is for Peon to do this automatically for every user project.
