import type { OpenAPIHono, RouteConfig } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

type OpenApiDefinition =
  | { type: "route"; route: { method: string; path: string } }
  | { type: string; route?: { method: string; path: string } };

// Internal route prefixes - worker-facing, excluded from public docs
const INTERNAL_PREFIXES = ["/api/proxy", "/internal", "/worker", "/mcp"];

// Routes that render HTML pages, browser redirects, or plain-Hono routers
// whose endpoints are already covered by other OpenAPI-defined routers
const EXCLUDED_ROUTES = [
  "/", // Landing page
  "/settings", // HTML settings page
  "/api/v1/auth/{provider}/login", // OAuth redirect
];

function isInternalRoute(path: string): boolean {
  return INTERNAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isExcludedRoute(path: string): boolean {
  return EXCLUDED_ROUTES.includes(path);
}

function normalizePath(path: string): string {
  let normalized = path.replace(/:([A-Za-z0-9_]+)(?:\{[^}]+\})?/g, "{$1}");
  normalized = normalized.replace(/\/\*/g, "/{wildcard}");
  normalized = normalized.replace(/\*/g, "{wildcard}");
  // Collapse double slashes from sub-router mounting (e.g. app.route("", router))
  normalized = normalized.replace(/\/\/+/g, "/");
  return normalized;
}

function extractPathParams(path: string): string[] {
  const params: string[] = [];
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    if (match[1]) {
      params.push(match[1]);
    }
  }
  return params;
}

/**
 * Derive an appropriate tag for routes not already defined via app.openapi.
 * Maps route paths to API documentation categories.
 */
function deriveTag(path: string): string {
  // System routes
  if (
    path.startsWith("/health") ||
    path.startsWith("/ready") ||
    path.startsWith("/metrics")
  ) {
    return "System";
  }

  // Auth routes
  if (path.startsWith("/api/v1/auth/")) {
    return "Auth";
  }

  // Agent management routes (settings UI CRUD)
  if (path.startsWith("/api/v1/manage/")) {
    return "Agents";
  }

  // Agent routes
  if (path.startsWith("/api/v1/agents")) {
    if (path.includes("/channels")) return "Channels";
    if (path.includes("/history")) return "Agents";
    if (path.includes("/messages") || path.includes("/interactions"))
      return "Agent Messages";
    return "Agents";
  }

  // Skills utility routes
  if (path.startsWith("/api/v1/skills")) {
    return "Skills";
  }

  // Settings routes (session bootstrap + HTML pages)
  if (path.startsWith("/settings") || path.startsWith("/agent/")) {
    return "Settings";
  }

  // Integrations routes
  if (path.startsWith("/api/v1/integrations")) {
    return "Integrations";
  }

  // Messaging routes
  if (
    path.startsWith("/api/messaging/") ||
    path.startsWith("/api/v1/messaging/")
  ) {
    return "Messaging";
  }

  // Webhook routes (Telegram, Slack)
  if (path.startsWith("/api/telegram") || path.startsWith("/slack/")) {
    return "Webhooks";
  }

  // MCP routes
  if (path.startsWith("/mcp/")) {
    return "MCP Servers";
  }

  return "Other";
}

/**
 * Human-readable summaries for auto-registered routes.
 * Key format: "method /path" (lowercase method, normalized path).
 */
const ROUTE_SUMMARIES: Record<string, string> = {
  // System
  "get /health": "Health check",
  "get /ready": "Readiness probe",
  "get /metrics": "Prometheus metrics",

  // Settings
  "post /settings/session": "Establish settings session",
  "get /agent/{agentId}/history": "Agent history page",

  // Agent management
  "post /api/v1/manage/agents": "Create agent (settings)",
  "get /api/v1/manage/agents": "List user agents",
  "patch /api/v1/manage/agents/{agentId}": "Update agent metadata",
  "delete /api/v1/manage/agents/{agentId}": "Delete agent",

  // Agent config
  "get /api/v1/agents/{agentId}/config/packages/search": "Search Nix packages",
  "get /api/v1/agents/{agentId}/config/providers/catalog":
    "List provider catalog",
  "put /api/v1/agents/{agentId}/config/providers/{providerId}":
    "Install or uninstall provider",
  "patch /api/v1/agents/{agentId}/config/providers/reorder":
    "Reorder providers",
  "get /api/v1/agents/{agentId}/config/grants": "List domain grants",
  "post /api/v1/agents/{agentId}/config/grants": "Add domain grant",
  "delete /api/v1/agents/{agentId}/config/grants/{pattern}":
    "Revoke domain grant",

  // Agent history
  "get /api/v1/agents/{agentId}/history/status": "Get agent connection status",
  "get /api/v1/agents/{agentId}/history/session/messages":
    "Get session messages",
  "get /api/v1/agents/{agentId}/history/session/stats": "Get session stats",

  // Channels
  "get /api/v1/agents/{agentId}/channels": "List channel bindings",
  "post /api/v1/agents/{agentId}/channels": "Bind agent to channel",
  "delete /api/v1/agents/{agentId}/channels/{platform}/{channelId}":
    "Unbind agent from channel",

  // Auth — parameterized
  "post /api/v1/auth/{provider}/save-key": "Save API key",
  "post /api/v1/auth/{provider}/logout": "Disconnect provider",

  // Auth — Claude OAuth
  "get /api/v1/auth/claude/init": "Start Claude OAuth flow",
  "get /api/v1/auth/claude/callback": "Claude OAuth callback",

  // Auth — ChatGPT device code
  "post /api/v1/auth/chatgpt/start": "Start ChatGPT device code flow",
  "post /api/v1/auth/chatgpt/poll": "Poll ChatGPT device code status",

  // Auth — MCP OAuth
  "get /api/v1/auth/mcp/init/{mcpId}": "Start MCP OAuth flow",
  "get /api/v1/auth/mcp/callback": "MCP OAuth callback",
  "post /api/v1/auth/mcp/logout/{mcpId}": "Disconnect MCP server",

  // Webhooks
  "post /api/telegram/webhook": "Telegram bot webhook",
};

/**
 * Register OpenAPI paths for routes not already defined via app.openapi.
 * Internal routes (worker-facing) are excluded from public docs.
 */
export function registerAutoOpenApiRoutes(app: OpenAPIHono): void {
  const registered = new Set<string>();
  const definitions = app.openAPIRegistry
    .definitions as unknown as OpenApiDefinition[];

  // Collect all Hono route paths for matching against OpenAPI relative paths
  const honoRoutePaths = new Set<string>();
  for (const route of app.routes) {
    if (route.method.toLowerCase() !== "all") {
      honoRoutePaths.add(normalizePath(route.path));
    }
  }

  for (const def of definitions) {
    if (def.type === "route" && def.route) {
      // Normalize the definition path in-place to fix double-slash artifacts
      def.route.path = normalizePath(def.route.path);
      const method = def.route.method.toLowerCase();
      const defPath = def.route.path;
      registered.add(`${method} ${defPath}`);

      // Sub-routers register OpenAPI defs with relative paths (e.g., "/{provider}/code").
      // Match these against Hono's full mounted paths to prevent duplicate stubs.
      if (!defPath.startsWith("/api/")) {
        for (const fullPath of honoRoutePaths) {
          if (fullPath.endsWith(defPath)) {
            registered.add(`${method} ${fullPath}`);
          }
        }
      }
    }
  }

  for (const route of app.routes) {
    const method = route.method.toLowerCase();
    if (method === "all") {
      continue;
    }

    const path = normalizePath(route.path);
    const key = `${method} ${path}`;

    if (registered.has(key)) {
      continue;
    }

    // Skip internal routes - they shouldn't be in public docs
    if (isInternalRoute(path)) {
      continue;
    }

    // Skip excluded routes (HTML pages, OAuth redirects)
    if (isExcludedRoute(path)) {
      continue;
    }

    const params = extractPathParams(path);
    const paramsSchema =
      params.length > 0
        ? z.object(
            Object.fromEntries(params.map((param) => [param, z.string()]))
          )
        : undefined;

    const routeConfig: RouteConfig = {
      method: method as RouteConfig["method"],
      path,
      tags: [deriveTag(path)],
      summary: ROUTE_SUMMARIES[key] || `${method.toUpperCase()} ${path}`,
      request: paramsSchema ? { params: paramsSchema } : undefined,
      responses: {
        200: { description: "OK" },
      },
    };

    app.openAPIRegistry.registerPath(routeConfig);
    registered.add(key);
  }
}
