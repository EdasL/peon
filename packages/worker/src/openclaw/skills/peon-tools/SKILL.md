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

## Notes

- UploadUserFile is the primary way to share generated content with users
- GetSettingsLinkForDomain should be called when network requests fail with 403
- AskUserQuestion ends the current session; the user's response arrives as a new message
