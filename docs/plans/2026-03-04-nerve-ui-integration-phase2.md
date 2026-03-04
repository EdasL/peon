# OpenClaw-Nerve UI Integration (Phase 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate openclaw-nerve UI features into the Peon web app's **ProjectPage** so users get a File Browser with editor, Session Tree, Workspace/Config panel, Token/Cost monitoring, and a full Nerve-quality Kanban board — all powered by a direct OpenClaw WebSocket connection to the project's container.

**Architecture:** Nerve connects to OpenClaw via `useWebSocket` → `GatewayContext` → feature components. Peon will replicate this pattern: a project-scoped WS proxy on the gateway, a `useOpenClawWs` hook (adapted from Nerve's `useWebSocket`), an `OpenClawProvider` context, and Nerve's feature components copied and adapted. All new features live on `ProjectPage` (not the Dashboard — these require a running container).

**Tech Stack:** React 18, Vite, Tailwind, shadcn/ui, CodeMirror 6 (for file editor), WebSocket (OpenClaw protocol v3)

**Reference repo:** https://github.com/daggerhashimoto/openclaw-nerve (MIT license)

---

## Why ProjectPage, Not Dashboard

The original discussion mentioned "Main dashboard" for File Browser, Session Tree, Config, and Token/Cost. After analysis, these features **require a running project container** with an active OpenClaw gateway. The Dashboard is a project-list + master-chat view with no container context. Therefore, all Nerve features go into `ProjectPage` which has `projectId`, `deploymentName`, and a running container.

The Dashboard gets no new Nerve features in Phase 2.

---

## Nerve Architecture (What We're Adapting)

Nerve's data flow:

```
useWebSocket (hooks/useWebSocket.ts)
  → GatewayContext (contexts/GatewayContext.tsx) 
    → provides: { rpc, subscribe, connectionState }
      → SessionContext (contexts/SessionContext.tsx) — sessions.list, agent state
      → ChatContext (contexts/ChatContext.tsx) — chat.history, chat.send
      → Feature components consume contexts
```

**Key Nerve features and their files:**

| Feature | Nerve files | RPC methods used |
|---------|------------|------------------|
| **File Browser** | `features/file-browser/` (12 files): FileTreePanel, FileTreeNode, FileEditor, EditorTab, EditorTabBar, TabbedContentArea, ImageViewer, types, hooks/, utils/, editorTheme, index | `workspace.list`, `workspace.read`, `workspace.write`, `workspace.rename`, `workspace.delete` |
| **Sessions** | `features/sessions/` (8 files): SessionList, SessionNode, SessionInfoPanel, SpawnAgentDialog, sessionTree, statusUtils, unreadSessions | `sessions.list`, `sessions.abort`, `sessions.spawn`, `sessions.delete`, `sessions.rename` |
| **Kanban** | `features/kanban/` (12 files): KanbanPanel, KanbanBoard, KanbanColumn, KanbanCard, KanbanHeader, KanbanQuickView, CreateTaskDialog, TaskDetailDrawer, ProposalInbox, hooks/, lib/, types | `tasks.list`, `tasks.create`, `tasks.update`, `tasks.delete`, `tasks.reorder` |
| **Workspace** | `features/workspace/` — WorkspacePanel | `workspace.read` (for SOUL.md, MEMORY.md, etc.) |
| **Token/Cost** | `components/ContextMeter.tsx` + `hooks/useDashboardData.ts` (tokenData) | `status` RPC + `tokens` events |
| **Activity** | `features/activity/` | Gateway events (`agent`, `chat`, etc.) |

**Nerve's protocol types** are in `src/types.ts` (GatewayMessage, GatewayEvent, GatewayResponse, Session, ChatMessage, TokenData, etc.)

---

## Prerequisites

- Phase 1 complete: Gateway WS proxy at `/api/ws` relays to container's OpenClaw gateway with auth token injection.
- Projects have `deploymentName` in the DB; `openclawRegistry` maps deploymentName → `{ wsUrl, token }`.
- Peon project page has 3-column layout: AgentSidebar (left), center (chat/board), ActivityFeed (right).

---

## Part A: Project-Scoped WebSocket Proxy

The current WS proxy resolves by `userId` + `peonAgentId` (finds the user's single container). Phase 2 needs **project-level** resolution since each project may have its own container.

### Task A1: Extend WS proxy to accept projectId

**Files:**
- Modify: `packages/gateway/src/openclaw/ws-proxy.ts`

**Changes:**

1. Parse `projectId` from query string on `/api/ws?projectId=<uuid>`.

2. Add `resolveProjectOpenClawInfo(userId, projectId)`:
```typescript
import { and, eq } from "drizzle-orm"
import { projects } from "../db/schema.js"

async function resolveProjectOpenClawInfo(
  userId: string,
  projectId: string
): Promise<{ wsUrl: string; token?: string } | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
    columns: { deploymentName: true, status: true },
  })
  if (!project?.deploymentName || project.status !== "running") return null
  const wsUrl = getOpenClawWsUrl(project.deploymentName)
  if (!wsUrl) return null
  const token = getOpenClawToken(project.deploymentName)
  return { wsUrl, token }
}
```

3. In the upgrade handler: if `projectId` is present, use `resolveProjectOpenClawInfo`. Otherwise fall back to existing `resolveUserOpenClawInfo` for backward compatibility.

4. Run: `cd packages/gateway && pnpm exec tsc --noEmit`

5. Commit: `feat(gateway): extend WS proxy to accept projectId`

---

## Part B: Browser OpenClaw Protocol Client

Adapt Nerve's `useWebSocket` hook for Peon. Nerve's hook (11.7KB) handles: connect with challenge/auth, JSON-RPC with timeouts, event dispatch, and auto-reconnect with exponential backoff.

### Task B1: Port Nerve's useWebSocket to Peon

**Files:**
- Create: `packages/web/src/hooks/use-openclaw-ws.ts`

**Approach:** Copy Nerve's `src/hooks/useWebSocket.ts` and adapt:

1. **Remove the `target` proxy param.** Nerve proxies via `?target=<url>`. Peon proxies directly at `/api/ws?projectId=...`. So the connect URL becomes:
```typescript
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
const wsUrl = `${protocol}//${window.location.host}/api/ws?projectId=${projectId}`
```

2. **Simplify auth.** Peon's proxy injects the token server-side. The browser doesn't need to send `auth.token`. But we still need to send the `connect` request in response to `connect.challenge`:
```typescript
params: {
  minProtocol: 3, maxProtocol: 3,
  client: { id: "peon-web", version: "0.1.0", platform: "web", mode: "webchat" },
  role: "operator",
  scopes: ["operator.admin", "operator.read", "operator.write"],
  caps: ["tool-events"]
}
```

3. **Keep:** Auto-reconnect, RPC timeout (30s), pending request rejection, connection generation tracking.

4. **Export:** `useOpenClawWs(projectId: string | null)` returning `{ connectionState, rpc, subscribe, disconnect, connectError, reconnectAttempt }`.

5. Run: `cd packages/web && pnpm exec tsc --noEmit`
6. Commit: `feat(web): add useOpenClawWs hook (adapted from Nerve's useWebSocket)`

### Task B2: Port Nerve's types

**Files:**
- Create: `packages/web/src/lib/openclaw-types.ts`

**Approach:** Copy Nerve's `src/types.ts` wholesale. It defines:
- `GatewayMessage`, `GatewayEvent`, `GatewayResponse` — protocol framing
- `Session` — agent session shape (sessionKey, model, totalTokens, etc.)
- `ChatMessage`, `ContentBlock` — chat message types
- `TokenData`, `TokenEntry` — token/cost data
- `AgentStatusKind`, `GranularAgentState` — agent state
- `AgentEventPayload`, `ChatEventPayload` — typed event payloads

Remove Nerve-specific fields we don't need (voice, TTS). Keep everything else.

Commit: `feat(web): add OpenClaw protocol types from Nerve`

---

## Part C: OpenClaw Context Provider

### Task C1: Create OpenClawProvider

**Files:**
- Create: `packages/web/src/contexts/OpenClawContext.tsx`

**Approach:** Adapt Nerve's `GatewayContext.tsx`:
- Wraps `useOpenClawWs(projectId)`
- Provides `{ connectionState, rpc, subscribe, connectError }` via React context
- Includes status polling (model, sparkline) from Nerve's GatewayContext
- Auto-connects when projectId is provided and project status is "running"

```typescript
export function OpenClawProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  // Uses useOpenClawWs(projectId), auto-connects on mount
  // Provides context to all Nerve feature components
}

export function useOpenClaw() {
  const ctx = useContext(OpenClawContext)
  if (!ctx) throw new Error("useOpenClaw must be used within OpenClawProvider")
  return ctx
}
```

Commit: `feat(web): add OpenClawProvider context`

---

## Part D: Nerve Feature Components

### Task D1: Clone Nerve repo as reference

```bash
cd /tmp && git clone --depth 1 https://github.com/daggerhashimoto/openclaw-nerve.git
```

Read and understand the actual components before copying.

### Task D2: File Browser (12 files)

**Files to create:** `packages/web/src/features/file-browser/` (mirror Nerve's structure)

**Nerve's file-browser consists of:**
- `FileTreePanel.tsx` (25KB) — main tree panel with search, create, rename, delete, drag-drop
- `FileTreeNode.tsx` (6KB) — individual tree node (expand/collapse, context menu)
- `FileEditor.tsx` (7KB) — CodeMirror 6 editor with syntax highlighting
- `EditorTab.tsx` (2KB) — single tab in editor tab bar
- `EditorTabBar.tsx` (1.3KB) — tab bar for open files
- `TabbedContentArea.tsx` (4.4KB) — manages open file tabs + editor
- `ImageViewer.tsx` (1.2KB) — renders image files inline
- `editorTheme.ts` (4.6KB) — CodeMirror dark theme
- `types.ts` (0.9KB) — FileNode, OpenFile types
- `hooks/` — useOpenFiles, useFileTree
- `utils/` — path utils, language detection
- `index.ts` — barrel exports

**Adaptation:**
- Replace `useGateway().rpc` with `useOpenClaw().rpc`
- Add CodeMirror 6 dependencies: `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-*`, `@codemirror/theme-one-dark`
- Wire `file.changed` events from the OpenClaw subscribe to refresh tree

**Layout:** File tree goes in the left panel (collapsible). Editor tabs go in center area (alongside chat, as a view mode toggle: Chat | Files | Board).

Commit: `feat(web): add File Browser from Nerve`

### Task D3: Session List + Tree (7 files)

**Files to create:** `packages/web/src/features/sessions/`

**Nerve's sessions feature:**
- `SessionList.tsx` (11KB) — scrollable session list with tree hierarchy
- `SessionNode.tsx` (14KB) — individual session row (status badge, token count, actions)
- `SessionInfoPanel.tsx` (8KB) — expanded session details
- `SpawnAgentDialog.tsx` (8KB) — dialog to spawn sub-agents
- `sessionTree.ts` (4.6KB) — builds parent→child tree from flat session list
- `statusUtils.ts` (0.9KB) — session status helpers
- `unreadSessions.test.ts` — tests

**Adaptation:**
- Replace `useSessionContext()` with local state + `useOpenClaw().rpc` calls to `sessions.list`
- Subscribe to `agent` events for real-time session state updates
- Session list goes in right sidebar (replacing or alongside the current AgentSidebar)

Commit: `feat(web): add Session List/Tree from Nerve`

### Task D4: Kanban Board (12 files) — FULL REPLACEMENT

**Files to create:** `packages/web/src/features/kanban/`

**This replaces Peon's existing simple KanbanBoard** (`components/board/KanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx`) with Nerve's feature-rich version.

**Nerve's kanban feature:**
- `KanbanPanel.tsx` (4.4KB) — top-level panel with data fetching
- `KanbanBoard.tsx` (6.6KB) — drag-and-drop board layout
- `KanbanColumn.tsx` (3KB) — column (todo/in-progress/done/etc.)
- `KanbanCard.tsx` (6.5KB) — task card with status, owner, progress
- `KanbanHeader.tsx` (8.6KB) — board header with filters, view toggles
- `KanbanQuickView.tsx` (4.7KB) — inline quick view of task
- `CreateTaskDialog.tsx` (8.4KB) — create task dialog
- `TaskDetailDrawer.tsx` (24KB) — full task detail drawer with subtasks, history
- `ProposalInbox.tsx` (5.4KB) — agent proposals for user approval
- `hooks/` — useKanbanData, useDragDrop
- `lib/` — task sorting, filtering
- `types.ts` (1.6KB) — KanbanTask, KanbanColumn types

**Adaptation:**
- Nerve's kanban uses `tasks.list` / `tasks.update` RPCs via OpenClaw WebSocket
- Peon's current kanban uses `ClaudeTask` from SSE `task_update` events
- **Strategy:** Use Nerve's kanban but with a **dual data source** — OpenClaw RPC for the full task list, SSE `task_update` events for real-time updates when the WS isn't connected
- Remove Peon's old `components/board/` files after the new kanban is working

Commit: `feat(web): replace Kanban with Nerve's full-featured board`

### Task D5: Workspace Panel

**Files to create:** `packages/web/src/features/workspace/WorkspacePanel.tsx`

**Nerve's workspace panel** shows SOUL.md, MEMORY.md, AGENTS.md, TOOLS.md in a quick-read view with edit capability.

**Adaptation:** Wire to `useOpenClaw().rpc("workspace.read", { path })`.

Commit: `feat(web): add Workspace Panel from Nerve`

### Task D6: Token/Cost Monitoring

**Files:**
- Create: `packages/web/src/components/project/ContextMeter.tsx` (from Nerve's `ContextMeter.tsx`, 3.4KB)

**Nerve's ContextMeter** shows:
- Context window usage bar (tokens used / limit)
- Session cost
- Model name + thinking level

**Data source:** `status` RPC → `tokenData` + session context tokens from `sessions.list`.

**Placement:** Status bar at bottom of ProjectPage (inspired by Nerve's StatusBar).

Commit: `feat(web): add ContextMeter and status bar`

### Task D7: Enhanced Activity Feed

**Files:**
- Modify: `packages/web/src/components/project/ActivityFeed.tsx`

**Approach:** Keep Peon's existing SSE-powered ActivityFeed but enhance it with real-time OpenClaw events when connected. The `subscribe` callback from `useOpenClaw` provides `agent` events with tool streaming, thinking, lifecycle — richer than the current SSE relay.

**Changes:**
- When OpenClaw WS is connected, subscribe to `agent` and `chat` events and merge into the feed
- Keep SSE fallback when WS is disconnected
- Add Nerve-style event formatting (tool icons, status badges)

Commit: `feat(web): enhance ActivityFeed with direct OpenClaw events`

---

## Part E: Layout Integration

### Task E1: Rewire ProjectPage layout

**Files:**
- Modify: `packages/web/src/pages/ProjectPage.tsx`

**Changes:**

1. Wrap `ProjectBody` with `<OpenClawProvider projectId={projectId}>` when project status is "running"

2. Replace the 3-column layout with a Nerve-inspired layout:
   - **Left panel** (collapsible): File tree + Session list (tabs or accordion)
   - **Center**: View mode toggle — Chat | Files (editor) | Board (kanban)
   - **Right panel** (collapsible): ActivityFeed + Workspace panel
   - **Bottom bar**: ContextMeter + connection status

3. Add view mode state (`chat` | `files` | `board`) with toggle buttons in the header

4. Old `AgentSidebar` → replaced by Session list (which shows agent sessions with status)

5. Run: `cd packages/web && pnpm exec tsc --noEmit && pnpm dev`

Commit: `feat(web): integrate Nerve panels into ProjectPage layout`

---

## Part F: Dependency Installation

### Task F0: Install new npm dependencies (do this before Part D)

**Files:**
- Modify: `packages/web/package.json`

**Dependencies for CodeMirror 6 (file editor):**
```bash
cd packages/web && pnpm add @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/search @codemirror/autocomplete @codemirror/lint @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-python @codemirror/theme-one-dark
```

**Drag-and-drop for kanban (if Nerve uses one):**
Check Nerve's package.json — if it uses `@dnd-kit/core` or similar, install that too.

Commit: `chore(web): add CodeMirror and kanban dependencies`

---

## Part G: Cleanup

### Task G1: Remove old board components

After Nerve's kanban is working:
- Delete: `packages/web/src/components/board/KanbanBoard.tsx`
- Delete: `packages/web/src/components/board/KanbanColumn.tsx`
- Delete: `packages/web/src/components/board/KanbanCard.tsx`
- Update imports in ProjectPage

Commit: `refactor(web): remove old Kanban components replaced by Nerve's`

---

## Execution Order

1. **F0** — Install dependencies
2. **A1** — Extend WS proxy (gateway)
3. **B1** — Port useWebSocket hook
4. **B2** — Port types
5. **C1** — Create OpenClawProvider
6. **D1** — Clone Nerve for reference
7. **D2** — File Browser
8. **D3** — Session List/Tree
9. **D4** — Kanban Board (full replacement)
10. **D5** — Workspace Panel
11. **D6** — ContextMeter
12. **D7** — Enhanced Activity Feed
13. **E1** — Layout integration
14. **G1** — Cleanup old components

Tasks D2–D7 can be parallelized after D1.

---

## Out of Scope (Phase 2)

- Voice/TTS (Nerve's `voice`, `tts` features)
- Command palette (Nerve's `command-palette`)
- Charts (Nerve's `charts`)
- Connect dialog (Peon handles auth differently)
- Settings drawer (Peon has its own SettingsPage)
- Memory panel (Nerve's `memory` — could add in Phase 3)

---

## Risk: RPC Method Availability

Nerve talks to a local OpenClaw gateway that supports all RPCs. Peon's gateway proxy relays to the container's OpenClaw. We need to verify the container's OpenClaw version supports:
- `workspace.list`, `workspace.read`, `workspace.write`
- `sessions.list`
- `tasks.list`, `tasks.update`
- `status`

If any RPC returns "method not found", we'll need to either upgrade the container's OpenClaw or build gateway-side fallback endpoints.
