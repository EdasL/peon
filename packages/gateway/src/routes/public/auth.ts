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
