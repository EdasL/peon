---
name: kanban_triage
description: Assigns unowned tasks in Claude Code teams to the most appropriate agent based on task context.
---

# Kanban Task Triage Skill

## When to Run
When a task file in `~/.claude/tasks/{team}/` has `status: "pending"` and no `owner` field.

## Steps
1. Read the task file (`subject` + `description`)
2. Read the team config from `~/.claude/teams/{team}/config.json` to get the list of agents
3. Analyze the task context against agent roles
4. Assign the task to the most appropriate agent by writing `owner` to the task JSON file
5. Skip tasks owned by `qa` — those are QA assignments, not triage targets

## Assignment Rules
- UI, design, styling, CSS, layout, theme, accessibility → designer agent
- API, database, server, backend, endpoint, route, schema, Go, SQL → backend agent
- Mobile, React Native, app, screen, navigation, iOS, Android, component → mobile agent
- If ambiguous, assign to the first non-lead, non-qa agent

## Output
Write the `owner` field to the task JSON file. Log the assignment decision.
