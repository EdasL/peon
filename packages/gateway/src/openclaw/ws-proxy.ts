/**
 * WebSocket proxy — bridges browser clients to their container's OpenClaw gateway.
 *
 * Authenticates the user via session cookie, resolves their container's
 * OpenClaw WS URL, and relays messages bidirectionally. This gives the
 * dashboard frontend full OpenClaw protocol access (files, sessions, config,
 * tokens) without the gateway needing to understand every feature.
 *
 * Adapted from Nerve's ws-proxy.ts, simplified for our use case.
 */

import type { Server as HttpServer } from "node:http"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer } from "ws"
import { createLogger } from "@lobu/core"
import { verifySessionToken } from "../auth/session.js"
import { db } from "../db/connection.js"
import { users, projects } from "../db/schema.js"
import { eq, and } from "drizzle-orm"
import { getPeonDeploymentName } from "../web/container-manager.js"
import { getOpenClawWsUrl, getOpenClawToken } from "../orchestration/impl/docker-deployment.js"

const logger = createLogger("openclaw-ws-proxy")

const PING_INTERVAL_MS = 30_000

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1]
}

/**
 * Set up the WebSocket proxy on the HTTP server.
 * Listens for upgrade requests on `/api/ws` and proxies them to the
 * user's container's OpenClaw gateway.
 */
export function setupOpenClawWsProxy(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url?.startsWith("/api/ws")) {
      // Not our upgrade — ignore (other WS handlers may exist)
      return
    }

    // Authenticate via session cookie
    const token = parseCookie(req.headers.cookie, "session")
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nAuthentication required")
      socket.destroy()
      return
    }

    let session: { userId: string; email: string }
    try {
      session = await verifySessionToken(token)
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nInvalid session")
      socket.destroy()
      return
    }

    // Parse projectId from query string if present
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`)
    const projectId = url.searchParams.get("projectId")

    // Resolve container's OpenClaw WS URL and auth token
    const resolved = projectId
      ? await resolveProjectOpenClawInfo(session.userId, projectId)
      : await resolveUserOpenClawInfo(session.userId)

    if (!resolved) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nNo active container")
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      createRelay(clientWs, resolved.wsUrl, session.userId, resolved.token)
    })
  })
}

/**
 * Look up the user's container OpenClaw WS URL and auth token.
 */
async function resolveUserOpenClawInfo(userId: string): Promise<{ wsUrl: string; token?: string } | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { peonAgentId: true },
  })
  if (!user?.peonAgentId) return null

  const deploymentName = getPeonDeploymentName(userId, user.peonAgentId)
  const wsUrl = getOpenClawWsUrl(deploymentName)
  if (!wsUrl) return null

  const token = getOpenClawToken(deploymentName)
  return { wsUrl, token }
}

/**
 * Look up a specific project's container OpenClaw WS URL and auth token.
 * Verifies the project belongs to the requesting user.
 */
async function resolveProjectOpenClawInfo(
  userId: string,
  projectId: string,
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

/**
 * Intercept the browser's `connect` JSON-RPC request and inject the
 * container's gateway auth token. All subsequent messages pass through
 * unmodified.
 */
function patchConnectFrame(raw: Buffer | ArrayBuffer | Buffer[], gatewayToken: string): Buffer | ArrayBuffer | Buffer[] {
  try {
    const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : Buffer.concat(raw as Buffer[]).toString("utf8")
    const frame = JSON.parse(text)
    if (frame?.type === "req" && frame?.method === "connect" && frame?.params) {
      frame.params.auth = { ...frame.params.auth, token: gatewayToken }
      return Buffer.from(JSON.stringify(frame), "utf8")
    }
  } catch {
    // Not JSON or unexpected shape — pass through
  }
  return raw
}

/**
 * Create a bidirectional relay between the browser WebSocket and the
 * container's OpenClaw gateway WebSocket.
 */
function createRelay(clientWs: WebSocket, targetUrl: string, userId: string, gatewayToken?: string): void {
  const tag = `[ws-proxy:${userId.substring(0, 8)}]`
  logger.info(`${tag} Connecting to OpenClaw at ${targetUrl}`)

  // OpenClaw's webchat-ui origin check validates the HTTP Origin header.
  // Derive the expected origin from the target URL so the gateway accepts it.
  const targetOrigin = new URL(targetUrl.replace(/^ws/, "http")).origin
  const gwWs = new WebSocket(targetUrl, { headers: { Origin: targetOrigin } })
  let clientAlive = true
  let gwAlive = true
  let connectInjected = !gatewayToken

  // Keepalive pings
  const pingTimer = setInterval(() => {
    if (!clientAlive) {
      logger.info(`${tag} Client pong timeout — terminating`)
      clientWs.terminate()
      return
    }
    clientAlive = false
    if (clientWs.readyState === WebSocket.OPEN) clientWs.ping()

    if (gwWs && !gwAlive) {
      logger.info(`${tag} Gateway pong timeout — terminating`)
      gwWs.terminate()
      return
    }
    gwAlive = false
    if (gwWs.readyState === WebSocket.OPEN) gwWs.ping()
  }, PING_INTERVAL_MS)

  clientWs.on("pong", () => { clientAlive = true })
  gwWs.on("pong", () => { gwAlive = true })

  // Client -> Gateway (inject auth token into first connect request)
  clientWs.on("message", (data, isBinary) => {
    if (gwWs.readyState === WebSocket.OPEN) {
      if (!connectInjected && gatewayToken && !isBinary) {
        const modified = patchConnectFrame(data, gatewayToken)
        connectInjected = true
        gwWs.send(modified, { binary: false })
      } else {
        gwWs.send(data, { binary: isBinary })
      }
    }
  })

  // Gateway -> Client
  gwWs.on("message", (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary })
    }
  })

  // Cleanup on either side closing
  const cleanup = () => {
    clearInterval(pingTimer)
    if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
      clientWs.close(1001, "Relay closed")
    }
    if (gwWs.readyState === WebSocket.OPEN || gwWs.readyState === WebSocket.CONNECTING) {
      gwWs.close(1001, "Relay closed")
    }
  }

  clientWs.on("close", () => {
    logger.info(`${tag} Client disconnected`)
    cleanup()
  })

  clientWs.on("error", (err) => {
    logger.warn(`${tag} Client error: ${err.message}`)
    cleanup()
  })

  gwWs.on("close", () => {
    logger.info(`${tag} Gateway connection closed`)
    cleanup()
  })

  gwWs.on("error", (err) => {
    logger.warn(`${tag} Gateway error: ${err.message}`)
    cleanup()
  })

  gwWs.on("open", () => {
    logger.info(`${tag} Relay established`)
  })
}
