/**
 * Redis pub/sub broadcast for SSE events.
 * Enables multi-instance gateway deployment by routing SSE broadcasts
 * through Redis channels instead of process-local Maps.
 */
import Redis from "ioredis"
import { createLogger } from "@lobu/core"

const logger = createLogger("redis-broadcast")

let publisher: Redis | null = null
let subscriber: Redis | null = null

// Local listeners per channel: channel -> Set of SSE send functions
const channelListeners = new Map<string, Set<(event: string, data: string) => void>>()

/**
 * Initialize Redis pub/sub with the given Redis URL.
 * Creates separate publisher and subscriber connections
 * (ioredis requires a dedicated connection for subscribe mode).
 */
export function initBroadcast(redisUrl: string): void {
  publisher = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true })
  subscriber = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true })

  subscriber.on("message", (channel: string, message: string) => {
    const listeners = channelListeners.get(channel)
    if (!listeners || listeners.size === 0) return

    try {
      const { event, data } = JSON.parse(message) as { event: string; data: string }
      for (const send of listeners) {
        send(event, data)
      }
    } catch (err) {
      logger.error(`Failed to parse pub/sub message on ${channel}:`, err)
    }
  })

  publisher.connect().catch((err) => {
    logger.error("Redis publisher connection failed:", err)
  })
  subscriber.connect().catch((err) => {
    logger.error("Redis subscriber connection failed:", err)
  })

  logger.info("Redis broadcast initialized")
}

/**
 * Broadcast an event to all SSE clients watching a project,
 * across all gateway instances.
 */
export function broadcastToProject(projectId: string, event: string, data: unknown): void {
  const channel = `peon:project:${projectId}`
  const json = JSON.stringify(data)
  const payload = JSON.stringify({ event, data: json })

  if (publisher) {
    publisher.publish(channel, payload).catch((err) => {
      logger.error(`Failed to publish to ${channel}:`, err)
    })
  } else {
    // Fallback: deliver locally only (no Redis)
    deliverLocally(channel, event, json)
  }
}

/**
 * Deliver an event to local SSE clients on this gateway instance.
 * Called by the subscriber when a Redis message arrives,
 * or directly when Redis is not configured.
 */
function deliverLocally(channel: string, event: string, data: string): void {
  const listeners = channelListeners.get(channel)
  if (!listeners) return
  for (const send of listeners) {
    send(event, data)
  }
}

/**
 * Subscribe an SSE client to a project's broadcast channel.
 * Returns an unsubscribe function for cleanup on disconnect.
 */
export function subscribeClient(
  projectId: string,
  send: (event: string, data: string) => void
): () => void {
  return subscribeToChannel(`peon:project:${projectId}`, send)
}

/**
 * Broadcast an event to all SSE clients watching a user's master chat.
 */
export function broadcastToUser(userId: string, event: string, data: unknown): void {
  const channel = `peon:user:${userId}`
  const json = JSON.stringify(data)
  const payload = JSON.stringify({ event, data: json })

  if (publisher) {
    publisher.publish(channel, payload).catch((err) => {
      logger.error(`Failed to publish to ${channel}:`, err)
    })
  } else {
    deliverLocally(channel, event, json)
  }
}

/**
 * Subscribe an SSE client to a user's master chat broadcast channel.
 */
export function subscribeUserClient(
  userId: string,
  send: (event: string, data: string) => void
): () => void {
  return subscribeToChannel(`peon:user:${userId}`, send)
}

function subscribeToChannel(
  channel: string,
  send: (event: string, data: string) => void
): () => void {
  if (!channelListeners.has(channel)) {
    channelListeners.set(channel, new Set())
    if (subscriber) {
      subscriber.subscribe(channel).catch((err) => {
        logger.error(`Failed to subscribe to ${channel}:`, err)
      })
    }
  }
  channelListeners.get(channel)!.add(send)

  return () => {
    const listeners = channelListeners.get(channel)
    if (!listeners) return
    listeners.delete(send)
    if (listeners.size === 0) {
      channelListeners.delete(channel)
      if (subscriber) {
        subscriber.unsubscribe(channel).catch((err) => {
          logger.error(`Failed to unsubscribe from ${channel}:`, err)
        })
      }
    }
  }
}
