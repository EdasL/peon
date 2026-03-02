import { Hono } from "hono"
import { requireAuth, getSession } from "../../auth/middleware.js"
import { db } from "../../db/connection.js"
import { users } from "../../db/schema.js"
import { eq } from "drizzle-orm"

const userRouter = new Hono()
userRouter.use("*", requireAuth)

// DELETE /api/user — delete account (cascade handles projects, keys, chat)
userRouter.delete("/", async (c) => {
  const session = getSession(c)
  await db.delete(users).where(eq(users.id, session.userId))
  c.header("set-cookie", "session=; Path=/; HttpOnly; Max-Age=0")
  return c.json({ ok: true })
})

export { userRouter }
