# Manual Testing Guide

All endpoints require authentication via session cookie unless noted otherwise.

## Prerequisites

```bash
# Login and capture session cookie
# (Use browser devtools to grab the cookie value after logging in)
export SESSION="your-session-cookie-value"
export BASE="http://localhost:3000"
export PROJECT_ID="your-project-id"
```

---

## Projects API

### List projects
```bash
curl -s "$BASE/api/projects" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "projects": [{ "id": "...", "name": "...", "status": "running"|"creating"|"stopped"|"error", ... }] }`

### Get single project
```bash
curl -s "$BASE/api/projects/$PROJECT_ID" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "project": { "id": "...", "name": "...", "status": "...", "templateId": "...", ... } }`

### Get project status
```bash
curl -s "$BASE/api/projects/$PROJECT_ID/status" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "status": "running"|"starting"|"stopped"|"error" }`

### Create project
```bash
curl -s -X POST "$BASE/api/projects" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-project","templateId":"default"}' | jq
```
**Expected:** `{ "project": { "id": "...", "name": "test-project", "status": "creating", ... } }` (201)

### Update project name
```bash
curl -s -X PATCH "$BASE/api/projects/$PROJECT_ID" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"name":"renamed-project"}' | jq
```
**Expected:** `{ "project": { "name": "renamed-project", ... } }`

### Delete project
```bash
curl -s -X DELETE "$BASE/api/projects/$PROJECT_ID" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** 200 OK

### Restart project
```bash
curl -s -X POST "$BASE/api/projects/$PROJECT_ID/restart" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "status": "creating"|"running" }`

---

## Teams API

### List project teams
```bash
curl -s "$BASE/api/projects/$PROJECT_ID/teams" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "teams": [{ "id": "...", "projectId": "...", "name": "...", "members": [{ "id": "...", "roleName": "lead", "displayName": "Lead", "color": "bg-blue-500", ... }] }] }`

### Create team with members
```bash
curl -s -X POST "$BASE/api/projects/$PROJECT_ID/teams" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dev-team",
    "members": [
      {"roleName":"lead","displayName":"Lead","systemPrompt":"You are the team lead","color":"bg-blue-500"},
      {"roleName":"backend","displayName":"Backend","systemPrompt":"You are the backend dev","color":"bg-green-500"}
    ]
  }' | jq
```
**Expected:** `{ "team": { "id": "...", "members": [...] } }` (201)

---

## Chat API

### Get chat history
```bash
curl -s "$BASE/api/projects/$PROJECT_ID/chat" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "messages": [{ "id": "...", "projectId": "...", "role": "user"|"assistant", "content": "...", "createdAt": "..." }] }`

### Send chat message
```bash
curl -s -X POST "$BASE/api/projects/$PROJECT_ID/chat" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"content":"Add login page"}' | jq
```
**Expected:** `{ "message": { "id": "...", "role": "user", "content": "Add login page", ... } }`

### SSE stream (real-time events)
```bash
curl -N "$BASE/api/projects/$PROJECT_ID/chat/stream" \
  -H "Cookie: session=$SESSION"
```
**Expected events:**
- `event: ping` — heartbeat every 15s
- `event: message` — new chat message
- `event: chat_delta` / `event: chat_status` — streaming agent response
- `event: agent_activity` — tool use events (tool_start, tool_end, thinking, etc.)
- `event: task_update` — task created/updated
- `event: task_delete` — task removed
- `event: project_status` — project status change
- `event: agent_status` — agent working/idle/error (from hooks)

---

## Tasks API (project-scoped)

### List tasks
```bash
curl -s "$BASE/api/projects/$PROJECT_ID/tasks" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "tasks": [{ "id": "...", "subject": "...", "status": "pending"|"in_progress"|"completed", "owner": "...", "boardColumn": "todo"|"in_progress"|"done", ... }] }`

### Create task
```bash
curl -s -X POST "$BASE/api/projects/$PROJECT_ID/tasks" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Add OAuth login","description":"Implement GitHub OAuth"}' | jq
```
**Expected:** `{ "task": { "id": "...", "subject": "Add OAuth login", "boardColumn": "todo", ... } }`

### Update task
```bash
TASK_ID="your-task-id"
curl -s -X PATCH "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress","boardColumn":"in_progress","owner":"backend"}' | jq
```
**Expected:** `{ "task": { "status": "in_progress", "boardColumn": "in_progress", "owner": "backend", ... } }`

### Delete task
```bash
curl -s -X DELETE "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** 200 OK

---

## API Keys

### List keys
```bash
curl -s "$BASE/api/keys" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "keys": [{ "id": "...", "provider": "anthropic"|"openai", "label": "...", "createdAt": "..." }], "oauthConnections": [...] }`

### Add key
```bash
curl -s -X POST "$BASE/api/keys" \
  -H "Cookie: session=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","key":"sk-ant-...","label":"My Key"}' | jq
```
**Expected:** `{ "key": { "id": "...", "provider": "anthropic", "label": "My Key" } }` (201 new, 200 upsert)

### Delete key
```bash
KEY_ID="your-key-id"
curl -s -X DELETE "$BASE/api/keys/$KEY_ID" \
  -H "Cookie: session=$SESSION" | jq
```
**Expected:** `{ "ok": true }`

---

## Internal Routes (worker auth via Bearer token)

### Upsert task (worker → gateway)
```bash
export WORKER_TOKEN="your-worker-jwt"
curl -s -X POST "$BASE/internal/tasks" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"task-1","subject":"Add login","status":"pending","boardColumn":"todo"}' | jq
```
**Expected:** `{ "ok": true, "projectId": "...", "taskId": "task-1" }`

### Delete task (worker → gateway)
```bash
curl -s -X DELETE "$BASE/internal/tasks/task-1" \
  -H "Authorization: Bearer $WORKER_TOKEN" | jq
```
**Expected:** `{ "ok": true }`

### List tasks (worker → gateway)
```bash
curl -s "$BASE/internal/tasks" \
  -H "Authorization: Bearer $WORKER_TOKEN" | jq
```
**Expected:** `{ "tasks": [...] }`

### Hook event (agent status, TASK 6)
```bash
curl -s -X POST "$BASE/internal/hooks" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"PreToolUse","source_app":"agent-backend","project_id":"'$PROJECT_ID'"}' | jq
```
**Expected:** `{ "ok": true }` — SSE stream emits `agent_status` with `status: "working"`

---

## Browser Verification Steps

### TASK 1 — Dashboard (project list only)
1. Navigate to `/dashboard`
2. Verify: no chat textarea or input field visible
3. Verify: project cards display name, status dot, agent count
4. Click `[+ New]` — should navigate to `/onboarding`
5. Click a project card — should navigate to `/project/:id`
6. With no projects: verify "No projects yet" empty state

### TASK 2 — Project page (two-panel layout)
1. Open any project at `/project/:id`
2. Verify: only two panels visible (left team + center content)
3. Verify: no right panel (ActivityFeed)
4. Verify: no right panel toggle button
5. Verify: left panel toggle still works

### TASK 3 — Board (3 columns, read-only)
1. Open project, switch to Board tab
2. Verify: exactly 3 columns — "To Do", "In Progress", "Done"
3. Verify: cards are NOT draggable (no drag handles)
4. Verify: no "Create Task" button
5. Verify: cards show owner name + active dot when working

### TASK 4 — TeamPanel (left sidebar)
1. Open project — left panel shows team members
2. Verify: each member has name + status dot
3. Dot colors: green filled (working), green outline (idle), red (error)
4. Click `[+]` — should call spawn agent API
5. Click `[↻]` — should refresh member list

### TASK 5 — Chat creates tasks on board
1. Open project, type "Add user authentication" in chat
2. Switch to Board tab within 5-10s
3. Verify: new tasks appear in "To Do" column
4. Verify: tasks have subject text from agent's response

### TASK 6 — Agent status from hooks
1. Open project with running agents
2. Watch TeamPanel dots during agent activity
3. Verify: dots turn green filled when agent uses tools
4. Verify: dots turn green outline when agent stops
5. Verify: dots turn red on error events

### TASK 7 — End-to-end flow
1. Open project, confirm TeamPanel shows agents
2. Send "Add GitHub OAuth login" in chat
3. Watch Board — tasks appear in "To Do" within ~5s
4. Watch TeamPanel — dots go green as agents work
5. Watch Board — cards move to "In Progress"
6. Eventually cards move to "Done"
7. Chat shows summary message from lead agent
