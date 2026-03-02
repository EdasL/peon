# Claude Code Team Management

Manage per-project Claude Code teams. Each project gets its own Claude Code team
that can read, write, edit, and execute code in the project's workspace.

## Tools

### DelegateToProject
Send a coding task to a project's Claude Code team. The team will execute the
task in the project's workspace directory and stream progress back.

**Parameters:**
- `projectId` (required): The project identifier (maps to /workspace/projects/{projectId})
- `task` (required): The coding task to delegate (natural language description)
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

## Usage

```
1. User sends: "Add a login page to project-alpha"
2. Orchestrator calls: DelegateToProject(projectId="project-alpha", task="Add a login page with email/password form")
3. Claude Code team executes in /workspace/projects/project-alpha/
4. Progress streams back to the orchestrator
5. Orchestrator reports the result to the user
```
