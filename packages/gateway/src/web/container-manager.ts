/**
 * Peon container manager
 *
 * Provides Docker container status queries and cleanup for Peon projects.
 * The Peon platform gives each user a single persistent worker container
 * whose name is derived from lobuAgentId (the canonical conversationId for
 * the peon platform channel).
 */

import { createLogger } from "@lobu/core"
import Docker from "dockerode"
import { generateDeploymentName } from "../orchestration/base-deployment-manager.js"

const logger = createLogger("peon-container-manager")

/** Map Docker container states to Peon's status enum */
function mapDockerStateToPeonStatus(
  state: string
): "starting" | "running" | "stopped" | "error" {
  switch (state.toLowerCase()) {
    case "running":
      return "running"
    case "created":
    case "restarting":
      return "starting"
    case "exited":
    case "dead":
    case "removing":
      return "stopped"
    case "paused":
      return "stopped"
    default:
      return "error"
  }
}

/**
 * Derive the Docker container (deployment) name for a Peon user.
 *
 * Peon uses lobuAgentId as both channelId and conversationId on the "peon" platform.
 * This mirrors exactly what project-launcher.ts passes to the queue.
 */
export function getPeonDeploymentName(
  userId: string,
  lobuAgentId: string
): string {
  return generateDeploymentName({
    userId,
    platform: "peon",
    channelId: lobuAgentId,
    conversationId: lobuAgentId,
  })
}

/**
 * Query the Docker daemon for the actual state of the user's worker container.
 * Returns one of the Peon status values, or null if Docker is unavailable.
 */
export async function getContainerStatus(
  deploymentName: string
): Promise<"starting" | "running" | "stopped" | "error" | null> {
  let docker: Docker
  try {
    docker = new Docker({ socketPath: "/var/run/docker.sock" })
  } catch (err) {
    logger.warn("Could not connect to Docker daemon:", err)
    return null
  }

  try {
    const container = docker.getContainer(deploymentName)
    const info = await container.inspect()
    return mapDockerStateToPeonStatus(info.State.Status)
  } catch (err: any) {
    // 404 → container does not exist → stopped
    if (err?.statusCode === 404 || err?.message?.includes("No such container")) {
      return "stopped"
    }
    logger.warn(`Could not inspect container ${deploymentName}:`, err)
    return null
  }
}

/**
 * Stop and remove a Docker container by deployment name.
 * Safe to call even if container does not exist.
 */
export async function removeContainer(deploymentName: string): Promise<void> {
  let docker: Docker
  try {
    docker = new Docker({ socketPath: "/var/run/docker.sock" })
  } catch (err) {
    logger.warn("Could not connect to Docker daemon for cleanup:", err)
    return
  }

  try {
    const container = docker.getContainer(deploymentName)
    // Stop with 10s timeout, then force-remove
    try {
      await container.stop({ t: 10 })
      logger.info(`Stopped container: ${deploymentName}`)
    } catch (stopErr: any) {
      // Already stopped or not found — both are fine
      if (
        stopErr?.statusCode !== 304 &&
        stopErr?.statusCode !== 404 &&
        !stopErr?.message?.includes("No such container")
      ) {
        logger.warn(`Error stopping container ${deploymentName}:`, stopErr)
      }
    }

    try {
      await container.remove({ force: true })
      logger.info(`Removed container: ${deploymentName}`)
    } catch (removeErr: any) {
      if (
        removeErr?.statusCode !== 404 &&
        !removeErr?.message?.includes("No such container")
      ) {
        logger.warn(`Error removing container ${deploymentName}:`, removeErr)
      }
    }
  } catch (err) {
    logger.warn(`Unexpected error cleaning up container ${deploymentName}:`, err)
  }
}
