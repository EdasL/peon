import { db } from "../db/connection.js"
import { users } from "../db/schema.js"
import { eq } from "drizzle-orm"
import { encrypt } from "../services/encryption.js"

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
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string }
  if (!tokenData.access_token || tokenData.error) {
    throw new Error(`GitHub token exchange failed: ${tokenData.error ?? "no access_token"} — ${tokenData.error_description ?? ""}`)
  }

  // Get GitHub profile
  const profileRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const profile = (await profileRes.json()) as { id: number; login: string }

  // Check if this GitHub account is already linked to a different user
  const existingLink = await db.query.users.findFirst({
    where: eq(users.githubId, String(profile.id)),
    columns: { id: true },
  })
  if (existingLink && existingLink.id !== userId) {
    const err = new Error("This GitHub account is already linked to another user")
    ;(err as any).code = "GITHUB_ALREADY_LINKED"
    throw err
  }

  // Store GitHub connection on current user (encrypted)
  await db.update(users).set({
    githubId: String(profile.id),
    githubAccessToken: encrypt(tokenData.access_token),
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
