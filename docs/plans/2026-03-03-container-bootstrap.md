# Container Bootstrap Sprint

**Goal:** Wire up project-scoped chat context, bootstrap OpenClaw skills + Claude Code plugins in containers, auto-init CLAUDE.md per project, and replace raw subprocess spawn with tmux-based Claude Code launch.

**Architecture:** One container per USER (not per project). One OpenClaw per user, always running. Projects live at `/workspace/projects/<project-id>/`.

---

## Task 1: Project-Scoped Chat Context Injection (BACKEND)

**Problem:** Chat messages go to OpenClaw as raw text. When user is on a specific project page, OpenClaw has no idea which project they're working on or what state it's in.

**Current flow (`packages/gateway/src/web/chat-routes.ts` lines 88-153):**
1. User sends message via `POST /api/projects/:id/chat`
2. Message stored in Postgres
3. `setActiveProject(peonAgentId, projectId)` tracks which project is active
4. Message enqueued via `queueProducer.enqueueMessage({ messageText: content, ... })`
5. OpenClaw receives raw `content` — no project context

**Fix:** Before enqueuing, prepend a context block to the message text:

```typescript
// Build project context prefix
const projectTasks = await getProjectTasks(projectId)
const taskSummary = projectTasks.map(t => `- [${t.status}] ${t.subject} (${t.owner || 'unassigned'})`).join('\n')

const contextPrefix = `[Project Context]
Project: ${project.name} (${projectId})
Template: ${project.templateId}
${project.repoUrl ? `Repo: ${project.repoUrl}` : ''}
Workspace: /workspace/projects/${projectId}

Current tasks:
${taskSummary || '(none)'}
[End Context]

`

const messageText = contextPrefix + content
```

**Files:**
- Modify: `packages/gateway/src/web/chat-routes.ts` — inject context in POST /:id/chat handler
- Read: `packages/gateway/src/web/task-sync.ts` — import `getProjectTasks`

**Rules:**
- Only inject context when message comes from a project page (projectId is present)
- Context is a prefix, not a system message — OpenClaw sees it as part of the user message
- Keep it concise — task titles + statuses only, no descriptions

---

## Task 2: Container Bootstrap — OpenClaw Skills (INFRA)

**Problem:** Containers boot with no OpenClaw skills installed. Need baseline skill set.

**Current state:** `bootstrap-config.ts` writes `openclaw.json` with `skills.load.extraDirs` pointing to local source directory. Skills are not installed from a registry.

**Skills to install:** coding-agent, github, tmux, summarize, oracle, clawhub

**Approach:** Add skill installation to the worker entrypoint script after OpenClaw gateway is running and healthy. Use `openclaw skill install <name>` CLI.

**Files:**
- Modify: `packages/worker/scripts/worker-entrypoint.sh` — add skill install block after OpenClaw health check passes
- Possibly modify: `packages/worker/src/openclaw/bootstrap-config.ts` — if skills need config entries

**Implementation in entrypoint.sh (after OpenClaw health check):**
```bash
echo "📦 Installing OpenClaw skills..."
SKILLS="coding-agent github tmux summarize oracle clawhub"
for skill in $SKILLS; do
  openclaw skill install "$skill" 2>/dev/null || echo "  ⚠️ Skill $skill not available"
done
echo "✅ Skills installed"
```

---

## Task 3: Container Bootstrap — Claude Code Plugins (INFRA)

**Problem:** Claude Code launches with no plugins configured. Need specific plugin set + settings.

**Current state:** Entrypoint writes `~/.claude/.credentials.json` for auth. No `settings.json` exists.

**Files:**
- Modify: `packages/worker/scripts/worker-entrypoint.sh` — write `~/.claude/settings.json` before worker starts

**Implementation (add after credential writing, before OpenClaw bootstrap):**
```bash
echo "⚙️ Writing Claude Code settings..."
CLAUDE_CONFIG_DIR="${HOME:-/workspace}/.claude"
mkdir -p "$CLAUDE_CONFIG_DIR"
cat > "$CLAUDE_CONFIG_DIR/settings.json" << 'SETTINGSEOF'
{
  "model": "opus",
  "enabledPlugins": {
    "frontend-design@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    "code-review@claude-plugins-official": true,
    "github@claude-plugins-official": true,
    "feature-dev@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "playwright@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": true,
    "superpowers@claude-plugins-official": true,
    "figma@claude-plugins-official": true
  },
  "skipDangerousModePermissionPrompt": true,
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
SETTINGSEOF
chmod 644 "$CLAUDE_CONFIG_DIR/settings.json"
```

**Must happen before Claude Code is first invoked** (i.e., before the worker process starts).

---

## Task 4: Per-Project Init — claude init (INFRA)

**Problem:** When a project repo is cloned into the container, it may not have a CLAUDE.md. Need to auto-run `claude init`.

**Current state:** `project-launcher.ts:initProjectWorkspace()` sends a system message to the agent asking it to create directories and write CLAUDE.md. The actual workspace setup happens inside the container via the agent itself. The `DelegateToProject` tool in `peon-gateway/index.ts` creates a placeholder CLAUDE.md if missing.

**Better approach:** In the peon-gateway plugin's `DelegateToProject`, after ensuring workspace exists and before spawning Claude Code, check for CLAUDE.md and run `claude init` if missing:

**Files:**
- Modify: `packages/worker/src/openclaw/plugins/peon-gateway/index.ts` — add claude init check in `delegateToProject()` before spawn

**Implementation:**
```typescript
// After mkdir for projectDir and .claude dir, before spawn:
const claudeMdPath = join(projectDir, 'CLAUDE.md')
const dotClaudeMdPath = join(projectDir, '.claude', 'CLAUDE.md')
const hasCLAUDEmd = await stat(claudeMdPath).then(() => true, () => false)
                  || await stat(dotClaudeMdPath).then(() => true, () => false)

if (!hasCLAUDEmd) {
  // Run claude init non-interactively
  const initResult = spawnSync('claude', ['init', '--yes'], {
    cwd: projectDir,
    stdio: 'pipe',
    timeout: 30000,
    env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
  })
  if (initResult.status !== 0) {
    logger.warn(`claude init failed for ${params.projectId}: ${initResult.stderr?.toString()}`)
  }
}
```

**Note:** `claude init --yes` (or equivalent non-interactive flag) must be used. If no such flag exists, write a minimal CLAUDE.md directly instead.

---

## Task 5: tmux-Based Claude Code Launch (INFRA)

**Problem:** `spawn("claude", ["-p", task, ...])` breaks because Claude Code is an interactive terminal app that needs a TTY. tmux provides the TTY.

**Current state:** `peon-gateway/index.ts:delegateToProject()` uses `spawn()` with `stdio: ["ignore", "pipe", "pipe"]`.

**New approach from Ed:**
```
tmux new-session -d -s peon-<project-id> -c <workspace>
tmux send-keys -t peon-<project-id> 'claude --dangerously-skip-permissions --teammate-mode in-process' Enter
# Wait for Claude to be ready (watch for prompt)
# Send task via tmux send-keys
# Stream output by capturing the pane
```

**Files:**
- Modify: `packages/worker/src/openclaw/plugins/peon-gateway/index.ts` — replace spawn with tmux
- Create: `packages/worker/src/openclaw/tmux-manager.ts` — tmux session lifecycle utility

**tmux-manager.ts API:**
```typescript
interface TmuxSession {
  sessionName: string
  projectId: string
  startedAt: number
  ready: boolean
}

// Create a new tmux session
function createSession(projectId: string, cwd: string): Promise<TmuxSession>

// Send keys to a session
function sendKeys(sessionName: string, keys: string): Promise<void>

// Capture pane output
function capturePane(sessionName: string): Promise<string>

// Wait for Claude to be ready (poll pane for prompt indicator)
function waitForReady(sessionName: string, timeoutMs?: number): Promise<boolean>

// Kill a session
function killSession(sessionName: string): Promise<void>

// List active sessions
function listSessions(): Promise<TmuxSession[]>
```

**delegateToProject() rewrite:**
```typescript
// 1. Create tmux session
const sessionName = `peon-${params.projectId}`
await execAsync(`tmux new-session -d -s ${sessionName} -c ${projectDir}`)

// 2. Start Claude Code in the session
await execAsync(`tmux send-keys -t ${sessionName} 'claude --dangerously-skip-permissions --teammate-mode in-process' Enter`)

// 3. Wait for Claude to be ready
await waitForReady(sessionName, 30000)

// 4. Send the task
await execAsync(`tmux send-keys -t ${sessionName} ${escapeForTmux(params.task)} Enter`)

// 5. Stream output via pane capture (poll every 200ms)
const pollInterval = setInterval(async () => {
  const output = await capturePane(sessionName)
  // Parse for new content, emit events
}, 200)

// 6. Detect completion (Claude returns to prompt or exits)
// Clean up session on completion
```

**Output parsing:** Since we're no longer using `--output-format stream-json`, we need to parse terminal output directly. `--teammate-mode in-process` may provide structured output. Investigate what this mode outputs.

**Fallback:** If `--teammate-mode in-process` provides structured JSON output, use `tmux pipe-pane` to capture it to a file and tail that file for events.

---

## Execution Order

**Phase 1 (parallel, no dependencies):**
- BACKEND: Task 1 (project-scoped chat context)
- INFRA: Task 3 (Claude Code settings.json) — simplest, pure entrypoint edit
- INFRA: Task 2 (OpenClaw skills) — entrypoint edit after health check

**Phase 2 (after Phase 1):**
- INFRA: Task 4 (claude init per project) — needs settings.json from Task 3 to exist
- INFRA: Task 5 (tmux launch) — most complex, requires investigation of --teammate-mode

---

## Team Assignment

| Task | Agent | Priority |
|------|-------|----------|
| 1. Project-scoped chat context | backend-dev | P0 |
| 2. OpenClaw skills bootstrap | infra-dev | P1 |
| 3. Claude Code settings.json | infra-dev | P0 |
| 4. Per-project claude init | infra-dev | P1 |
| 5. tmux Claude Code launch | infra-dev | P0 |
