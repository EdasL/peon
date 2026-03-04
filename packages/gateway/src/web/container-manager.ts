/**
 * Peon container manager
 *
 * Provides Docker container status queries and cleanup for Peon projects.
 * The Peon platform gives each user a single persistent worker container
 * whose name is derived from peonAgentId (the canonical conversationId for
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
 * Peon uses peonAgentId as both channelId and conversationId on the "peon" platform.
 * This mirrors exactly what project-launcher.ts passes to the queue.
 */
export function getPeonDeploymentName(
  userId: string,
  peonAgentId: string
): string {
  return generateDeploymentName({
    userId,
    platform: "peon",
    channelId: peonAgentId,
    conversationId: peonAgentId,
  })
}

export type ContainerStatus = "starting" | "running" | "stopped" | "not_found" | "error"

/**
 * Query the Docker daemon for the actual state of the user's worker container.
 * Returns one of the Peon status values, or null if Docker is unavailable.
 * "not_found" means the container doesn't exist in Docker (distinct from "stopped"
 * which means the container exists but has exited).
 */
export async function getContainerStatus(
  deploymentName: string
): Promise<ContainerStatus | null> {
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
    if (err?.statusCode === 404 || err?.message?.includes("No such container")) {
      return "not_found"
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

/**
 * Restart a stopped Docker container by deployment name.
 * If the container doesn't exist, returns false.
 */
export async function restartContainer(deploymentName: string): Promise<boolean> {
  let docker: Docker
  try {
    docker = new Docker({ socketPath: "/var/run/docker.sock" })
  } catch (err) {
    logger.warn("Could not connect to Docker daemon for restart:", err)
    return false
  }

  try {
    const container = docker.getContainer(deploymentName)
    await container.start()
    logger.info(`Restarted container: ${deploymentName}`)
    return true
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.message?.includes("No such container")) {
      logger.warn(`Container ${deploymentName} not found for restart`)
      return false
    }
    // Container might already be running — that's fine
    if (err?.statusCode === 304) {
      return true
    }
    logger.warn(`Error restarting container ${deploymentName}:`, err)
    return false
  }
}
