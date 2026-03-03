# AI Agent Platform - Completion Tasks

**Goal:** Complete the transformation from chat interface to real AI agents that proactively work on projects with visible progress.

## Priority 1: Agent Proactive Initialization 🤖

### Task 1.1: Agent First Message on Project Load
**Problem:** When user opens a project, they have to initiate conversation. Agent should introduce itself.

**Files to modify:**
- `packages/gateway/src/web/chat-routes.ts` - Add project load detection
- `packages/gateway/src/peon/agent-helper.ts` - Add proactive message sending

**Implementation:**
1. Detect when user first opens project page (no existing chat messages)
2. Auto-enqueue welcome message from team lead agent
3. Message includes: agent identity, project understanding, current status
4. Template: "Hi! I'm [Agent Name], your [role] for this project. I can see we're working on [project name] using [tech stack from repo analysis]. Let me start by understanding what we need to accomplish..."

### Task 1.2: Agent Identity from Team Configuration  
**Problem:** Agents have generic identity. Should reflect their specific team role.

**Files to modify:**
- `packages/worker/src/openclaw/agent-registry.ts` - Use team member data for SOUL.md
- `packages/gateway/src/web/project-launcher.ts` - Pass team member info to agent creation

**Implementation:**
1. When creating project agent, use team member's `systemPrompt` and `displayName` for SOUL.md
2. Update `ensureProjectAgent()` to accept team member configuration
3. Agent SOUL.md should be role-specific: "You are [displayName]. [systemPrompt]. Your current project is [projectName]..."

## Priority 2: Repository Auto-Sync 📁

### Task 2.1: Auto-Clone Repo on Project Launch
**Problem:** Agent workspace is empty. Should automatically have latest repo code.

**Files to modify:**
- `packages/worker/src/openclaw/worker.ts` - Add repo cloning to workspace setup
- `packages/gateway/src/web/project-launcher.ts` - Pass repo info to worker

**Implementation:**
1. In worker execution, after workspace setup, clone project repo 
2. Use encrypted GitHub token from user's credentials
3. Clone to `/workspace/projects/{projectId}/repo/` 
4. Set working directory to cloned repo
5. Handle private repos with user's GitHub access token

### Task 2.2: Auto-Pull Latest Changes
**Problem:** Repo might become stale. Need periodic sync.

**Files to modify:**
- Create: `packages/worker/src/openclaw/repo-sync.ts` - Repo sync utilities
- `packages/worker/src/openclaw/worker.ts` - Call sync on session start

**Implementation:**
1. Before each agent session, check if repo exists and pull latest
2. Handle merge conflicts gracefully (preserve local agent changes)
3. Notify agent of any changes: "I've pulled the latest changes from main branch. [X] files were updated."

## Priority 3: Enhanced Claude Code Integration 🔧

### Task 3.1: Verify Claude Code Teams Are Working
**Problem:** Need to confirm real Claude Code agents are spawning, not just chat.

**Files to verify/fix:**
- `packages/worker/src/openclaw/plugins/peon-gateway/index.ts` - Check `delegateToProject()` 
- `packages/worker/scripts/worker-entrypoint.sh` - Verify Claude Code settings

**Implementation:**
1. Test that `DelegateToProject` tool actually spawns Claude Code with `--teammate-mode in-process`
2. Verify tmux sessions are created and managed properly
3. Ensure team coordination messages work between agent sessions
4. Test that multiple team members can work in parallel

### Task 3.2: Agent Team Coordination
**Problem:** Team members should coordinate work, not duplicate effort.

**Files to modify:**
- `packages/worker/src/openclaw/plugins/peon-gateway/index.ts` - Add team coordination
- Create: `packages/worker/src/openclaw/team-coordination.ts` - Cross-agent messaging

**Implementation:**
1. When delegating task to team member, include context about what other agents are doing
2. Implement agent-to-agent status updates through shared task board
3. Prevent duplicate work through task claiming mechanism

## Priority 4: Real-Time Progress Visibility 📊

### Task 4.1: File Change Notifications
**Problem:** User doesn't see when agents make code changes.

**Files to modify:**
- `packages/worker/src/openclaw/processor.ts` - Detect file operations
- `packages/gateway/src/routes/internal/agent-activity.ts` - Enhanced events
- `packages/web/src/components/project/ActivityFeed.tsx` - File change UI

**Implementation:**
1. Parse Claude Code's tool usage for Read/Write/Edit operations
2. Broadcast file change events: "backend edited `src/api/users.ts` - added authentication middleware"
3. Show file tree changes in activity feed
4. Link file paths to allow user to view changes

### Task 4.2: Git Commit Notifications
**Problem:** User doesn't know when work is committed/pushed.

**Files to modify:**
- `packages/worker/src/openclaw/tools.ts` - Add git monitoring
- Create: `packages/worker/src/openclaw/git-watcher.ts` - Git event detection

**Implementation:**
1. Monitor git operations in agent workspace
2. Auto-commit agent changes with proper attribution: "feat: add user authentication (by backend-agent)"
3. Broadcast commit notifications to UI: "🔀 backend committed 3 files: Added user authentication system"
4. Show commit history in project timeline

### Task 4.3: Task Progress Automation
**Problem:** Tasks aren't automatically updated when agents work.

**Files to modify:**
- `packages/worker/src/openclaw/task-bridge.ts` - Create task automation
- `packages/gateway/src/web/task-sync.ts` - Enhanced task updates

**Implementation:**
1. Auto-create tasks when agents start working on something
2. Move tasks through board columns based on agent status
3. Mark tasks complete when agent says they're done
4. Agent should announce: "✅ Completed task: Set up user authentication API"

## Priority 5: Agent Lifecycle Management 🔄

### Task 5.1: Agent Status Broadcasting
**Problem:** User doesn't know what agents are currently doing.

**Files to modify:**
- `packages/web/src/hooks/use-agent-activity.ts` - Enhanced status tracking  
- `packages/web/src/components/project/AgentSidebar.tsx` - Live status display

**Implementation:**
1. Show agent status: "🔄 Working on authentication", "⏸️ Waiting for input", "✅ Task completed"
2. Display current task and progress percentage  
3. Show estimated time remaining based on agent activity
4. Visual indicators for blocked/idle agents

### Task 5.2: Agent Session Persistence
**Problem:** Agent context might be lost between sessions.

**Files to modify:**
- `packages/worker/src/openclaw/session-manager.ts` - Session persistence
- `packages/gateway/src/web/project-launcher.ts` - Session recovery

**Implementation:**
1. Save agent conversation history and context
2. Restore agent state when user returns to project
3. Agent should remember previous conversations and work done
4. Handle graceful resumption: "Welcome back! I was working on the authentication system..."

## Priority 6: User Experience Polish ✨

### Task 6.1: Progress Celebrations
**Problem:** No positive feedback when agents complete work.

**Files to modify:**
- `packages/web/src/components/project/ProjectPage.tsx` - Add celebration UI
- `packages/web/src/hooks/use-celebrations.ts` - Celebration logic

**Implementation:**
1. Show toast notifications for major milestones: "🎉 Authentication system completed!"
2. Progress bars for major features/tasks
3. Achievement-style notifications: "🏆 First API endpoint created!"

### Task 6.2: Agent Intervention System
**Problem:** No easy way to guide or correct agents when they go off track.

**Files to modify:**
- `packages/web/src/components/chat/AgentGuidance.tsx` - Quick action buttons
- `packages/web/src/components/project/NeedsAttention.tsx` - Intervention prompts

**Implementation:**
1. "Course correct" button when agent seems stuck
2. Quick feedback buttons: "👍 Good approach" / "🛑 Try a different approach"  
3. Smart suggestions: "Agent has been stuck for 10min - would you like to provide guidance?"

## Execution Plan 🚀

### Phase 1: Core Agent Functionality (1-2 days)
- Task 1.1, 1.2: Agent proactive initialization & identity
- Task 2.1: Auto-clone repo on project launch
- Task 3.1: Verify Claude Code teams working

### Phase 2: Progress Visibility (1-2 days)  
- Task 4.1: File change notifications
- Task 4.2: Git commit notifications
- Task 4.3: Task progress automation

### Phase 3: Enhanced Experience (1 day)
- Task 5.1: Agent status broadcasting
- Task 6.1: Progress celebrations 
- Task 6.2: Agent intervention system

### Phase 4: Polish & Reliability (1 day)
- Task 2.2: Auto-pull latest changes
- Task 3.2: Agent team coordination
- Task 5.2: Agent session persistence

## Success Criteria ✅

When complete, the platform should deliver:
1. **Agent-first experience**: Agents greet user, explain current state, propose next steps
2. **Visible progress**: User sees files being edited, commits being made, tasks moving across board
3. **Real coding work**: Agents actually modify code, run tests, create features
4. **Team coordination**: Multiple agents work together without conflicts
5. **Proactive updates**: User is notified of progress, blockers, and completions

This transforms peon.work from "chat with AI about code" to "watch AI teams build your project".