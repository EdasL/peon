# Claude Code Team Management

Manage per-project Claude Code teams. Each project gets its own Claude Code team
that can read, write, edit, and execute code in the project's workspace.

## Tools

### DelegateToProject
Send a coding task to your team. The lead session spawns teammates automatically.

**Parameters:**
- `projectId` (required): The project identifier (maps to /workspace/projects/{projectId})
- `task` (required): The coding task to delegate (natural language description)
- `teamMembers` (required in practice): Array of team members from your "Your Team" configuration. Each has `roleName`, `displayName`, and `systemPrompt`. Always include the full team so the lead can spawn the right teammates.
- `role` (optional): Primary role for this delegation (default: "lead")
- `allowedTools` (optional): Comma-separated list of allowed tools (default: Read,Edit,Write,Bash,Grep,Glob)

**Returns:** The result text from the Claude Code team, or an error message.

### CheckTeamStatus
Check if a project's Claude Code team is still working on a task.

**Parameters:**
- `projectId` (required): The project identifier

**Returns:** Status of the team (running, completed, or not found).

### GetTeamResult
Get the final result from a completed team task.

**Parameters:**
- `projectId` (required): The project identifier

**Returns:** The team's output text, or an error if still running.

### CreateProjectTasks
Create tasks on the project's kanban board before delegating. Tasks appear in the
Todo column and move to In Progress / Done as the team works on them.

**Parameters:**
- `projectId` (required): The project identifier
- `tasks` (required): Array of `{ subject, description?, owner? }`

**Returns:** Confirmation with created task IDs.

### ListProjectTasks
List all tasks on the current project's board. Use this to find task IDs when you
need to update or delete tasks (e.g. after a new session where IDs are lost).

**Parameters:** None.

**Returns:** Formatted list with task IDs, subjects, statuses, board columns, and owners.

### UpdateTaskStatus
Move a task between board columns. Updates the board in real time.

**Parameters:**
- `taskId` (required): The task ID (returned by CreateProjectTasks or ListProjectTasks)
- `status` (required): New status — `in_progress`, `done`, `blocked`, or `todo`
- `owner` (optional): Agent role that owns this task

**Returns:** Confirmation of the status change.

### DeleteTask
Remove a task from the project board permanently.

**Parameters:**
- `taskId` (required): The task ID to delete

**Returns:** Confirmation of deletion.

## Recommended Workflow

```
1. User sends: "Add a login page to project-alpha"
2. Orchestrator asks clarifying questions if needed (scope, tech stack, requirements)
3. User confirms the plan
4. Orchestrator calls: CreateProjectTasks(
     projectId="project-alpha",
     tasks=[
       { subject: "Create login form component", description: "..." , owner: "frontend" },
       { subject: "Add auth API endpoint", description: "...", owner: "backend" },
       { subject: "Write login tests", description: "...", owner: "qa" }
     ]
   )
5. Tasks appear on the board in the Todo column
6. Orchestrator calls: DelegateToProject(
     projectId="project-alpha",
     task="Implement the login feature as planned in the task board",
     teamMembers=[{roleName: "lead", ...}, {roleName: "frontend", ...}, ...]
   )
7. Lead session spawns teammates, coordinates the work
8. Tasks move to In Progress then Done as work completes
9. Orchestrator reports the result to the user
```

## Important

Always pass the configured team from your "Your Team" section as `teamMembers`.
Do not invent new roles — only use the roles the user configured.
Always create tasks on the board before delegating so the user can track progress.
Use ListProjectTasks to recover task IDs if you need to update or delete tasks and don't have the IDs in context.
