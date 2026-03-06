import { createLogger } from "@lobu/core"
import { getPeonDeploymentName, removeContainer, getContainerStatus } from "./container-manager.js"

const logger = createLogger("credential-refresh")

/**
 * Remove the user's worker container so the next message creates a fresh
 * one with the latest credentials. Workspace data lives on a named volume
 * and survives container recreation.
 */
export async function recycleUserContainer(
  userId: string,
  peonAgentId: string,
): Promise<void> {
  const deploymentName = getPeonDeploymentName(userId, peonAgentId)

  const status = await getContainerStatus(deploymentName)
  if (!status || status === "not_found") {
    logger.info(`No container to recycle for ${deploymentName}`)
    return
  }

  logger.info(`Recycling container ${deploymentName} after credential change (was ${status})`)
  await removeContainer(deploymentName)
  logger.info(`Container ${deploymentName} removed — will be recreated on next message`)
}
