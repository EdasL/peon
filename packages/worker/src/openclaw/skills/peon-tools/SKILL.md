# Peon Gateway Tools

Integration tools for the Peon gateway. These tools allow the orchestrator
to interact with the user through the platform (Slack, WhatsApp, Telegram, Web).

## Available Tools

- **UploadUserFile** — Share files (charts, reports, images, documents) with the user
- **ScheduleReminder** — Schedule one-time or recurring tasks via delayMinutes or cron
- **CancelReminder** — Cancel a previously scheduled reminder by scheduleId
- **ListReminders** — List all pending reminders
- **SearchExtensions** — Search for installable skills and MCP servers
- **InstallExtension** — Generate install link for a skill or MCP server
- **GetSettingsLink** — Generate a settings link for user configuration
- **GetSettingsLinkForDomain** — Request domain access approval (for blocked proxy domains)
- **GenerateAudio** — Text-to-speech generation
- **GetChannelHistory** — Fetch previous messages from the conversation thread
- **AskUserQuestion** — Post a question with clickable button options
- **CreateProjectTasks** — Create tasks on a project's kanban board (Todo column) before delegating work. Use this to break a user request into well-defined tasks that the user can see and track.
- **ListProjectTasks** — List all tasks on the current project's board with IDs, subjects, statuses, and owners. Use to find task IDs for updating or deleting.
- **UpdateTaskStatus** — Move a task between board columns (in_progress, done, blocked, todo). Requires the task ID.
- **DeleteTask** — Remove a task from the project board permanently. Requires the task ID.
- **DelegateToProject** — Send a coding task to your team. Always include the full configured team as teamMembers.
- **CheckTeamStatus** — Check if a Claude Code team is still working
- **GetTeamResult** — Get the result from a completed team task

## Notes

- UploadUserFile is the primary way to share generated content with users
- GetSettingsLinkForDomain should be called when network requests fail with 403
- AskUserQuestion ends the current session; the user's response arrives as a new message
- When calling DelegateToProject, always pass teamMembers from your "Your Team" configuration
- Before delegating, use CreateProjectTasks to add planned tasks to the board so the user can track progress
