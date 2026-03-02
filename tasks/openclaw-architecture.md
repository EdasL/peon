# OpenClaw + Claude Code Teams: How It Actually Works

## The Key Insight

OpenClaw already uses `@mariozechner/pi-coding-agent` internally as its agent runtime. So we're not replacing pi-agent — we're replacing our **direct** usage of pi-agent with OpenClaw as the orchestration layer that wraps it. OpenClaw gives us session management, memory, skills, and multi-channel support for free.

Then, for actual coding tasks, the OpenClaw agent delegates to **Claude Code Teams** (one per project).

---

## Current Architecture (what we have now)

```
User (Slack/WhatsApp/Web)
    |
    v
Peon Gateway (our server)
    |
    v
Worker Container (1 per user)
    |
    v
pi-coding-agent (direct library call)
    - creates session
    - sends prompt
    - subscribes to events
    - streams deltas back
```

**Problem**: We manage the entire agent lifecycle ourselves — sessions, tools, instructions, model resolution, credential injection. That's a lot of code (worker.ts is 920 lines).

---

## Target Architecture (what we want)

```
User (Slack/WhatsApp/Web)
    |
    v
Peon Gateway (our server)
    |
    v
Worker Container (1 per user)
    |
    v
OpenClaw Gateway (subprocess, port 18789)
    |-- Handles: sessions, memory, instructions, tools, skills
    |-- Agent runtime: pi-coding-agent (internal)
    |-- Skills:
    |     |-- peon-tools/  (UploadUserFile, Reminders, etc.)
    |     |-- claude-team/ (DelegateToProject)
    |     '-- user-installed skills from ClawHub
    |
    '-- Per coding task:
          Claude Code CLI (spawned by claude-team skill)
          with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

---

## The Onboarding Problem

OpenClaw normally requires an **interactive onboarding wizard** (`openclaw onboard`):

1. Pick a model + enter API key
2. Set workspace directory
3. Configure gateway port + auth
4. Connect messaging channels (WhatsApp, Telegram, etc.)
5. Install as daemon (launchd/systemd)
6. Install skills

**We can't run an interactive wizard in a Docker container.** But we don't need to — OpenClaw's config is just files:

- `~/.openclaw/openclaw.json` — all configuration (JSON5 format)
- `~/.openclaw/workspace/SOUL.md` — agent personality/instructions
- `~/.openclaw/workspace/AGENTS.md` — agent definitions
- `~/.openclaw/workspace/TOOLS.md` — tool instructions
- `~/.openclaw/skills/<name>/SKILL.md` — per-skill instructions

**Solution**: We generate these files programmatically from the Peon gateway's session context. That's what the **config bridge** does.

---

## Full Lifecycle: Step by Step

### 1. Container Starts

```
worker-entrypoint.sh
    |
    |-- (1) Write ~/.openclaw/openclaw.json  (minimal bootstrap config)
    |-- (2) Write ~/.openclaw/workspace/SOUL.md
    |-- (3) Start: openclaw gateway --port 18789
    |-- (4) Wait for health check: GET http://127.0.0.1:18789/health
    |-- (5) Start: bun run src/index.ts  (our worker process)
```

The bootstrap `openclaw.json` needs at minimum:
```json5
{
  gateway: {
    port: 18789,
    bind: "127.0.0.1",
    auth: { mode: "token", token: "<random>" }
  },
  agents: {
    model: "anthropic/claude-sonnet-4-20250514"
    // Will be overridden dynamically per-request
  },
  // No channels — we don't use OpenClaw's channel connectors.
  // Messages come from our Peon gateway, not from WhatsApp/Telegram directly.
  channels: {},
  skills: {
    load: {
      extraDirs: ["/app/packages/worker/src/openclaw/skills"]
    }
  }
}
```

### 2. User Sends a Message

```
Peon Gateway --[SSE job]--> Worker Process
```

The worker receives a job via SSE with:
- `userPrompt` (base64)
- `agentOptions` (model, tools, etc.)
- `conversationId`

### 3. Worker Prepares Context

Before forwarding to OpenClaw:

1. **Fetch session context** from Peon gateway (instructions, provider config, MCP status)
2. **Update OpenClaw config** dynamically:
   - Write API key to `openclaw.json` or set env var
   - Update model if changed
   - Write gateway instructions to SOUL.md or a skill
3. **Build the effective prompt** (config notices, session summary, user message)

### 4. Worker Sends Message to OpenClaw via WebSocket

This is the key integration point. OpenClaw's gateway speaks a **WebSocket JSON protocol**:

```typescript
// Connect to OpenClaw gateway
const ws = new WebSocket("ws://127.0.0.1:18789");

// Authenticate
ws.send(JSON.stringify({
  type: "req",
  id: "auth-1",
  method: "auth.connect",
  params: { token: OPENCLAW_AUTH_TOKEN, role: "operator" }
}));

// Send message to agent
ws.send(JSON.stringify({
  type: "req",
  id: "msg-1",
  method: "agent.message",
  params: {
    message: effectivePrompt,
    sessionKey: `agent:main:peon:${conversationId}`,
    thinking: "high"  // optional
  }
}));
```

### 5. OpenClaw Processes the Message

Inside OpenClaw (we don't touch this):

1. Loads session history from `sessions.json` + JSONL files
2. Assembles system prompt from SOUL.md + AGENTS.md + TOOLS.md + eligible skills
3. Calls the configured LLM (Claude/GPT/etc.) via pi-coding-agent
4. If the model calls a tool → executes it (bash, read, write, our custom tools, etc.)
5. Streams response events back over the WebSocket

### 6. Worker Receives Events and Streams to User

```typescript
ws.on("message", (data) => {
  const frame = JSON.parse(data);

  if (frame.type === "event") {
    switch (frame.event) {
      case "agent.text_delta":
        // Stream text to user
        workerTransport.sendStreamDelta(frame.payload.delta, false);
        break;

      case "agent.tool_start":
        // Optional: show tool execution to user
        break;

      case "agent.turn_end":
        // Agent finished
        workerTransport.signalDone();
        break;

      case "agent.error":
        // Handle error
        workerTransport.signalError(new Error(frame.payload.message));
        break;
    }
  }
});
```

### 7. Claude Code Team Delegation (for coding tasks)

When the user asks for actual coding work, the OpenClaw agent (via the `claude-team` skill) spawns a Claude Code CLI process:

```
OpenClaw agent decides: "This is a coding task for project-alpha"
    |
    v
Calls DelegateToProject tool (registered via claude-team skill)
    |
    v
Spawns: claude -p "implement login page" \
  --allowedTools "Read,Edit,Write,Bash,Grep,Glob" \
  --output-format stream-json \
  --continue
    |
    v
Claude Code runs in /workspace/projects/project-alpha/
with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
    |
    v
Result flows back: Claude Code → skill → OpenClaw → Worker → User
```

---

## What the Config Bridge Does

The config bridge translates between two worlds:

| Peon Gateway (our system) | OpenClaw (their system) |
|---------------------------|------------------------|
| `agentInstructions` | → `~/.openclaw/workspace/SOUL.md` |
| `platformInstructions` | → `~/.openclaw/workspace/SOUL.md` (appended) |
| `skillsInstructions` | → `~/.openclaw/skills/gateway-skills/SKILL.md` |
| `providerConfig.defaultProvider` | → `openclaw.json` → `agents.model` |
| `providerConfig.credentialEnvVarName` | → `openclaw.json` → `agents.apiKey` or env var |
| `providerConfig.cliBackends` | → Registered as OpenClaw tools or skill |
| Custom tools (UploadUserFile, etc.) | → `~/.openclaw/skills/peon-tools/` + tool implementation |
| MCP servers | → `openclaw.json` → `tools.mcp` (if supported) |

### Dynamic Updates

The config bridge runs **on every message**, not just at startup. This handles:
- User changes their API key → update `openclaw.json`
- User changes their model → update `openclaw.json`
- User installs a new skill via Peon settings → update skills config
- Provider change detected → clear OpenClaw session

---

## Custom Tools: How They Get Into OpenClaw

Our gateway integration tools (UploadUserFile, ScheduleReminder, etc.) need to be callable by the OpenClaw agent. Two approaches:

### Option A: OpenClaw Skills with Tool Definitions (Recommended)

Each custom tool becomes an OpenClaw skill with a `SKILL.md` that describes it AND a tool implementation file:

```
~/.openclaw/skills/peon-tools/
  SKILL.md        <- Instructions for the agent
  tools.json      <- Tool definitions (name, description, parameters)
  handler.ts      <- HTTP endpoint that executes the tool
```

OpenClaw would call our handler via its tool execution system. The handler makes the same HTTP calls to the Peon gateway that our current `tool-implementations.ts` does.

### Option B: MCP Server

Run a lightweight MCP server inside the container that exposes our custom tools. OpenClaw has built-in MCP support:

```json5
// openclaw.json
{
  tools: {
    mcp: {
      "peon-gateway": {
        command: "bun",
        args: ["run", "/app/packages/worker/src/mcp-server.ts"],
        env: {
          DISPATCHER_URL: "...",
          WORKER_TOKEN: "..."
        }
      }
    }
  }
}
```

This would be cleaner long-term since MCP is a standard protocol.

---

## What Still Needs to Be Built

### Must Have (for basic flow to work)

1. **OpenClaw WebSocket client** in the worker
   - Connect to `ws://127.0.0.1:18789`
   - Authenticate with token
   - Send `agent.message` requests
   - Listen for streaming events
   - Map events to our `workerTransport` (sendStreamDelta, signalDone, etc.)

2. **Bootstrap config generator**
   - Generate `openclaw.json` at container startup (entrypoint or first run)
   - Must include: gateway config, model placeholder, skills dirs
   - API key injected dynamically per-request

3. **Config bridge updates**
   - Current: writes to `.openclaw/` in workspace
   - Needs: write to `~/.openclaw/` (which is `/workspace/.openclaw/` since `HOME=/workspace`)
   - Map session-context fields to correct OpenClaw config paths

4. **Custom tools as OpenClaw skills**
   - Either MCP server or native skill implementation
   - Tools: UploadUserFile, ScheduleReminder, GetSettingsLink, etc.

### Nice to Have (Phase 2+)

5. **Claude Code team skill refinement**
   - Better progress streaming (parse Claude Code's stream-json in real-time)
   - Team template support (fullstack, backend-only, etc.)
   - Concurrent project support

6. **Memory integration**
   - Let OpenClaw's MemorySearchManager handle long-term memory
   - Replace our ad-hoc session persistence with OpenClaw's session system

7. **ClawHub skill support**
   - Let users install community skills from ClawHub via Peon settings
   - Sync skill installation to `openclaw.json`

---

## Key Decisions Needed

1. **Custom tools approach**: MCP server vs native OpenClaw skills?
   - MCP is more standard and easier to implement
   - Native skills are tighter integration but require understanding OpenClaw's tool execution internals

2. **Session management**: Who owns sessions?
   - Currently: our worker manages session files in `.openclaw/session.jsonl`
   - Target: OpenClaw manages sessions internally (session key = `agent:main:peon:{conversationId}`)
   - We just pass the conversation ID and OpenClaw handles persistence

3. **Provider switching**: How to handle dynamic model changes?
   - Option A: Update `openclaw.json` and let OpenClaw hot-reload
   - Option B: Restart the OpenClaw gateway on provider change
   - Option C: Pass model override per-request in the `agent.message` params

4. **Multi-agent**: One OpenClaw instance per user, or per project?
   - Current plan: One per user (the Docker container), with Claude Code Teams per project
   - Alternative: Multiple OpenClaw agents in one instance (OpenClaw supports this via `agents.list`)
