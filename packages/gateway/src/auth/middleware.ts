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
