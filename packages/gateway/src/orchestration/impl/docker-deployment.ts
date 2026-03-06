import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createLogger, ErrorCode, OrchestratorError } from "@lobu/core";
import Docker from "dockerode";
import type { ModelProviderModule } from "../../modules/module-system";
import {
  BaseDeploymentManager,
  type DeploymentInfo,
  type MessagePayload,
  type ModuleEnvVarsBuilder,
  type OrchestratorConfig,
} from "../base-deployment-manager";
import {
  BASE_WORKER_LABELS,
  buildDeploymentInfoSummary,
  getVeryOldThresholdDays,
  resolvePlatformDeploymentMetadata,
} from "../deployment-utils";

/**
 * Resource parsing utilities for memory and CPU limits
 */
class ResourceParser {
  static parseMemory(memoryStr: string): number {
    const units: Record<string, number> = {
      Ki: 1024,
      Mi: 1024 * 1024,
      Gi: 1024 * 1024 * 1024,
      k: 1000,
      M: 1000 * 1000,
      G: 1000 * 1000 * 1000,
    };
    for (const [unit, multiplier] of Object.entries(units)) {
      if (memoryStr.endsWith(unit)) {
        const value = parseFloat(memoryStr.replace(unit, ""));
        return value * multiplier;
      }
    }
    return parseInt(memoryStr, 10);
  }

  static parseCpu(cpuStr: string): number {
    if (cpuStr.endsWith("m")) {
      const millicores = parseInt(cpuStr.replace("m", ""), 10);
      return (millicores / 1000) * 1e9;
    }
    const cores = parseFloat(cpuStr);
    return cores * 1e9;
  }
}

const logger = createLogger("orchestrator");

const OPENCLAW_CONTAINER_PORT = 18789;

/**
 * Registry of OpenClaw connection info for active worker containers.
 * Keyed by deployment name — the gateway uses this to connect to each
 * container's OpenClaw gateway for real-time event streaming.
 */
interface OpenClawRegistryEntry {
  wsUrl: string;
  token: string;
}

const openclawRegistry = new Map<string, OpenClawRegistryEntry>();

/** Get the OpenClaw WS URL for a container by deployment name. */
export function getOpenClawWsUrl(deploymentName: string): string | undefined {
  return openclawRegistry.get(deploymentName)?.wsUrl;
}

/** Get the OpenClaw auth token for a container by deployment name. */
export function getOpenClawToken(deploymentName: string): string | undefined {
  return openclawRegistry.get(deploymentName)?.token;
}

/** Get all registered OpenClaw entries (deploymentName -> entry). */
export function getAllOpenClawEntries(): ReadonlyMap<string, OpenClawRegistryEntry> {
  return openclawRegistry;
}

export class DockerDeploymentManager extends BaseDeploymentManager {
  private docker: Docker;
  private gvisorAvailable = false;
  private activityTimestamps: Map<string, Date> = new Map();

  constructor(
    config: OrchestratorConfig,
    moduleEnvVarsBuilder?: ModuleEnvVarsBuilder,
    providerModules: ModelProviderModule[] = []
  ) {
    super(config, moduleEnvVarsBuilder, providerModules);

    // Explicitly use the Unix socket for Docker connection
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });

    // Check for gvisor availability on initialization
    this.checkGvisorAvailability();

    // Ensure the internal network exists for worker isolation
    this.ensureInternalNetwork();
  }

  private async checkGvisorAvailability(): Promise<void> {
    try {
      const info = await this.docker.info();
      const runtimes = info.Runtimes || {};

      if (runtimes.runsc || runtimes.gvisor) {
        this.gvisorAvailable = true;
        logger.info(
          "✅ gVisor runtime detected and will be used for worker isolation"
        );
      } else {
        logger.info(
          "ℹ️  gVisor runtime not available, using default runc runtime"
        );
      }
    } catch (error) {
      logger.warn(
        `⚠️  Failed to check Docker runtime availability: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Ensure the internal Docker network exists with `internal: true` for worker isolation.
   * Skipped when WORKER_NETWORK is explicitly set (e.g. local dev using bridge).
   * Creates the network if it doesn't exist (e.g. production without docker-compose).
   */
  private async ensureInternalNetwork(): Promise<void> {
    // If explicitly overridden (e.g. WORKER_NETWORK=bridge for local dev), skip
    if (process.env.WORKER_NETWORK) {
      return;
    }

    const composeProjectName = process.env.COMPOSE_PROJECT_NAME || "peon";
    const networkName = `${composeProjectName}_peon-internal`;

    try {
      const network = this.docker.getNetwork(networkName);
      const info = await network.inspect();
      if (!info.Internal) {
        logger.warn(
          `⚠️  Network ${networkName} exists but is NOT internal — workers may have direct internet access`
        );
      }
    } catch {
      // Network doesn't exist — create it with internal: true
      try {
        await this.docker.createNetwork({
          Name: networkName,
          Internal: true,
          Driver: "bridge",
          Labels: {
            "peon.io/managed": "true",
            "peon.io/purpose": "worker-isolation",
          },
        });
        logger.info(
          `✅ Created internal network ${networkName} for worker isolation`
        );
      } catch (createError) {
        logger.error(
          `Failed to create internal network ${networkName}: ${createError instanceof Error ? createError.message : String(createError)}`
        );
      }
    }
  }

  /**
   * Scan running worker containers and re-populate the in-memory OpenClaw
   * registry. Called on gateway startup so that already-running containers
   * are immediately reachable via the WS proxy.
   */
  async reconcileOpenClawRegistry(): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        filters: {
          label: ["app.kubernetes.io/component=worker"],
          status: ["running"],
        },
      });

      const isContainerMode = this.isRunningInContainer();
      const composeProjectName = process.env.COMPOSE_PROJECT_NAME || "peon";
      const networkName = process.env.WORKER_NETWORK || `${composeProjectName}_peon-internal`;

      for (const containerInfo of containers) {
        const deploymentName = containerInfo.Names[0]?.substring(1) || "";
        if (!deploymentName) continue;

        // Seed activity timestamp for all running containers so they survive
        // the first reconciliation pass after a gateway restart. Without this,
        // containers appear idle since their Docker creation time and get
        // immediately stopped.
        if (!this.activityTimestamps.has(deploymentName)) {
          this.activityTimestamps.set(deploymentName, new Date());
          logger.info(`Seeded activity timestamp for running container ${deploymentName}`);
        }

        if (openclawRegistry.has(deploymentName)) continue;

        try {
          const container = this.docker.getContainer(containerInfo.Id);
          const info = await container.inspect();

          // Extract the token from the container's env vars
          const envVars = info.Config.Env ?? [];
          const tokenEnv = envVars.find((e: string) => e.startsWith("OPENCLAW_GATEWAY_TOKEN="));
          const token = tokenEnv?.split("=").slice(1).join("=") ?? "";

          let wsUrl: string | null = null;
          if (isContainerMode) {
            const netInfo = info.NetworkSettings.Networks?.[networkName];
            const containerIp = netInfo?.IPAddress;
            if (containerIp) {
              wsUrl = `ws://${containerIp}:${OPENCLAW_CONTAINER_PORT}`;
            }
          } else {
            const portMap = info.NetworkSettings.Ports?.[`${OPENCLAW_CONTAINER_PORT}/tcp`];
            const binding = portMap?.[0];
            if (binding?.HostPort) {
              wsUrl = `ws://127.0.0.1:${binding.HostPort}`;
            }
          }

          if (wsUrl && token) {
            openclawRegistry.set(deploymentName, { wsUrl, token });
            logger.info(`Recovered OpenClaw registry for ${deploymentName}: ${wsUrl}`);
          }
        } catch (err) {
          logger.warn(`Could not inspect container ${deploymentName} for registry recovery: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      logger.info(`OpenClaw registry reconciled: ${openclawRegistry.size} entries, ${this.activityTimestamps.size} activity timestamps seeded`);

      await this.reconnectOpenClawStreams();
    } catch (err) {
      logger.warn(`OpenClaw registry reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * For each registry entry, look up the corresponding running project and
   * establish a server-side WebSocket connection so that agent activity
   * events are relayed to SSE clients.
   */
  private async reconnectOpenClawStreams(): Promise<void> {
    if (openclawRegistry.size === 0) return;

    try {
      const { connectToContainer, getActiveConnections } = await import("../../openclaw/connection-manager.js");
      const { db } = await import("../../db/connection.js");
      const { projects } = await import("../../db/schema.js");
      const { inArray } = await import("drizzle-orm");

      const activeConnections = getActiveConnections();
      const deploymentNames = Array.from(openclawRegistry.keys());

      const runningProjects = await db.query.projects.findMany({
        where: inArray(projects.deploymentName, deploymentNames),
        columns: { id: true, deploymentName: true, status: true },
      });

      for (const project of runningProjects) {
        if (!project.deploymentName) continue;
        if (project.status !== "running" && project.status !== "initializing") continue;
        if (activeConnections.has(project.id)) continue;

        const entry = openclawRegistry.get(project.deploymentName);
        if (!entry) continue;

        logger.info(`Reconnecting OpenClaw stream for project ${project.id} via ${project.deploymentName}`);
        connectToContainer(project.id, project.deploymentName, entry.wsUrl, entry.token).catch((err: unknown) => {
          logger.warn(`Failed to reconnect OpenClaw for project ${project.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch (err) {
      logger.warn(`reconnectOpenClawStreams failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Check if gateway is running inside a Docker container
   */
  private isRunningInContainer(): boolean {
    return fs.existsSync("/.dockerenv") || process.env.CONTAINER === "true";
  }

  /**
   * Get the host address that workers should use to reach the gateway
   * When gateway runs on host, workers use host.docker.internal
   * When gateway runs in container (docker-compose mode), workers use service name
   */
  private getHostAddress(): string {
    if (this.isRunningInContainer()) {
      return "gateway";
    }
    // For host-mode development, workers reach gateway via host.docker.internal
    return "host.docker.internal";
  }

  /**
   * Validate that the worker image exists locally, or pull it if missing.
   * Called on gateway startup to ensure workers can be created.
   */
  async validateWorkerImage(): Promise<void> {
    const imageName = this.getWorkerImageReference();

    try {
      await this.docker.getImage(imageName).inspect();
      logger.info(`✅ Worker image verified: ${imageName}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // If image not found, try to pull it
      if (
        errorMessage.includes("No such image") ||
        errorMessage.includes("404")
      ) {
        logger.info(
          `📥 Worker image ${imageName} not found locally, pulling...`
        );
        try {
          await new Promise<void>((resolve, reject) => {
            this.docker.pull(imageName, (err: any, stream: any) => {
              if (err) return reject(err);
              this.docker.modem.followProgress(stream, (err: any) => {
                if (err) reject(err);
                else resolve();
              });
            });
          });
          logger.info(`✅ Worker image ${imageName} pulled successfully`);
        } catch (pullError) {
          logger.error(
            `❌ Failed to pull worker image ${imageName}:`,
            pullError
          );
          throw new OrchestratorError(
            ErrorCode.DEPLOYMENT_CREATE_FAILED,
            `Worker image ${imageName} does not exist locally and pull failed. Please check your internet connection or registry permissions.`
          );
        }
      } else {
        // Other error - re-throw
        throw new OrchestratorError(
          ErrorCode.DEPLOYMENT_CREATE_FAILED,
          `Failed to validate worker image ${imageName}: ${errorMessage}`
        );
      }
    }
  }

  async listDeployments(): Promise<DeploymentInfo[]> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: ["app.kubernetes.io/component=worker"],
        },
      });

      const now = Date.now();
      const idleThresholdMinutes = this.config.worker.idleCleanupMinutes;
      const veryOldDays = getVeryOldThresholdDays(this.config);

      return containers.map((containerInfo: Docker.ContainerInfo) => {
        const deploymentName = containerInfo.Names[0]?.substring(1) || ""; // Remove leading '/'

        const trackedActivity = this.activityTimestamps.get(deploymentName);
        const lastActivityStr =
          containerInfo.Labels?.["peon.io/last-activity"] ||
          containerInfo.Labels?.["peon.io/created"];

        const labelActivity = lastActivityStr
          ? new Date(lastActivityStr)
          : new Date(containerInfo.Created * 1000);

        const isRunning = containerInfo.State === "running";

        // If a container is running but we have no in-memory timestamp,
        // treat it as active NOW rather than falling back to the stale
        // Docker creation label. This prevents running containers from
        // being immediately stopped after a gateway restart.
        let lastActivity: Date;
        if (trackedActivity) {
          lastActivity = trackedActivity > labelActivity ? trackedActivity : labelActivity;
        } else if (isRunning) {
          lastActivity = new Date();
          this.activityTimestamps.set(deploymentName, lastActivity);
        } else {
          lastActivity = labelActivity;
        }

        const replicas = isRunning ? 1 : 0;
        return buildDeploymentInfoSummary({
          deploymentName,
          lastActivity,
          now,
          idleThresholdMinutes,
          veryOldDays,
          replicas,
        });
      });
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to list Docker containers: ${error instanceof Error ? error.message : String(error)}`,
        { error },
        true
      );
    }
  }

  /**
   * Ensures a Docker volume exists for the given space ID.
   * Uses named volumes for better isolation and security.
   * Multiple threads in the same space share the same volume.
   */
  private async ensureVolume(agentId: string): Promise<string> {
    const volumeName = `peon-workspace-${agentId}`;
    let volumeCreated = false;

    try {
      // Check if volume already exists (idempotent for concurrent creation)
      await this.docker.getVolume(volumeName).inspect();
      logger.info(`✅ Volume ${volumeName} already exists`);
    } catch (_error) {
      // Volume doesn't exist, create it
      try {
        await this.docker.createVolume({
          Name: volumeName,
          Labels: {
"peon.io/agent-id": agentId,
          "peon.io/created": new Date().toISOString(),
          },
        });
        logger.info(`✅ Created volume: ${volumeName}`);
        volumeCreated = true;
      } catch (createError: any) {
        // Handle race condition: volume created by another thread
        if (
          createError.statusCode === 409 ||
          createError.message?.includes("already exists")
        ) {
          logger.info(`Volume ${volumeName} was created by another thread`);
        } else {
          throw createError;
        }
      }
    }

    // Fix volume permissions for new volumes
    // The claude user in the worker container has UID 1001
    if (volumeCreated) {
      try {
        const initContainer = await this.docker.createContainer({
          Image: "alpine:latest",
          Cmd: ["chown", "-R", "1001:1001", "/workspace"],
          HostConfig: {
            AutoRemove: true,
            Mounts: [
              {
                Type: "volume",
                Source: volumeName,
                Target: "/workspace",
              },
            ],
          },
        });
        await initContainer.start();
        await initContainer.wait();
        logger.info(`✅ Fixed volume permissions for ${volumeName}`);
      } catch (permError) {
        logger.warn(
          `⚠️ Could not fix volume permissions: ${permError instanceof Error ? permError.message : String(permError)}`
        );
      }
    }

    return volumeName;
  }

  async createDeployment(
    ...args: Parameters<BaseDeploymentManager["createDeployment"]>
  ): Promise<void> {
    const [deploymentName, username, userId, messageDataRaw, userEnvVarsRaw] =
      args;
    const messageData = messageDataRaw as MessagePayload | undefined;
    const userEnvVars =
      (userEnvVarsRaw as Record<string, string> | undefined) ?? {};

    try {
      // Use agentId for volume naming (shared across threads in same space)
      const agentId = messageData?.agentId!;

      // Determine if running in Docker and resolve project paths
      const isRunningInDocker = process.env.DEPLOYMENT_MODE === "docker";
      const projectRoot = isRunningInDocker
        ? process.env.PEON_DEV_PROJECT_PATH || "/app"
        : path.join(process.cwd(), "..", "..");

      const workspaceDir = `${projectRoot}/workspaces/${agentId}`;

      // Ensure volume exists for production mode (space-scoped)
      const volumeName = await this.ensureVolume(agentId);

      // Get common environment variables from base class
      const commonEnvVars = await this.generateEnvironmentVariables(
        username,
        userId,
        deploymentName,
        messageData,
        true,
        userEnvVars
      );

      // On macOS/Windows, Docker containers need to use host.docker.internal instead of localhost
      if (process.platform === "darwin" || process.platform === "win32") {
        if (
          commonEnvVars.PEON_DATABASE_HOST === "localhost" ||
          commonEnvVars.PEON_DATABASE_HOST === "127.0.0.1"
        ) {
          commonEnvVars.PEON_DATABASE_HOST = "host.docker.internal";
        }
      }

      // Generate a random token for OpenClaw gateway auth (required for bind=lan)
      const openclawToken = crypto.randomBytes(32).toString("hex");
      commonEnvVars.OPENCLAW_GATEWAY_TOKEN = openclawToken;

      // Pass the Peon gateway's device identity so the worker can pre-pair it,
      // enabling the gateway to connect via OpenClawProtocolClient for activity streaming.
      try {
        const { loadOrCreateDeviceIdentity } = await import("@lobu/core");
        const gwIdentity = loadOrCreateDeviceIdentity();
        commonEnvVars.PEON_GATEWAY_DEVICE_ID = gwIdentity.deviceId;
        commonEnvVars.PEON_GATEWAY_DEVICE_PUBLIC_KEY = gwIdentity.publicKeyB64url;
      } catch (err) {
        logger.warn(`Could not load gateway device identity for pre-pairing: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Environment variables from base class already include:
      // HTTP_PROXY, HTTPS_PROXY, NO_PROXY, NODE_ENV, DEBUG
      // Provider credentials are injected via provider modules in generateEnvironmentVariables()
      const envVars = Object.entries(commonEnvVars).map(
        ([key, value]) => `${key}=${value}`
      );

      // Check if Nix packages are configured (need writable rootfs for symlinks)
      const hasNixConfig =
        (messageData?.nixConfig?.packages?.length ?? 0) > 0 ||
        !!messageData?.nixConfig?.flakeUrl;

      // Get the Docker Compose project name from environment or use default
      const composeProjectName = process.env.COMPOSE_PROJECT_NAME || "peon";

      // Expose the OpenClaw gateway port so the Peon gateway can connect
      // via Docker networking (container mode) or published port (host mode).
      const publishOpenClawPort = !this.isRunningInContainer();

      const createOptions: Docker.ContainerCreateOptions = {
        name: deploymentName,
        Image: this.getWorkerImageReference(),
        Env: envVars,
        ExposedPorts: {
          [`${OPENCLAW_CONTAINER_PORT}/tcp`]: {},
        },
        Labels: {
          ...BASE_WORKER_LABELS,
          "peon.io/created": new Date().toISOString(),
          "peon.io/agent-id": agentId,
          // Docker Compose labels to associate with the project
          "com.docker.compose.project": composeProjectName,
          "com.docker.compose.service": deploymentName,
          "com.docker.compose.oneoff": "False",
          // Add platform-specific metadata
          ...resolvePlatformDeploymentMetadata(messageData),
        },
        HostConfig: {
          // When gateway runs on host, publish OpenClaw port to a dynamic
          // host port so the gateway can connect to the container's OpenClaw WS.
          ...(publishOpenClawPort && {
            PortBindings: {
              [`${OPENCLAW_CONTAINER_PORT}/tcp`]: [{ HostPort: "0" }],
            },
          }),
          // Use named volumes in production for better isolation
          // Use bind mounts in development for hot reload
          ...(process.env.NODE_ENV === "development" && isRunningInDocker
            ? {
                Binds: [
                  `${workspaceDir}:/workspace`,
                  // Mount packages and scripts for hot reload
                  `${projectRoot}/packages:/app/packages`,
                  `${projectRoot}/scripts:/app/scripts`,
                  // Additional custom mounts (optional)
                  ...(process.env.WORKER_VOLUME_MOUNTS
                    ? process.env.WORKER_VOLUME_MOUNTS.split(";")
                        .filter((mount) => mount.trim())
                        .map((mount) =>
                          mount
                            .replace("${PWD}", projectRoot)
                            .replace("${WORKSPACE_DIR}", workspaceDir)
                        )
                    : []),
                ],
              }
            : {
                // Production: use named volumes for better isolation
                Mounts: [
                  {
                    Type: "volume",
                    Source: volumeName,
                    Target: "/workspace",
                    ReadOnly: false,
                  },
                ],
              }),
          RestartPolicy: {
            Name: "unless-stopped",
          },
          // Resource limits similar to K8s
          Memory: ResourceParser.parseMemory(
            this.config.worker.resources.limits.memory
          ),
          NanoCpus: ResourceParser.parseCpu(
            this.config.worker.resources.limits.cpu
          ),
          // Always connect to internal network (network isolation always enabled)
          // In docker-compose mode: uses compose project prefix
          // In host mode: uses plain network name (WORKER_NETWORK env var)
          NetworkMode:
            process.env.WORKER_NETWORK || `${composeProjectName}_peon-internal`,
          // Add host.docker.internal mapping when gateway runs on host
          // Required on Linux, and needed on macOS/Windows when using internal networks
          ...(!this.isRunningInContainer() && {
            ExtraHosts: ["host.docker.internal:host-gateway"],
          }),
          // Security: Drop all capabilities and only add what's needed
          CapDrop: ["ALL"],
          CapAdd: process.env.WORKER_CAPABILITIES
            ? process.env.WORKER_CAPABILITIES.split(",")
            : [],
          // Security: Prevent privilege escalation
          SecurityOpt: [
            "no-new-privileges:true",
            // Custom seccomp profile (default Docker seccomp is applied automatically)
            ...(process.env.WORKER_SECCOMP_PROFILE
              ? [`seccomp=${process.env.WORKER_SECCOMP_PROFILE}`]
              : []),
            // AppArmor profile if specified
            ...(process.env.WORKER_APPARMOR_PROFILE
              ? [`apparmor=${process.env.WORKER_APPARMOR_PROFILE}`]
              : []),
          ],
          // User namespace remapping (if Docker daemon is configured for it)
          // This makes the root user inside container map to non-root on host
          UsernsMode: process.env.WORKER_USERNS_MODE || "",
          // Read-only root filesystem (worker can write to /workspace and /tmp)
          // Disabled when Nix packages configured (entrypoint needs to symlink /nix/store)
          // Enabled by default for security, set WORKER_READONLY_ROOTFS=false to disable
          ReadonlyRootfs:
            !hasNixConfig && process.env.WORKER_READONLY_ROOTFS !== "false",
          // Temporary filesystem for /tmp (writable, in-memory)
          ...(!hasNixConfig &&
            process.env.WORKER_READONLY_ROOTFS !== "false" && {
              Tmpfs: {
                "/tmp": "rw,noexec,nosuid,size=100m",
              },
            }),
          // Shared memory for Chromium and other apps requiring /dev/shm
          ShmSize: 268435456, // 256MB
          // Use gVisor runtime if available for enhanced isolation
          ...(this.gvisorAvailable && {
            Runtime: "runsc",
          }),
        },
        WorkingDir: "/workspace",
      };

      const container = await this.docker.createContainer(createOptions);
      try {
        await container.start();
      } catch (startError) {
        // Clean up orphaned container if start fails
        logger.error(
          `Failed to start container ${deploymentName}, removing orphaned container`,
          startError
        );
        try {
          await container.remove({ force: true });
        } catch (removeError) {
          logger.error(
            `Failed to remove orphaned container ${deploymentName}:`,
            removeError
          );
        }
        throw startError;
      }

      // Connect workers to the public network so the OpenClaw gateway inside
      // the container can reach LLM provider APIs (api.anthropic.com, etc.).
      // The internal network alone blocks all external traffic.
      // The HTTP proxy (gateway:8118) still enforces domain allowlists for
      // the worker process itself (Claude Code tool use, pip install, etc.).
      try {
        const publicNetwork = this.docker.getNetwork(
          `${composeProjectName}_peon-public`
        );
        await publicNetwork.connect({ Container: container.id });
      } catch (netErr) {
        logger.warn(
          `Could not connect ${deploymentName} to public network: ${netErr instanceof Error ? netErr.message : String(netErr)}`
        );
      }

      // Register the OpenClaw WS URL so the gateway can connect to this
      // container's OpenClaw gateway for real-time event streaming.
      try {
        const info = await container.inspect();
        let wsUrl: string | null = null;

        if (publishOpenClawPort) {
          const portMap = info.NetworkSettings.Ports?.[`${OPENCLAW_CONTAINER_PORT}/tcp`];
          const binding = portMap?.[0];
          if (binding?.HostPort) {
            wsUrl = `ws://127.0.0.1:${binding.HostPort}`;
          }
        } else {
          // Container mode — use the container's IP on the shared network
          const networkName = process.env.WORKER_NETWORK || `${composeProjectName}_peon-internal`;
          const networkInfo = info.NetworkSettings.Networks?.[networkName];
          const containerIp = networkInfo?.IPAddress;
          if (containerIp) {
            wsUrl = `ws://${containerIp}:${OPENCLAW_CONTAINER_PORT}`;
          }
        }

        if (wsUrl) {
          openclawRegistry.set(deploymentName, { wsUrl, token: openclawToken });
          logger.info(`Registered OpenClaw WS URL for ${deploymentName}: ${wsUrl}`);
        } else {
          logger.warn(`Could not determine OpenClaw WS URL for ${deploymentName}`);
        }
      } catch (inspectErr) {
        logger.warn(
          `Could not inspect container for OpenClaw WS URL: ${inspectErr instanceof Error ? inspectErr.message : String(inspectErr)}`
        );
      }

      logger.info(`✅ Created and started Docker container: ${deploymentName}`);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_CREATE_FAILED,
        `Failed to create Docker container: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, error },
        true
      );
    }
  }

  async scaleDeployment(
    deploymentName: string,
    replicas: number
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(deploymentName);
      const containerInfo = await container.inspect();

      if (replicas === 0 && containerInfo.State.Running) {
        await container.stop();
        logger.info(`Stopped container ${deploymentName}`);
      } else if (replicas === 1 && !containerInfo.State.Running) {
        await container.start();
        logger.info(`Started container ${deploymentName}`);
      }
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.DEPLOYMENT_SCALE_FAILED,
        `Failed to scale Docker container ${deploymentName}: ${error instanceof Error ? error.message : String(error)}`,
        { deploymentName, replicas, error },
        true
      );
    }
  }

  async deleteDeployment(deploymentName: string): Promise<void> {
    try {
      const container = this.docker.getContainer(deploymentName);

      // Stop container if running
      try {
        await container.stop();
        logger.info(`✅ Stopped container: ${deploymentName}`);
      } catch (_error) {
        // Container might already be stopped
        logger.warn(`⚠️  Container ${deploymentName} was not running`);
      }

      // Remove container
      await container.remove();
      this.activityTimestamps.delete(deploymentName);
      openclawRegistry.delete(deploymentName);
      logger.info(`✅ Removed container: ${deploymentName}`);
    } catch (error) {
      const dockerError = error as { statusCode?: number };
      if (dockerError.statusCode === 404) {
        logger.warn(
          `⚠️  Container ${deploymentName} not found (already deleted)`
        );
      } else {
        throw error;
      }
    }

    // NOTE: Space volumes are NOT deleted on deployment deletion
    // They are shared across threads in the same space and persist
    // for future conversations. Cleanup is done manually or via separate process.
  }

  async updateDeploymentActivity(deploymentName: string): Promise<void> {
    // Docker doesn't support runtime label updates like K8s annotations
    // Track activity in-memory for idle cleanup calculations
    this.activityTimestamps.set(deploymentName, new Date());
  }

  protected getDispatcherHost(): string {
    return this.getHostAddress();
  }
}
