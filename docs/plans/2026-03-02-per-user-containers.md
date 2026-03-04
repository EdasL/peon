# Per-User Container Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move from per-project containers to per-user containers so each user gets one long-lived Docker container shared across all their projects.

**Architecture:** One `peonAgentId` per user (not per project). `ensureUserContainer()` is idempotent — called on every project creation but only provisions the container once. Each project becomes a workspace directory inside the container. Messages include `projectId` in metadata so the response renderer routes to the correct SSE stream.

**Tech Stack:** Drizzle ORM + PostgreSQL, Peon orchestration (Redis queues, session manager), Hono routes, TypeScript/Bun

---

## Task 1: Add `peonAgentId` column to `users` table

**Files:**
- Modify: `packages/gateway/src/db/schema.ts:3-13`

**Step 1: Add column to schema**

In `packages/gateway/src/db/schema.ts`, add `peonAgentId` to the `users` table definition:

```typescript
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  googleId: text("google_id").unique(),
  githubId: text("github_id").unique(),
  githubAccessToken: text("github_access_token"),
  peonAgentId: text("peon_agent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})
```

**Step 2: Push schema change to database**

Run from `packages/gateway/`:

```bash
bunx drizzle-kit push
```

Expected: Column `peon_agent_id` added to `users` table. Confirm with:

```bash
bunx drizzle-kit studio
```

Or: `psql $DATABASE_URL -c "\\d users"` — should show `peon_agent_id` column.

**Step 3: Commit**

```bash
git add packages/gateway/src/db/schema.ts
git commit -m "feat: add peonAgentId column to users table"
```

---

## Task 2: Rewrite `ensurePeonAgent()` to be user-scoped

**Files:**
- Modify: `packages/gateway/src/peon/agent-helper.ts:15-37`

**Step 1: Change `ensurePeonAgent` to accept userId instead of projectId**

Replace the entire `ensurePeonAgent` function in `packages/gateway/src/peon/agent-helper.ts`:

```typescript
/**
 * Ensures a user has a peonAgentId, creating one if needed.
 * Returns the peonAgentId.
 */
export async function ensurePeonAgent(
  userId: string
): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })
  if (!user) {
    throw new Error(`User ${userId} not found`)
  }

  if (user.peonAgentId) {
    return user.peonAgentId
  }

  const peonAgentId = randomUUID()
  await db
    .update(users)
    .set({ peonAgentId, updatedAt: new Date() })
    .where(eq(users.id, userId))

  logger.info({ userId, peonAgentId }, "Created peonAgentId for user")
  return peonAgentId
}
```

**Step 2: Update imports**

At the top of the file, change the schema import:

```typescript
import { users, apiKeys } from "../db/schema.js"
```

(Remove `projects` from the import — it's no longer needed here.)

**Step 3: Verify no type errors**

```bash
cd packages/gateway && bunx tsc --noEmit 2>&1 | grep -E "(agent-helper|project-launcher|chat-routes)"
```

Expected: Errors in `project-launcher.ts` (calling `ensurePeonAgent(projectId)` — will fix in Task 3). No errors in `agent-helper.ts` itself.

**Step 4: Commit**

```bash
git add packages/gateway/src/peon/agent-helper.ts
git commit -m "refactor: make ensurePeonAgent user-scoped instead of project-scoped"
```

---

## Task 3: Rewrite `project-launcher.ts` with `ensureUserContainer()` + `initProjectWorkspace()`

**Files:**
- Rewrite: `packages/gateway/src/web/project-launcher.ts`

**Step 1: Replace file contents**

Replace `packages/gateway/src/web/project-launcher.ts` entirely:

```typescript
import { randomUUID } from "node:crypto"
import { db } from "../db/connection.js"
import { apiKeys } from "../db/schema.js"
import { eq } from "drizzle-orm"
import { decrypt } from "../services/encryption.js"
import { ensurePeonAgent, bridgeCredentials } from "../peon/agent-helper.js"
import type { CoreServices } from "../platform.js"

/**
 * Ensures the user has a running container (idempotent).
 * On first call: generates peonAgentId, bridges credentials, creates session,
 * enqueues bootstrap message to trigger container creation.
 * On subsequent calls: re-bridges credentials (in case key changed), returns existing agentId.
 */
export async function ensureUserContainer(
  userId: string,
  services: CoreServices
): Promise<{ peonAgentId: string; created: boolean; error?: string }> {
  const peonAgentId = await ensurePeonAgent(userId)

  // Bridge credentials (idempotent — checks if already bridged)
  const hasCreds = await bridgeCredentials(userId, peonAgentId, services)
  if (!hasCreds) {
    return { peonAgentId, created: false, error: "no-api-key" }
  }

  // Check if session already exists (container already provisioned)
  const sessionManager = services.getSessionManager()
  const existingSession = await sessionManager.getSession(peonAgentId)
  if (existingSession) {
    return { peonAgentId, created: false }
  }

  // First time — create session and enqueue bootstrap message
  await sessionManager.setSession({
    conversationId: peonAgentId,
    channelId: peonAgentId,
    userId,
    threadCreator: userId,
    lastActivity: Date.now(),
    createdAt: Date.now(),
    status: "created",
    provider: "claude",
  })

  const queueProducer = services.getQueueProducer()
  await queueProducer.enqueueMessage({
    userId,
    conversationId: peonAgentId,
    messageId: randomUUID(),
    channelId: peonAgentId,
    teamId: "peon",
    agentId: peonAgentId,
    botId: "peon-agent",
    platform: "peon",
    messageText: "[system] User container initialized. Ready for project workspaces.",
    platformMetadata: { userId },
    agentOptions: { provider: "claude" },
  })

  return { peonAgentId, created: true }
}

/**
 * Initializes a project workspace inside the user's existing container.
 * Sends a system message so the agent knows about the new project.
 */
export async function initProjectWorkspace(
  userId: string,
  peonAgentId: string,
  projectId: string,
  templateId: string,
  repoUrl: string | null,
  services: CoreServices
): Promise<void> {
  const queueProducer = services.getQueueProducer()
  await queueProducer.enqueueMessage({
    userId,
    conversationId: peonAgentId,
    messageId: randomUUID(),
    channelId: peonAgentId,
    teamId: "peon",
    agentId: peonAgentId,
    botId: "peon-agent",
    platform: "peon",
    messageText: `[system] New project workspace: ${projectId}. Template: ${templateId}.${repoUrl ? ` Repo: ${repoUrl}.` : ""} Ready for user instructions.`,
    platformMetadata: { projectId, userId },
    agentOptions: { provider: "claude" },
  })
}

export async function getProjectApiKey(userId: string): Promise<{ provider: string; key: string } | null> {
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.userId, userId),
  })
  if (!key) return null
  return { provider: key.provider, key: decrypt(key.encryptedKey) }
}
```

**Step 2: Verify no type errors in this file**

```bash
cd packages/gateway && bunx tsc --noEmit 2>&1 | grep "project-launcher"
```

Expected: No errors.

**Step 3: Commit**

```bash
git add packages/gateway/src/web/project-launcher.ts
git commit -m "refactor: replace launchProject with ensureUserContainer + initProjectWorkspace"
```

---

## Task 4: Update projects route to use new functions

**Files:**
- Modify: `packages/gateway/src/routes/api/projects.ts`

**Step 1: Update imports**

Replace the project-launcher import:

```typescript
import { ensureUserContainer, initProjectWorkspace } from "../../web/project-launcher.js"
```

(Remove `getProjectApiKey` — no longer needed in this file. Keep `getPeonPlatform` import.)

**Step 2: Replace the launch block in POST handler**

Replace the background launch block (after `if (!project) return ...`) with:

```typescript
  // Ensure user has a container (idempotent) + init project workspace
  const services = getPeonPlatform().getServices()
  ensureUserContainer(session.userId, services).then(async (result) => {
    if (result.error === "no-api-key") {
      await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
      return
    }
    await initProjectWorkspace(
      session.userId,
      result.peonAgentId,
      project.id,
      body.templateId,
      body.repoUrl ?? null,
      services
    )
    await db.update(projects).set({ status: "creating" }).where(eq(projects.id, project.id))
  }).catch(async (err) => {
    console.error(`Failed to launch project ${project.id}:`, err)
    await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
  })
```

Also remove unused imports — `launchProject` and `getProjectApiKey` are gone.

**Step 3: Verify the full file**

The final file should look like:

```typescript
import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { projects } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { ensureUserContainer, initProjectWorkspace } from "../../web/project-launcher.js"
import { getPeonPlatform } from "../../peon/platform.js"

const projectsRouter = new Hono()
projectsRouter.use("*", requireAuth)

// GET /api/projects — list user's projects
projectsRouter.get("/", async (c) => {
  const session = getSession(c)
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session.userId),
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
  })
  return c.json({ projects: userProjects })
})

// POST /api/projects — create a new project
projectsRouter.post("/", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{
    name: string
    repoUrl?: string
    repoBranch?: string
    templateId: string
  }>()

  const result = await db.insert(projects).values({
    userId: session.userId,
    name: body.name,
    repoUrl: body.repoUrl,
    repoBranch: body.repoBranch ?? "main",
    templateId: body.templateId,
    status: "creating",
  }).returning()
  const project = result[0]
  if (!project) return c.json({ error: "Failed to create project" }, 500)

  // Ensure user has a container (idempotent) + init project workspace
  const services = getPeonPlatform().getServices()
  ensureUserContainer(session.userId, services).then(async (result) => {
    if (result.error === "no-api-key") {
      await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
      return
    }
    await initProjectWorkspace(
      session.userId,
      result.peonAgentId,
      project.id,
      body.templateId,
      body.repoUrl ?? null,
      services
    )
    await db.update(projects).set({ status: "creating" }).where(eq(projects.id, project.id))
  }).catch(async (err) => {
    console.error(`Failed to launch project ${project.id}:`, err)
    await db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
  })

  return c.json({ project }, 201)
})

// GET /api/projects/:id
projectsRouter.get("/:id", async (c) => {
  const session = getSession(c)
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)
  return c.json({ project })
})

// DELETE /api/projects/:id
projectsRouter.delete("/:id", async (c) => {
  const session = getSession(c)
  const [deleted] = await db.delete(projects)
    .where(and(eq(projects.id, c.req.param("id")), eq(projects.userId, session.userId)))
    .returning()
  if (!deleted) return c.json({ error: "Not found" }, 404)
  return c.json({ project: deleted })
})

export { projectsRouter }
```

**Step 4: Check for type errors**

```bash
cd packages/gateway && bunx tsc --noEmit 2>&1 | grep -E "(projects\.ts|project-launcher)"
```

Expected: No errors.

**Step 5: Commit**

```bash
git add packages/gateway/src/routes/api/projects.ts
git commit -m "feat: wire ensureUserContainer + initProjectWorkspace into project creation"
```

---

## Task 5: Update chat routes to read `peonAgentId` from user

**Files:**
- Modify: `packages/gateway/src/web/chat-routes.ts:1-8` (imports)
- Modify: `packages/gateway/src/web/chat-routes.ts:84-130` (POST handler)

**Step 1: Add `users` to schema import**

In the imports section of `chat-routes.ts`, add `users` to the schema import:

```typescript
import { chatMessages, projects, users } from "../db/schema.js"
```

**Step 2: Update POST handler to read from user**

In the POST `/:id/chat` handler, replace the peonAgentId lookup block. After the project ownership check (`if (!project) return ...`), replace:

```typescript
  // Agent must already exist (created during onboarding)
  const peonAgentId = project.peonAgentId
  if (!peonAgentId) {
    return c.json({ error: "Project not ready" }, 409)
  }
```

With:

```typescript
  // Agent lives on the user, not the project
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  })
  const peonAgentId = user?.peonAgentId
  if (!peonAgentId) {
    return c.json({ error: "Agent not ready" }, 409)
  }
```

**Step 3: Verify no type errors**

```bash
cd packages/gateway && bunx tsc --noEmit 2>&1 | grep "chat-routes"
```

Expected: No errors.

**Step 4: Commit**

```bash
git add packages/gateway/src/web/chat-routes.ts
git commit -m "refactor: read peonAgentId from user instead of project in chat routes"
```

---

## Task 6: Remove `peonAgentId` from projects table

**Files:**
- Modify: `packages/gateway/src/db/schema.ts:15-27`

**Step 1: Remove the column from schema**

In the `projects` table definition, remove the `peonAgentId` line:

```typescript
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  repoBranch: text("repo_branch").default("main"),
  templateId: text("template_id").notNull(),
  status: text("status", { enum: ["creating", "running", "stopped", "error"] }).default("stopped").notNull(),
  deploymentName: text("deployment_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})
```

**Step 2: Push schema change**

```bash
cd packages/gateway && bunx drizzle-kit push
```

Confirm the column is dropped. If `drizzle-kit push` warns about data loss (the column had values), accept it — we've migrated away from it.

**Step 3: Verify full type check**

```bash
cd packages/gateway && bunx tsc --noEmit 2>&1 | grep -v "AbortSignal\|ioredis\|qrcode-terminal"
```

Expected: No errors related to our changed files. Any remaining errors are pre-existing (ioredis version mismatch, AbortSignal types).

**Step 4: Commit**

```bash
git add packages/gateway/src/db/schema.ts
git commit -m "cleanup: remove peonAgentId from projects table (now on users)"
```

---

## Task 7: Verification

**Step 1: Type check**

```bash
cd packages/gateway && bunx tsc --noEmit 2>&1 | grep -E "(agent-helper|project-launcher|chat-routes|projects\.ts|schema\.ts)" || echo "No errors in changed files"
```

Expected: "No errors in changed files"

**Step 2: Start gateway**

```bash
cd packages/gateway && bun run dev
```

Expected: Gateway starts without errors, logs show "Peon platform initialized".

**Step 3: Manual test — create a project (with API key configured)**

Via the frontend or curl:

```bash
curl -X POST http://localhost:3001/api/projects \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{"name":"Test Project","templateId":"blank"}'
```

Verify in gateway logs:
- `ensurePeonAgent` called with userId (not projectId)
- `bridgeCredentials` called
- `enqueueMessage` called with `[system] User container initialized...`
- Second `enqueueMessage` called with `[system] New project workspace...`
- On second project creation: only the workspace init message fires (container already exists)

**Step 4: Manual test — send a chat message**

```bash
curl -X POST http://localhost:3001/api/projects/<project-id>/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: session=<your-session-cookie>" \
  -d '{"content":"Hello agent"}'
```

Verify:
- Message enqueues to existing agent (no container creation in logs)
- Response: `201 { message: { ... } }`
- If agent is running: streaming deltas appear via SSE

**Step 5: Manual test — create project without API key**

Create a new user without an API key, create a project.

Verify:
- `ensureUserContainer` returns `error: "no-api-key"`
- Project status set to `"error"` in database
- Chat returns `409 "Agent not ready"`

---

## File Change Summary

| Action | File | What Changes |
|--------|------|--------------|
| Modify | `packages/gateway/src/db/schema.ts` | Add `peonAgentId` to `users`, remove from `projects` |
| Rewrite | `packages/gateway/src/peon/agent-helper.ts` | `ensurePeonAgent(userId)` — queries/updates `users` table |
| Rewrite | `packages/gateway/src/web/project-launcher.ts` | `ensureUserContainer()` + `initProjectWorkspace()` replace `launchProject()` |
| Modify | `packages/gateway/src/routes/api/projects.ts` | Call new functions |
| Modify | `packages/gateway/src/web/chat-routes.ts` | Read `peonAgentId` from user, not project |

**Untouched (works as-is):**
- `packages/gateway/src/peon/response-renderer.ts` — routes by `platformMetadata.projectId` (unchanged)
- `packages/gateway/src/peon/platform.ts` — singleton pattern unchanged
- `packages/gateway/src/orchestration/message-consumer.ts` — receives messages, creates/routes to containers (unchanged)
- All frontend code — chat panel, SSE hooks (unchanged)
