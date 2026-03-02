import type { Context, Next } from "hono"
import { getCookie } from "hono/cookie"
import { verifySessionToken, type SessionPayload } from "./session.js"

export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, "session")
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
