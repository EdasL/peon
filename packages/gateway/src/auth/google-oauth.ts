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
    const result = await db.insert(users).values({
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      googleId: profile.sub,
    }).returning()
    const newUser = result[0]
    if (!newUser) throw new Error("Failed to create user")
    userId = newUser.id
    isNew = true
  }

  const token = await createSessionToken({ userId, email: profile.email })
  return { token, isNew }
}
