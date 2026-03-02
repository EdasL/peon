import { db } from "../db/connection.js"
import { projects, apiKeys } from "../db/schema.js"
import { eq } from "drizzle-orm"
import { decrypt } from "../services/encryption.js"

// This function integrates with Lobu's existing orchestration layer.
// It calls the deployment manager to create a Docker container for the project.

interface LaunchConfig {
  projectId: string
  userId: string
  repoUrl: string | null
  templateId: string
  apiKey: { provider: string; key: string }
}

export async function launchProject(config: LaunchConfig) {
  // Generate a unique deployment name
  const deploymentName = `femrun-${config.projectId.slice(0, 8)}`

  // Build environment variables for the worker container
  const envVars: Record<string, string> = {
    PROJECT_ID: config.projectId,
    USER_ID: config.userId,
    TEMPLATE_ID: config.templateId,
    DEPLOYMENT_NAME: deploymentName,
  }

  if (config.repoUrl) {
    envVars.REPO_URL = config.repoUrl
  }

  // Inject the user's API key
  if (config.apiKey.provider === "anthropic") {
    envVars.ANTHROPIC_API_KEY = config.apiKey.key
  } else if (config.apiKey.provider === "openai") {
    envVars.OPENAI_API_KEY = config.apiKey.key
  }

  // TODO: Call Lobu's orchestrator.createWorkerDeployment()
  // This requires adapting Lobu's Orchestrator class to accept our project config.
  // The exact integration depends on how much we refactor Lobu's Gateway class.
  //
  // For the MVP, we can use Dockerode directly:
  //
  // import Dockerode from "dockerode"
  // const docker = new Dockerode()
  // const container = await docker.createContainer({
  //   Image: "lobu-worker:latest",
  //   name: deploymentName,
  //   Env: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
  //   HostConfig: {
  //     NetworkMode: "lobu-internal",
  //     Memory: 512 * 1024 * 1024, // 512MB
  //     CpuQuota: 100000, // 1 CPU
  //   },
  // })
  // await container.start()

  // Update project status and deployment name
  await db.update(projects).set({
    deploymentName,
    status: "running",
    updatedAt: new Date(),
  }).where(eq(projects.id, config.projectId))

  return { deploymentName }
}

export async function getProjectApiKey(userId: string): Promise<{ provider: string; key: string } | null> {
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.userId, userId),
  })
  if (!key) return null
  return { provider: key.provider, key: decrypt(key.encryptedKey) }
}
