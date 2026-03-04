# Peon — Product Spec (MVP)

Three things:

1. Create a Claude Code team
2. Give them tasks via chat
3. See what they're working on via the board

---

## Dashboard

Project list. That's it.

```
┌─────────────────────────────────────────┐
│  peon                          Settings  │
├─────────────────────────────────────────┤
│                                         │
│  Your Projects                   [+ New]│
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ acme-saas              ● Running  │  │
│  │ 3 agents · 2m ago                │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ portfolio-site          ● Running  │  │
│  │ 2 agents · 15m ago               │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ml-pipeline             ○ Stopped  │  │
│  │ 5 agents · 2d ago                │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

Each card: name, status dot, agent count, last active time.
Click a card → Project page.
"+ New" → onboarding flow.

## No chat on dashboard.

## Project Page

Two views: **Chat** and **Board**. Team panel on the left.

### Chat view (default)

```
┌──────────────────────────────────────────────────────┐
│  ← Back   acme-saas   ● Running              [avatar]│
├────────┬──────────────────────────────────────────────┤
│        │  Chat  │  Board                              │
│  Team  │──────────────────────────────────────────────│
│        │                                              │
│  lead  │  🤖 Peon                                    │
│  ● ▓▓  │  I've analyzed the repo. Here's what I see: │
│        │  - Express backend, no auth yet              │
│  back  │  - React frontend, basic scaffolding         │
│  ● ▓░  │  - No tests                                 │
│        │                                              │
│  web   │  What do you want me to build?              │
│  ○     │                                              │
│        │  You                                         │
│  qa    │  Add GitHub OAuth login                     │
│  ○     │                                              │
│        │  🤖 Peon                                    │
│ [+][↻] │  On it. Breaking this into tasks now.       │
│        │                                              │
│        │  [Message your team...]              [➤]    │
└────────┴──────────────────────────────────────────────┘
```

### Board view

```
┌──────────────────────────────────────────────────────┐
│  ← Back   acme-saas   ● Running              [avatar]│
├────────┬──────────────────────────────────────────────┤
│        │  Chat  │  Board                              │
│  Team  │──────────────────────────────────────────────│
│        │                                              │
│  lead  │  To Do      In Progress    Done              │
│  ● ▓▓  │                                              │
│        │  ┌────────┐ ┌────────┐    ┌────────┐         │
│  back  │  │Add test│ │Auth mod│    │DB setup│         │
│  ● ▓░  │  │qa      │ │back  ● │    │backend │         │
│        │  └────────┘ └────────┘    └────────┘         │
│  web   │             ┌────────┐    ┌────────┐         │
│  ○     │  ┌────────┐ │Login UI│    │API rout│         │
│        │  │Lint fix│ │web   ● │    │backend │         │
│  qa    │  │qa      │ └────────┘    └────────┘         │
│  ○     │  └────────┘                                  │
│ [+][↻] │                                              │
└────────┴──────────────────────────────────────────────┘
```

### Left panel — Team

List of Claude Code team agent sessions:

- Agent name
- Status: green filled = working, green hollow = idle, red = error
- Thin token usage bar (how much context window is used)

Footer: [+] spawn agent, [↻] refresh list.

### Center — Chat

User talks to Peon. Peon coordinates the team. When user asks for something, Peon breaks it into tasks — those tasks appear on the Board automatically. No approval step.

### Center — Board

Read-only kanban. Columns: **To Do**, **In Progress**, **Done**.

Each card: title, owner agent, active dot if agent is working on it.

User cannot create, edit, delete, or drag tasks. The board is a window into what the team is doing. If the user wants to change priorities, they say so in chat.

---

## How It Works

```
User: "Add GitHub OAuth"
  │
  ▼
Peon (lead agent) receives message via OpenClaw
  │
  ▼
Peon analyzes, breaks into subtasks
  │
  ▼
Peon creates tasks (via TodoWrite/TaskCreate)
  ──► Tasks appear on Board as "To Do"
  │
  ▼
Peon assigns tasks to team agents (backend, web, qa)
  │
  ▼
Agents pick up tasks ──► Board: "In Progress"
  │
  ▼
Agents work (edit files, run commands, etc.)
  │
  ▼
Agents finish ──► Board: "Done"
  │
  ▼
Peon reports back in chat: "All done. Here's what was built..."
```

OpenClaw orchestrates the sessions. It knows if agents are running or idle. The tasks themselves are how we see what Claude Code is actually doing — each agent's current task tells the user what's happening.

---
