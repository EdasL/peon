# Multi-User Agent Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the local femrun-kanban tool into a hosted multi-user platform by forking Peon, adding Google/GitHub OAuth, web chat with team lead agents, a live Kanban dashboard, and deploying to GCP + Vercel.

**Architecture:** Fork Peon (Apache 2.0) as the backend — it provides Docker container orchestration, SSE worker communication, Redis state, and a module system. Add a new "web" platform adapter (alongside Peon's existing Slack/Telegram adapters) that powers our chat UI. Add Postgres for user accounts and project metadata. Port our existing React Kanban frontend into a new `packages/web` package deployed to Vercel.

**Tech Stack:** Hono (Peon gateway), React 19 + Vite + Tailwind v4 + shadcn/ui (frontend), Postgres via Drizzle ORM (user data), Redis + BullMQ (state/queue), Docker + Dockerode (container orchestration), Google OAuth + GitHub OAuth (auth), SSE (real-time), GCP Compute Engine (hosting), Vercel (frontend CDN).

**Ref:** Design doc at `docs/plans/2026-03-02-onboarding-design.md`

---

## Task 1: Fork Peon & Restructure Monorepo

**Why:** We need Peon's gateway/worker/core packages as our foundation. We'll clone the repo structure into our project, remove what we don't need (landing page, Slack/Telegram/WhatsApp adapters for now), and add our own `packages/web` frontend package.

**Files:**
- Delete: `packages/landing/` (replaced by our frontend)
- Delete: `packages/cli/` (we don't need a CLI installer)
- Keep: `packages/gateway/`, `packages/worker/`, `packages/core/`
- Create: `packages/web/` (our React frontend, moved from current `src/`)
- Modify: root `package.json` (update workspaces, name, scripts)
- Modify: `docker/docker-compose.yml` (add Postgres service)
- Create: `packages/gateway/src/db/` (Postgres connection + Drizzle schema)

**Step 1: Clone Peon into a fresh branch**

```bash
git checkout -b feat/multiuser-platform
```

Copy Peon's packages into our repo:

```bash
# From femrun-kanban root
cp -r /tmp/peon-inspect/packages/gateway packages/gateway
cp -r /tmp/peon-inspect/packages/worker packages/worker
cp -r /tmp/peon-inspect/packages/core packages/core
cp -r /tmp/peon-inspect/docker docker
cp /tmp/peon-inspect/tsconfig.json tsconfig.base.json
```

**Step 2: Move existing frontend into packages/web**

```bash
mkdir -p packages/web
mv src/ packages/web/src/
mv index.html packages/web/
mv vite.config.ts packages/web/
mv components.json packages/web/
mv tsconfig.json packages/web/tsconfig.json
```

Keep `server/` for reference but it will be replaced by Peon gateway.

**Step 3: Update root package.json**

```json
{
  "name": "femrun-platform",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/core",
    "packages/gateway",
    "packages/worker",
    "packages/web"
  ],
  "scripts": {
    "dev": "docker compose -f docker/docker-compose.yml up -d && cd packages/web && npm run dev",
    "dev:gateway": "cd packages/gateway && bun run src/index.ts",
    "dev:web": "cd packages/web && vite",
    "build": "cd packages/core && bun run build && cd ../gateway && bun run build && cd ../worker && bun run build && cd ../web && vite build",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "1.2.11",
    "@types/node": "^22.14.1",
    "typescript": "^5.8.3"
  }
}
```

**Step 4: Create packages/web/package.json**

```json
{
  "name": "@femrun/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.576.0",
    "radix-ui": "^1.4.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.1",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.4.1",
    "tailwindcss": "^4.2.1",
    "tw-animate-css": "^1.4.0",
    "vite": "^6.3.5"
  }
}
```

**Step 5: Update packages/web/vite.config.ts**

```typescript
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
})
```

Note: Peon gateway runs on port 3000 (not 3001 like our old server).

**Step 6: Add Postgres to docker-compose.yml**

Add to `docker/docker-compose.yml` services:

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: femrun
      POSTGRES_PASSWORD: femrun_dev
      POSTGRES_DB: femrun
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - peon-public
```

Add to volumes:

```yaml
volumes:
  postgres_data:
```

**Step 7: Install dependencies and verify build**

```bash
cd packages/core && bun install && bun run build
cd ../gateway && bun install
cd ../worker && bun install
cd ../web && npm install
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: fork Peon as platform foundation, restructure monorepo

- Copy gateway/worker/core packages from Peon (Apache 2.0)
- Move existing frontend to packages/web
- Add Postgres to docker-compose
- Update workspace config"
```

---

## Task 2: Postgres Schema & Database Layer

**Why:** Peon stores everything in Redis (ephemeral). We need persistent storage for user accounts, projects (teams), API keys, and chat history. Drizzle ORM gives us type-safe schema + migrations.

**Files:**
- Create: `packages/gateway/src/db/connection.ts`
- Create: `packages/gateway/src/db/schema.ts`
- Create: `packages/gateway/src/db/migrate.ts`
- Create: `packages/gateway/drizzle.config.ts`
- Modify: `packages/gateway/package.json` (add drizzle-orm, pg deps)

**Step 1: Install Drizzle ORM in gateway package**

```bash
cd packages/gateway
bun add drizzle-orm pg
bun add -d drizzle-kit @types/pg
```

**Step 2: Create database connection**

Create `packages/gateway/src/db/connection.ts`:

```typescript
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema.js"

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://femrun:femrun_dev@localhost:5432/femrun",
})

export const db = drizzle(pool, { schema })
export type Database = typeof db
```

**Step 3: Create schema**

Create `packages/gateway/src/db/schema.ts`:

```typescript
import { pgTable, text, timestamp, jsonb, boolean, integer, uuid } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  googleId: text("google_id").unique(),
  githubId: text("github_id").unique(),
  githubAccessToken: text("github_access_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

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

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["anthropic", "openai"] }).notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
```

**Step 4: Create Drizzle config**

Create `packages/gateway/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://femrun:femrun_dev@localhost:5432/femrun",
  },
})
```

**Step 5: Create migration runner**

Create `packages/gateway/src/db/migrate.ts`:

```typescript
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { db } from "./connection.js"

export async function runMigrations() {
  console.log("Running database migrations...")
  await migrate(db, { migrationsFolder: "./drizzle" })
  console.log("Migrations complete.")
}
```

**Step 6: Generate initial migration**

```bash
cd packages/gateway
bunx drizzle-kit generate
```

**Step 7: Verify migration runs**

Start Postgres:

```bash
docker compose -f docker/docker-compose.yml up postgres -d
```

Run migration:

```bash
cd packages/gateway && bun run src/db/migrate.ts
```

Expected: Tables `users`, `projects`, `api_keys`, `chat_messages` created.

**Step 8: Commit**

```bash
git add packages/gateway/src/db/ packages/gateway/drizzle.config.ts packages/gateway/drizzle/ packages/gateway/package.json
git commit -m "feat: add Postgres schema with Drizzle ORM

Tables: users, projects, api_keys, chat_messages.
Supports multi-user with per-project teams and encrypted API keys."
```

---

## Task 3: Google OAuth Authentication

**Why:** Users sign in with Google (one-click). We need an OAuth flow that creates/finds a user in Postgres, issues a session JWT, and sets an httpOnly cookie.

**Files:**
- Create: `packages/gateway/src/auth/google-oauth.ts`
- Create: `packages/gateway/src/auth/session.ts`
- Create: `packages/gateway/src/auth/middleware.ts`
- Create: `packages/gateway/src/routes/public/auth.ts`
- Modify: `packages/gateway/src/cli/gateway.ts` (register auth routes)

**Step 1: Install dependencies**

```bash
cd packages/gateway
bun add jose
```

We'll use raw OAuth2 + `jose` for JWT — no passport needed with Hono.

**Step 2: Create session utilities**

Create `packages/gateway/src/auth/session.ts`:

```typescript
import { SignJWT, jwtVerify } from "jose"

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "femrun-dev-secret-change-in-prod"
)
const JWT_ISSUER = "femrun"
const JWT_EXPIRY = "7d"

export interface SessionPayload {
  userId: string
  email: string
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET)
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET, { issuer: JWT_ISSUER })
  return payload as unknown as SessionPayload
}
```

**Step 3: Create Google OAuth handler**

Create `packages/gateway/src/auth/google-oauth.ts`:

```typescript
import { db } from "../db/connection.js"
import { users } from "../db/schema.js"
import { eq } from "drizzle-orm"
import { createSessionToken } from "./session.js"

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const GOOGLE_REDIRECT_URI = process.env.PUBLIC_URL
  ? `${process.env.PUBLIC_URL}/api/auth/google/callback`
  : "http://localhost:3000/api/auth/google/callback"

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

interface GoogleTokens {
  access_token: string
  id_token: string
}

interface GoogleProfile {
  sub: string
  email: string
  name: string
  picture: string
}

async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
  return res.json() as Promise<GoogleTokens>
}

async function getProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google profile fetch failed: ${res.status}`)
  return res.json() as Promise<GoogleProfile>
}

export async function handleGoogleCallback(code: string): Promise<{ token: string; isNew: boolean }> {
  const tokens = await exchangeCode(code)
  const profile = await getProfile(tokens.access_token)

  // Find or create user
  const existing = await db.query.users.findFirst({
    where: eq(users.googleId, profile.sub),
  })

  let userId: string
  let isNew = false

  if (existing) {
    userId = existing.id
    // Update name/avatar in case they changed
    await db.update(users).set({
      name: profile.name,
      avatarUrl: profile.picture,
      updatedAt: new Date(),
    }).where(eq(users.id, existing.id))
  } else {
    const [newUser] = await db.insert(users).values({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      googleId: profile.sub,
    }).returning()
    userId = newUser.id
    isNew = true
  }

  const token = await createSessionToken({ userId, email: profile.email })
  return { token, isNew }
}
```

**Step 4: Create auth middleware**

Create `packages/gateway/src/auth/middleware.ts`:

```typescript
import type { Context, Next } from "hono"
import { verifySessionToken, type SessionPayload } from "./session.js"

export async function requireAuth(c: Context, next: Next) {
  const cookie = c.req.header("cookie")
  const token = cookie
    ?.split(";")
    .find((c) => c.trim().startsWith("session="))
    ?.split("=")[1]

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  try {
    const session = await verifySessionToken(token)
    c.set("session", session)
    await next()
  } catch {
    return c.json({ error: "Invalid session" }, 401)
  }
}

// Type helper for route handlers
export function getSession(c: Context): SessionPayload {
  return c.get("session") as SessionPayload
}
```

**Step 5: Create auth routes**

Create `packages/gateway/src/routes/public/auth.ts`:

```typescript
import { Hono } from "hono"
import { getGoogleAuthUrl, handleGoogleCallback } from "../../auth/google-oauth.js"
import { verifySessionToken } from "../../auth/session.js"
import { db } from "../../db/connection.js"
import { users } from "../../db/schema.js"
import { eq } from "drizzle-orm"

const auth = new Hono()

// GET /api/auth/google — redirect to Google OAuth
auth.get("/google", (c) => {
  const state = crypto.randomUUID()
  // In production, store state in Redis for CSRF verification
  const url = getGoogleAuthUrl(state)
  return c.redirect(url)
})

// GET /api/auth/google/callback — handle OAuth callback
auth.get("/google/callback", async (c) => {
  const code = c.req.query("code")
  if (!code) return c.json({ error: "Missing code" }, 400)

  try {
    const { token, isNew } = await handleGoogleCallback(code)
    // Set httpOnly cookie
    c.header(
      "set-cookie",
      `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    )
    // Redirect to frontend
    const frontendUrl = process.env.PUBLIC_FRONTEND_URL ?? "http://localhost:5173"
    return c.redirect(isNew ? `${frontendUrl}/onboarding` : `${frontendUrl}/dashboard`)
  } catch (err) {
    console.error("Google OAuth error:", err)
    return c.json({ error: "Authentication failed" }, 500)
  }
})

// GET /api/auth/me — get current user
auth.get("/me", async (c) => {
  const cookie = c.req.header("cookie")
  const token = cookie
    ?.split(";")
    .find((c) => c.trim().startsWith("session="))
    ?.split("=")[1]

  if (!token) return c.json({ user: null })

  try {
    const session = await verifySessionToken(token)
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
      columns: { id: true, email: true, name: true, avatarUrl: true, githubId: true, createdAt: true },
    })
    return c.json({ user })
  } catch {
    return c.json({ user: null })
  }
})

// POST /api/auth/logout
auth.post("/logout", (c) => {
  c.header("set-cookie", "session=; Path=/; HttpOnly; Max-Age=0")
  return c.json({ ok: true })
})

export { auth as authRoutes }
```

**Step 6: Register auth routes in gateway**

In `packages/gateway/src/cli/gateway.ts`, add to the `setupServer()` function where routes are registered:

```typescript
import { authRoutes } from "../routes/public/auth.js"

// Inside setupServer(), alongside existing route registrations:
app.route("/api/auth", authRoutes)
```

**Step 7: Add env vars to .env.example**

Create `.env.example` at repo root:

```env
# Database
DATABASE_URL=postgresql://femrun:femrun_dev@localhost:5432/femrun

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# JWT
JWT_SECRET=change-this-in-production

# URLs
PUBLIC_URL=http://localhost:3000
PUBLIC_FRONTEND_URL=http://localhost:5173

# Peon defaults
QUEUE_URL=redis://redis:6379
DEPLOYMENT_MODE=docker
```

**Step 8: Verify auth flow works**

```bash
# Start services
docker compose -f docker/docker-compose.yml up -d postgres redis
cd packages/gateway && bun run src/index.ts
```

Visit `http://localhost:3000/api/auth/google` — should redirect to Google.
Visit `http://localhost:3000/api/auth/me` — should return `{ user: null }`.

**Step 9: Commit**

```bash
git add packages/gateway/src/auth/ packages/gateway/src/routes/public/auth.ts .env.example
git commit -m "feat: add Google OAuth with JWT sessions

- Google OAuth sign-in flow with Postgres user persistence
- JWT httpOnly cookie sessions (7-day expiry)
- /api/auth/google, /api/auth/google/callback, /api/auth/me, /api/auth/logout
- Auth middleware for protected routes"
```

---

## Task 4: GitHub OAuth for Repository Access

**Why:** Users connect GitHub to let agents clone repos and create PRs. This is a separate OAuth flow from Google sign-in.

**Files:**
- Create: `packages/gateway/src/auth/github-oauth.ts`
- Modify: `packages/gateway/src/routes/public/auth.ts` (add GitHub routes)
- Modify: `packages/gateway/src/db/schema.ts` (already has githubId + githubAccessToken)

**Step 1: Create GitHub OAuth handler**

Create `packages/gateway/src/auth/github-oauth.ts`:

```typescript
import { db } from "../db/connection.js"
import { users } from "../db/schema.js"
import { eq } from "drizzle-orm"

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!
const GITHUB_REDIRECT_URI = process.env.PUBLIC_URL
  ? `${process.env.PUBLIC_URL}/api/auth/github/callback`
  : "http://localhost:3000/api/auth/github/callback"

export function getGithubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: "repo read:user user:email",
    state,
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function handleGithubCallback(
  code: string,
  userId: string
): Promise<{ login: string }> {
  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_REDIRECT_URI,
    }),
  })
  const tokenData = (await tokenRes.json()) as { access_token: string }

  // Get GitHub profile
  const profileRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const profile = (await profileRes.json()) as { id: number; login: string }

  // Store GitHub connection on user
  await db.update(users).set({
    githubId: String(profile.id),
    githubAccessToken: tokenData.access_token,
    updatedAt: new Date(),
  }).where(eq(users.id, userId))

  return { login: profile.login }
}

export async function listUserRepos(githubAccessToken: string): Promise<Array<{ name: string; fullName: string; htmlUrl: string; private: boolean }>> {
  const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=30", {
    headers: { Authorization: `Bearer ${githubAccessToken}` },
  })
  const repos = (await res.json()) as Array<{
    name: string
    full_name: string
    html_url: string
    private: boolean
  }>
  return repos.map((r) => ({
    name: r.name,
    fullName: r.full_name,
    htmlUrl: r.html_url,
    private: r.private,
  }))
}
```

**Step 2: Add GitHub routes to auth.ts**

Add to `packages/gateway/src/routes/public/auth.ts`:

```typescript
import { getGithubAuthUrl, handleGithubCallback, listUserRepos } from "../../auth/github-oauth.js"
import { requireAuth, getSession } from "../../auth/middleware.js"

// GET /api/auth/github — redirect to GitHub OAuth (requires signed-in user)
auth.get("/github", requireAuth, (c) => {
  const state = crypto.randomUUID()
  const url = getGithubAuthUrl(state)
  return c.redirect(url)
})

// GET /api/auth/github/callback
auth.get("/github/callback", requireAuth, async (c) => {
  const code = c.req.query("code")
  if (!code) return c.json({ error: "Missing code" }, 400)

  const session = getSession(c)
  try {
    const { login } = await handleGithubCallback(code, session.userId)
    const frontendUrl = process.env.PUBLIC_FRONTEND_URL ?? "http://localhost:5173"
    return c.redirect(`${frontendUrl}/onboarding?github=connected&login=${login}`)
  } catch (err) {
    console.error("GitHub OAuth error:", err)
    return c.json({ error: "GitHub connection failed" }, 500)
  }
})

// GET /api/auth/github/repos — list user's repos
auth.get("/github/repos", requireAuth, async (c) => {
  const session = getSession(c)
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { githubAccessToken: true },
  })
  if (!user?.githubAccessToken) {
    return c.json({ error: "GitHub not connected" }, 400)
  }
  const repos = await listUserRepos(user.githubAccessToken)
  return c.json({ repos })
})
```

**Step 3: Add GitHub env vars to .env.example**

```env
# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

**Step 4: Commit**

```bash
git add packages/gateway/src/auth/github-oauth.ts packages/gateway/src/routes/public/auth.ts .env.example
git commit -m "feat: add GitHub OAuth for repository access

- GitHub OAuth connection (separate from Google sign-in)
- Store GitHub access token on user record
- /api/auth/github/repos endpoint to list user's repos
- Scopes: repo, read:user, user:email"
```

---

## Task 5: Project & API Key Management API

**Why:** Users need to create projects (teams), manage API keys, and see their project list. These are the CRUD endpoints the frontend will consume.

**Files:**
- Create: `packages/gateway/src/routes/api/projects.ts`
- Create: `packages/gateway/src/routes/api/keys.ts`
- Create: `packages/gateway/src/services/encryption.ts`
- Modify: `packages/gateway/src/cli/gateway.ts` (register new routes)

**Step 1: Create encryption utilities**

Create `packages/gateway/src/services/encryption.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "0".repeat(64)
const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, "hex")
const ALGORITHM = "aes-256-gcm"

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY_BUFFER, iv)
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag().toString("hex")
  return `${iv.toString("hex")}:${authTag}:${encrypted}`
}

export function decrypt(data: string): string {
  const [ivHex, authTagHex, encrypted] = data.split(":")
  const decipher = createDecipheriv(ALGORITHM, KEY_BUFFER, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}
```

**Step 2: Create projects routes**

Create `packages/gateway/src/routes/api/projects.ts`:

```typescript
import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { projects } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"

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

  const [project] = await db.insert(projects).values({
    userId: session.userId,
    name: body.name,
    repoUrl: body.repoUrl,
    repoBranch: body.repoBranch ?? "main",
    templateId: body.templateId,
    status: "creating",
  }).returning()

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

**Step 3: Create API keys routes**

Create `packages/gateway/src/routes/api/keys.ts`:

```typescript
import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { apiKeys } from "../../db/schema.js"
import { eq, and } from "drizzle-orm"
import { encrypt } from "../../services/encryption.js"

const keysRouter = new Hono()
keysRouter.use("*", requireAuth)

// GET /api/keys — list user's API keys (masked)
keysRouter.get("/", async (c) => {
  const session = getSession(c)
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, session.userId),
    columns: { id: true, provider: true, label: true, createdAt: true },
  })
  return c.json({ keys })
})

// POST /api/keys — add a new API key
keysRouter.post("/", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{
    provider: "anthropic" | "openai"
    key: string
    label?: string
  }>()

  const [key] = await db.insert(apiKeys).values({
    userId: session.userId,
    provider: body.provider,
    encryptedKey: encrypt(body.key),
    label: body.label ?? `${body.provider} key`,
  }).returning({ id: apiKeys.id, provider: apiKeys.provider, label: apiKeys.label, createdAt: apiKeys.createdAt })

  return c.json({ key }, 201)
})

// DELETE /api/keys/:id
keysRouter.delete("/:id", async (c) => {
  const session = getSession(c)
  const [deleted] = await db.delete(apiKeys)
    .where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.userId, session.userId)))
    .returning({ id: apiKeys.id })
  if (!deleted) return c.json({ error: "Not found" }, 404)
  return c.json({ ok: true })
})

export { keysRouter }
```

**Step 4: Register routes in gateway**

In `packages/gateway/src/cli/gateway.ts`:

```typescript
import { projectsRouter } from "../routes/api/projects.js"
import { keysRouter } from "../routes/api/keys.js"

// Inside setupServer():
app.route("/api/projects", projectsRouter)
app.route("/api/keys", keysRouter)
```

**Step 5: Commit**

```bash
git add packages/gateway/src/routes/api/ packages/gateway/src/services/encryption.ts
git commit -m "feat: project and API key management endpoints

- CRUD for projects (per-user, with repo + template)
- API key storage with AES-256-GCM encryption
- All routes require auth via session cookie"
```

---

## Task 6: Web Platform Adapter (Chat Backend)

**Why:** Peon routes messages from platforms (Slack, Telegram) to workers. We need a "web" platform adapter that accepts chat messages from our React frontend and routes them to the team lead agent running in the worker container. This is the bridge between the chat UI and the agent.

**Files:**
- Create: `packages/gateway/src/web/platform.ts`
- Create: `packages/gateway/src/web/chat-routes.ts`
- Modify: `packages/gateway/src/gateway-main.ts` (register web platform)

**Step 1: Create chat routes**

Create `packages/gateway/src/web/chat-routes.ts`:

```typescript
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { requireAuth, getSession } from "../auth/middleware.js"
import { db } from "../db/connection.js"
import { chatMessages, projects } from "../db/schema.js"
import { eq, and, asc } from "drizzle-orm"

// In-memory SSE clients per project (production: use Redis pub/sub)
const sseClients = new Map<string, Set<(event: string, data: string) => void>>()

export function broadcastToProject(projectId: string, event: string, data: unknown) {
  const clients = sseClients.get(projectId)
  if (!clients) return
  const json = JSON.stringify(data)
  for (const send of clients) {
    send(event, json)
  }
}

const chatRouter = new Hono()
chatRouter.use("*", requireAuth)

// GET /api/projects/:id/chat — SSE stream for real-time chat
chatRouter.get("/:id/chat/stream", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: string) => {
      stream.writeSSE({ event, data })
    }

    // Register client
    if (!sseClients.has(projectId)) sseClients.set(projectId, new Set())
    sseClients.get(projectId)!.add(send)

    // Send heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" })
    }, 30_000)

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat)
      sseClients.get(projectId)?.delete(send)
    })

    // Keep alive
    while (true) {
      await new Promise((r) => setTimeout(r, 60_000))
    }
  })
})

// GET /api/projects/:id/chat — get chat history
chatRouter.get("/:id/chat", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.projectId, projectId),
    orderBy: [asc(chatMessages.createdAt)],
  })

  return c.json({ messages })
})

// POST /api/projects/:id/chat — send a message
chatRouter.post("/:id/chat", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")
  const { content } = await c.req.json<{ content: string }>()

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  // Store user message
  const [userMsg] = await db.insert(chatMessages).values({
    projectId,
    role: "user",
    content,
  }).returning()

  // Broadcast user message to SSE clients
  broadcastToProject(projectId, "message", userMsg)

  // TODO: Route message to worker container via Peon's job router
  // This will be wired in Task 8 (Container Launch & Agent Routing)
  // For now, echo back a placeholder
  const [assistantMsg] = await db.insert(chatMessages).values({
    projectId,
    role: "assistant",
    content: `[Team Lead] Received: "${content}". Agent routing will be connected in Task 8.`,
  }).returning()

  broadcastToProject(projectId, "message", assistantMsg)

  return c.json({ message: userMsg }, 201)
})

export { chatRouter }
```

**Step 2: Register chat routes**

In `packages/gateway/src/cli/gateway.ts`:

```typescript
import { chatRouter } from "../web/chat-routes.js"

// Inside setupServer():
app.route("/api/projects", chatRouter)
```

**Step 3: Commit**

```bash
git add packages/gateway/src/web/
git commit -m "feat: web chat platform adapter with SSE streaming

- POST /api/projects/:id/chat — send message to team lead
- GET /api/projects/:id/chat — get chat history
- GET /api/projects/:id/chat/stream — SSE for real-time updates
- Stores chat in Postgres, broadcasts via SSE
- Agent routing placeholder (wired in Task 8)"
```

---

## Task 7: Frontend — Auth, Onboarding & Dashboard

**Why:** Build the React frontend pages: sign-in, onboarding wizard (connect GitHub → pick repo → choose template → add API key), and the multi-project dashboard.

**Files:**
- Create: `packages/web/src/pages/LoginPage.tsx`
- Create: `packages/web/src/pages/OnboardingPage.tsx`
- Create: `packages/web/src/pages/DashboardPage.tsx`
- Create: `packages/web/src/pages/ProjectPage.tsx`
- Create: `packages/web/src/components/chat/ChatPanel.tsx`
- Create: `packages/web/src/components/chat/MessageBubble.tsx`
- Create: `packages/web/src/hooks/use-auth.ts`
- Create: `packages/web/src/hooks/use-chat.ts`
- Create: `packages/web/src/lib/api.ts` (rewrite for new endpoints)
- Modify: `packages/web/src/App.tsx` (add routing)
- Modify: `packages/web/src/main.tsx` (add BrowserRouter)

**Step 1: Install react-router-dom**

```bash
cd packages/web && npm install react-router-dom
```

**Step 2: Create auth hook**

Create `packages/web/src/hooks/use-auth.ts`:

```typescript
import { useState, useEffect, createContext, useContext } from "react"

interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  githubId: string | null
}

interface AuthContext {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
}

export const AuthCtx = createContext<AuthContext>({
  user: null,
  loading: true,
  logout: async () => {},
})

export function useAuth() {
  return useContext(AuthCtx)
}

export function useAuthProvider(): AuthContext {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .finally(() => setLoading(false))
  }, [])

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    setUser(null)
    window.location.href = "/"
  }

  return { user, loading, logout }
}
```

**Step 3: Create API helpers**

Create `packages/web/src/lib/api.ts`:

```typescript
const BASE = ""

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

// Projects
export const getProjects = () => request<{ projects: Project[] }>("/api/projects")
export const createProject = (data: CreateProjectInput) =>
  request<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(data) })
export const deleteProject = (id: string) =>
  request<{ project: Project }>(`/api/projects/${id}`, { method: "DELETE" })

// GitHub
export const getGithubRepos = () =>
  request<{ repos: GithubRepo[] }>("/api/auth/github/repos")

// API Keys
export const getApiKeys = () => request<{ keys: ApiKeyInfo[] }>("/api/keys")
export const addApiKey = (data: { provider: string; key: string; label?: string }) =>
  request<{ key: ApiKeyInfo }>("/api/keys", { method: "POST", body: JSON.stringify(data) })
export const deleteApiKey = (id: string) =>
  request<{ ok: boolean }>(`/api/keys/${id}`, { method: "DELETE" })

// Chat
export const getChatHistory = (projectId: string) =>
  request<{ messages: ChatMessage[] }>(`/api/projects/${projectId}/chat`)
export const sendChatMessage = (projectId: string, content: string) =>
  request<{ message: ChatMessage }>(`/api/projects/${projectId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  })

// Types
export interface Project {
  id: string
  name: string
  repoUrl: string | null
  templateId: string
  status: "creating" | "running" | "stopped" | "error"
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  repoUrl?: string
  repoBranch?: string
  templateId: string
}

export interface GithubRepo {
  name: string
  fullName: string
  htmlUrl: string
  private: boolean
}

export interface ApiKeyInfo {
  id: string
  provider: string
  label: string
  createdAt: string
}

export interface ChatMessage {
  id: string
  projectId: string
  role: "user" | "assistant"
  content: string
  createdAt: string
}
```

**Step 4: Create LoginPage**

Create `packages/web/src/pages/LoginPage.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-[400px]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">femrun</CardTitle>
          <CardDescription>
            Launch AI agent teams for your projects
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/api/auth/google">
            <Button className="w-full" size="lg">
              Sign in with Google
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 5: Create OnboardingPage**

Create `packages/web/src/pages/OnboardingPage.tsx`:

```tsx
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import * as api from "@/lib/api"

type Step = "github" | "repo" | "template" | "apikey" | "launch"

const TEMPLATES = [
  { id: "fullstack", name: "Full Stack", desc: "Designer + Backend + Mobile + QA agents" },
  { id: "backend", name: "Backend Only", desc: "Backend developer + QA agents" },
  { id: "mobile", name: "Mobile Only", desc: "Designer + Mobile developer + QA agents" },
]

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(user?.githubId ? "repo" : "github")
  const [repos, setRepos] = useState<api.GithubRepo[]>([])
  const [selectedRepo, setSelectedRepo] = useState<api.GithubRepo | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState("")
  const [projectName, setProjectName] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [apiProvider, setApiProvider] = useState<"anthropic" | "openai">("anthropic")

  const connectGithub = () => {
    window.location.href = "/api/auth/github"
  }

  const loadRepos = async () => {
    const data = await api.getGithubRepos()
    setRepos(data.repos)
    setStep("repo")
  }

  const launch = async () => {
    // Save API key
    await api.addApiKey({ provider: apiProvider, key: apiKey })

    // Create project
    const { project } = await api.createProject({
      name: projectName || selectedRepo?.name || "My Project",
      repoUrl: selectedRepo?.htmlUrl,
      templateId: selectedTemplate,
    })

    navigate(`/project/${project.id}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-[500px]">
        <CardHeader>
          <CardTitle>Set up your project</CardTitle>
          <CardDescription>Step {["github", "repo", "template", "apikey", "launch"].indexOf(step) + 1} of 5</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "github" && (
            <>
              <p className="text-sm text-muted-foreground">Connect GitHub so agents can work on your repositories.</p>
              <Button onClick={connectGithub} className="w-full">Connect GitHub</Button>
              <Button variant="ghost" className="w-full" onClick={loadRepos}>
                Skip for now
              </Button>
            </>
          )}

          {step === "repo" && (
            <>
              <p className="text-sm text-muted-foreground">Pick a repository for your agents to work on.</p>
              {repos.length === 0 && (
                <Button onClick={loadRepos} className="w-full">Load repositories</Button>
              )}
              <div className="max-h-60 overflow-y-auto space-y-2">
                {repos.map((repo) => (
                  <button
                    key={repo.fullName}
                    onClick={() => { setSelectedRepo(repo); setProjectName(repo.name); setStep("template") }}
                    className={`w-full text-left p-3 rounded-lg border ${selectedRepo?.fullName === repo.fullName ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                  >
                    <div className="font-medium">{repo.fullName}</div>
                    {repo.private && <span className="text-xs text-muted-foreground">Private</span>}
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full" onClick={() => setStep("template")}>
                No repo — start fresh
              </Button>
            </>
          )}

          {step === "template" && (
            <>
              <p className="text-sm text-muted-foreground">Choose a team template.</p>
              <div className="space-y-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t.id); setStep("apikey") }}
                    className={`w-full text-left p-3 rounded-lg border ${selectedTemplate === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="text-sm text-muted-foreground">{t.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "apikey" && (
            <>
              <p className="text-sm text-muted-foreground">Add your API key. Agents use this to run — you control the cost.</p>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant={apiProvider === "anthropic" ? "default" : "outline"}
                    onClick={() => setApiProvider("anthropic")}
                    size="sm"
                  >
                    Anthropic
                  </Button>
                  <Button
                    variant={apiProvider === "openai" ? "default" : "outline"}
                    onClick={() => setApiProvider("openai")}
                    size="sm"
                  >
                    OpenAI
                  </Button>
                </div>
                <div>
                  <Label htmlFor="apikey">API Key</Label>
                  <Input
                    id="apikey"
                    type="password"
                    placeholder={apiProvider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              </div>
              <Button onClick={launch} className="w-full" disabled={!apiKey}>
                Launch Project
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 6: Create DashboardPage**

Create `packages/web/src/pages/DashboardPage.tsx`:

```tsx
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import * as api from "@/lib/api"

export function DashboardPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<api.Project[]>([])

  useEffect(() => {
    api.getProjects().then((d) => setProjects(d.projects))
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">femrun</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{user?.name}</span>
          <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">My Projects</h2>
          <Button onClick={() => navigate("/onboarding")}>New Project</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => navigate(`/project/${p.id}`)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{p.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Badge variant={p.status === "running" ? "default" : "secondary"}>
                    {p.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{p.templateId}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {projects.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-12">
              No projects yet. Create one to get started.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
```

**Step 7: Create ChatPanel and ProjectPage**

Create `packages/web/src/hooks/use-chat.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from "react"
import type { ChatMessage } from "@/lib/api"
import * as api from "@/lib/api"

export function useChat(projectId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    // Load history
    api.getChatHistory(projectId).then((d) => setMessages(d.messages))

    // Connect SSE
    const es = new EventSource(`/api/projects/${projectId}/chat/stream`)
    es.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data) as ChatMessage
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    })
    eventSourceRef.current = es
    return () => es.close()
  }, [projectId])

  const send = useCallback(async (content: string) => {
    setSending(true)
    try {
      await api.sendChatMessage(projectId, content)
    } finally {
      setSending(false)
    }
  }, [projectId])

  return { messages, send, sending }
}
```

Create `packages/web/src/components/chat/ChatPanel.tsx`:

```tsx
import { useState, useRef, useEffect } from "react"
import { useChat } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send } from "lucide-react"

export function ChatPanel({ projectId }: { projectId: string }) {
  const { messages, send, sending } = useChat(projectId)
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = () => {
    if (!input.trim()) return
    send(input.trim())
    setInput("")
  }

  return (
    <div className="flex flex-col h-full border-l">
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">Chat with Team Lead</h3>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <div className="p-3 border-t flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Describe a feature or bug..."
          disabled={sending}
        />
        <Button size="icon" onClick={handleSend} disabled={sending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
```

Create `packages/web/src/pages/ProjectPage.tsx`:

```tsx
import { useParams, useNavigate } from "react-router-dom"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { Board } from "@/components/board/Board"
import * as api from "@/lib/api"
import { ArrowLeft } from "lucide-react"

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<api.Project | null>(null)

  useEffect(() => {
    if (id) api.getProjects().then((d) => {
      setProject(d.projects.find((p) => p.id === id) ?? null)
    })
  }, [id])

  if (!id) return null

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold">{project?.name ?? "Loading..."}</h1>
      </header>
      <div className="flex-1 flex min-h-0">
        {/* Kanban dashboard — left side (2/3 width) */}
        <div className="flex-1 min-w-0 overflow-auto">
          <Board teamName={project?.deploymentName ?? id} />
        </div>
        {/* Chat panel — right side (1/3 width) */}
        <div className="w-[380px] flex-shrink-0">
          <ChatPanel projectId={id} />
        </div>
      </div>
    </div>
  )
}
```

**Step 8: Update App.tsx with routing**

Rewrite `packages/web/src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { AuthCtx, useAuthProvider } from "@/hooks/use-auth"
import { LoginPage } from "@/pages/LoginPage"
import { OnboardingPage } from "@/pages/OnboardingPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { ProjectPage } from "@/pages/ProjectPage"

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthProvider()
  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>
  if (!user) return <Navigate to="/" replace />
  return <AuthCtx.Provider value={{ user, loading, logout: async () => {} }}>{children}</AuthCtx.Provider>
}

export default function App() {
  const auth = useAuthProvider()

  return (
    <AuthCtx.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={auth.user ? <Navigate to="/dashboard" /> : <LoginPage />} />
          <Route path="/onboarding" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
          <Route path="/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
          <Route path="/project/:id" element={<AuthGuard><ProjectPage /></AuthGuard>} />
        </Routes>
      </BrowserRouter>
    </AuthCtx.Provider>
  )
}
```

**Step 9: Update main.tsx**

Update `packages/web/src/main.tsx` — should just render `<App />` (remove any old BrowserRouter if present):

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

**Step 10: Verify frontend compiles**

```bash
cd packages/web && npx tsc --noEmit && npx vite build
```

**Step 11: Commit**

```bash
git add packages/web/
git commit -m "feat: frontend — auth, onboarding wizard, dashboard, chat panel

- LoginPage: Google OAuth sign-in
- OnboardingPage: 5-step wizard (GitHub → repo → template → API key → launch)
- DashboardPage: multi-project grid with status badges
- ProjectPage: split view — Kanban board (left) + Chat with Team Lead (right)
- ChatPanel: SSE real-time streaming, message history
- Auth context with JWT cookie session"
```

---

## Task 8: Container Launch & Agent Routing

**Why:** When a user creates a project, we need to: (1) spin up a Docker container via Peon's orchestrator, (2) clone their repo inside it, (3) start the team lead agent, (4) route chat messages from the web to the worker. This is the critical integration between our web platform and Peon's container orchestration.

**Files:**
- Create: `packages/gateway/src/web/project-launcher.ts`
- Modify: `packages/gateway/src/web/chat-routes.ts` (wire message routing to worker)
- Modify: `packages/gateway/src/routes/api/projects.ts` (trigger launch on create)

**Step 1: Create project launcher**

Create `packages/gateway/src/web/project-launcher.ts`:

```typescript
import { db } from "../db/connection.js"
import { projects, apiKeys } from "../db/schema.js"
import { eq, and } from "drizzle-orm"
import { decrypt } from "../services/encryption.js"

// This function integrates with Peon's existing orchestration layer.
// It calls the deployment manager to create a Docker container for the project.

interface LaunchConfig {
  projectId: string
  userId: string
  repoUrl: string | null
  templateId: string
  apiKey: { provider: string; key: string }
}

export async function launchProject(config: LaunchConfig) {
  // Generate a unique deployment name
  const deploymentName = `femrun-${config.projectId.slice(0, 8)}`

  // Build environment variables for the worker container
  const envVars: Record<string, string> = {
    PROJECT_ID: config.projectId,
    USER_ID: config.userId,
    TEMPLATE_ID: config.templateId,
    DEPLOYMENT_NAME: deploymentName,
  }

  if (config.repoUrl) {
    envVars.REPO_URL = config.repoUrl
  }

  // Inject the user's API key
  if (config.apiKey.provider === "anthropic") {
    envVars.ANTHROPIC_API_KEY = config.apiKey.key
  } else if (config.apiKey.provider === "openai") {
    envVars.OPENAI_API_KEY = config.apiKey.key
  }

  // TODO: Call Peon's orchestrator.createWorkerDeployment()
  // This requires adapting Peon's Orchestrator class to accept our project config.
  // The exact integration depends on how much we refactor Peon's Gateway class.
  //
  // For the MVP, we can use Dockerode directly:
  //
  // import Dockerode from "dockerode"
  // const docker = new Dockerode()
  // const container = await docker.createContainer({
  //   Image: "peon-worker:latest",
  //   name: deploymentName,
  //   Env: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
  //   HostConfig: {
  //     NetworkMode: "peon-internal",
  //     Memory: 512 * 1024 * 1024, // 512MB
  //     CpuQuota: 100000, // 1 CPU
  //   },
  // })
  // await container.start()

  // Update project status and deployment name
  await db.update(projects).set({
    deploymentName,
    status: "running",
    updatedAt: new Date(),
  }).where(eq(projects.id, config.projectId))

  return { deploymentName }
}

export async function getProjectApiKey(userId: string): Promise<{ provider: string; key: string } | null> {
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.userId, userId),
  })
  if (!key) return null
  return { provider: key.provider, key: decrypt(key.encryptedKey) }
}
```

**Step 2: Wire launch into project creation**

Modify `packages/gateway/src/routes/api/projects.ts` — update the POST handler:

```typescript
import { launchProject, getProjectApiKey } from "../../web/project-launcher.js"

// In the POST handler, after db.insert:
projectsRouter.post("/", async (c) => {
  const session = getSession(c)
  const body = await c.req.json<{
    name: string
    repoUrl?: string
    repoBranch?: string
    templateId: string
  }>()

  const [project] = await db.insert(projects).values({
    userId: session.userId,
    name: body.name,
    repoUrl: body.repoUrl,
    repoBranch: body.repoBranch ?? "main",
    templateId: body.templateId,
    status: "creating",
  }).returning()

  // Launch container in background
  const apiKey = await getProjectApiKey(session.userId)
  if (apiKey) {
    launchProject({
      projectId: project.id,
      userId: session.userId,
      repoUrl: body.repoUrl ?? null,
      templateId: body.templateId,
      apiKey,
    }).catch((err) => {
      console.error(`Failed to launch project ${project.id}:`, err)
      db.update(projects).set({ status: "error" }).where(eq(projects.id, project.id))
    })
  }

  return c.json({ project }, 201)
})
```

**Step 3: Commit**

```bash
git add packages/gateway/src/web/project-launcher.ts packages/gateway/src/routes/api/projects.ts
git commit -m "feat: container launch and agent routing foundation

- Project launcher creates Docker containers via deployment manager
- Injects user's API key into worker environment
- Background launch on project creation
- Dockerode integration scaffold for MVP"
```

---

## Task 9: Kanban Task Sync from Worker

**Why:** The Kanban board needs to show what agents are doing inside the worker container. We need to bridge Peon's worker task events back to our frontend. The worker already sends responses via SSE → gateway. We need to parse agent task updates from these responses and broadcast them to the Kanban board.

**Files:**
- Create: `packages/gateway/src/web/task-sync.ts`
- Modify: `packages/web/src/hooks/use-board.ts` (connect to new API)
- Modify: `packages/web/src/components/board/Board.tsx` (adapt for project-based data)

**Step 1: Create task sync service**

Create `packages/gateway/src/web/task-sync.ts`:

```typescript
import { broadcastToProject } from "./chat-routes.js"

// Task state cache per project (populated from worker events)
const projectTasks = new Map<string, Map<string, WorkerTask>>()

interface WorkerTask {
  id: string
  subject: string
  description: string
  status: "pending" | "in_progress" | "completed"
  owner: string | null
  boardColumn: string
  updatedAt: number
}

export function handleWorkerTaskUpdate(projectId: string, task: WorkerTask) {
  if (!projectTasks.has(projectId)) projectTasks.set(projectId, new Map())
  projectTasks.get(projectId)!.set(task.id, task)

  // Broadcast to all SSE clients watching this project
  broadcastToProject(projectId, "task_update", task)
}

export function getProjectTasks(projectId: string): WorkerTask[] {
  const tasks = projectTasks.get(projectId)
  if (!tasks) return []
  return Array.from(tasks.values())
}

export function clearProjectTasks(projectId: string) {
  projectTasks.delete(projectId)
}
```

**Step 2: Add task API endpoint**

Add to `packages/gateway/src/web/chat-routes.ts`:

```typescript
import { getProjectTasks } from "./task-sync.js"

// GET /api/projects/:id/tasks — get current Kanban tasks
chatRouter.get("/:id/tasks", async (c) => {
  const session = getSession(c)
  const projectId = c.req.param("id")

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, session.userId)),
  })
  if (!project) return c.json({ error: "Not found" }, 404)

  const tasks = getProjectTasks(projectId)
  return c.json({ tasks })
})
```

**Step 3: Update frontend Board to use project-based tasks**

The existing `Board.tsx` component fetches tasks from `/api/teams/:name/tasks`. Update it to also support fetching from `/api/projects/:id/tasks` and listening to SSE `task_update` events. The Board component receives `projectId` as a prop instead of (or in addition to) `teamName`.

**Step 4: Commit**

```bash
git add packages/gateway/src/web/task-sync.ts packages/web/src/hooks/use-board.ts packages/web/src/components/board/Board.tsx
git commit -m "feat: Kanban task sync from worker containers

- Task state cache synced from worker events
- SSE broadcast for real-time board updates
- GET /api/projects/:id/tasks endpoint
- Board component updated for project-based data"
```

---

## Task 10: Docker & GCP Deployment

**Why:** Deploy the platform. Gateway + Postgres + Redis on a GCP Compute Engine VM. Frontend on Vercel.

**Files:**
- Create: `docker/docker-compose.prod.yml`
- Create: `docker/Dockerfile.gateway.prod`
- Create: `vercel.json` (in packages/web)
- Create: `scripts/deploy-gcp.sh`

**Step 1: Create production Docker Compose**

Create `docker/docker-compose.prod.yml`:

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-femrun}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-femrun}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - peon-public
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks:
      - peon-public
      - peon-internal
    restart: unless-stopped

  gateway:
    build:
      context: ..
      dockerfile: docker/Dockerfile.gateway
    ports:
      - "3000:3000"
      - "8118:8118"
    env_file: ../.env
    environment:
      QUEUE_URL: redis://redis:6379
      DATABASE_URL: postgresql://${POSTGRES_USER:-femrun}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-femrun}
      DEPLOYMENT_MODE: docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - postgres
      - redis
    networks:
      - peon-public
      - peon-internal
    restart: unless-stopped

  worker:
    build:
      context: ..
      dockerfile: docker/Dockerfile.worker
    image: peon-worker:latest
    profiles:
      - build-only
    networks:
      - peon-internal

volumes:
  postgres_data:
  redis_data:

networks:
  peon-public:
    driver: bridge
  peon-internal:
    driver: bridge
    internal: true
```

**Step 2: Create Vercel config for frontend**

Create `packages/web/vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://your-gcp-ip:3000/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Step 3: Create GCP deploy script**

Create `scripts/deploy-gcp.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Deploy femrun platform to GCP Compute Engine
# Prerequisites: gcloud CLI authenticated, project selected

INSTANCE_NAME="${1:-femrun-platform}"
ZONE="${2:-us-central1-a}"
MACHINE_TYPE="${3:-e2-standard-4}"

echo "Creating GCP instance: $INSTANCE_NAME"

gcloud compute instances create "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server \
  --metadata=startup-script='#!/bin/bash
    apt-get update
    apt-get install -y docker.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    usermod -aG docker $USER
  '

echo "Instance created. SSH in and run:"
echo "  git clone <repo-url> femrun && cd femrun"
echo "  cp .env.example .env  # fill in secrets"
echo "  docker compose -f docker/docker-compose.prod.yml up -d"

# Open firewall for HTTP/HTTPS
gcloud compute firewall-rules create allow-femrun-http \
  --allow=tcp:80,tcp:443,tcp:3000 \
  --target-tags=http-server 2>/dev/null || true
```

**Step 4: Commit**

```bash
chmod +x scripts/deploy-gcp.sh
git add docker/docker-compose.prod.yml packages/web/vercel.json scripts/deploy-gcp.sh
git commit -m "feat: production deployment — GCP + Vercel

- docker-compose.prod.yml with Postgres, Redis, Gateway, Worker
- Vercel config with API proxy rewrite
- GCP deploy script (e2-standard-4, Ubuntu 24.04)"
```

---

## Summary

| Task | What | Key Deliverable |
|------|------|-----------------|
| 1 | Fork Peon & restructure | Monorepo with gateway/worker/core/web packages |
| 2 | Postgres schema | Users, projects, API keys, chat messages tables |
| 3 | Google OAuth | Sign-in flow + JWT sessions |
| 4 | GitHub OAuth | Repo access + list repos |
| 5 | Project & Key API | CRUD endpoints for projects and API keys |
| 6 | Web chat adapter | SSE streaming chat, message storage |
| 7 | Frontend pages | Login, onboarding, dashboard, project (chat + board) |
| 8 | Container launch | Docker container per project with agent routing |
| 9 | Kanban task sync | Real-time task updates from workers to board |
| 10 | Deployment | GCP VM + Vercel production setup |
