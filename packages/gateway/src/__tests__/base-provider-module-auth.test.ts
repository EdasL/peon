import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  type BaseProviderConfig,
  BaseProviderModule,
} from "../auth/base-provider-module";
import { createAuthProfileLabel } from "../auth/settings/auth-profiles-manager";
import {
  generateChannelSettingsToken,
  generateSettingsToken,
  verifySettingsToken,
} from "../auth/settings/token-service";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
}

class TestProviderModule extends BaseProviderModule {
  constructor(authProfilesManager: {
    upsertProfile(input: unknown): Promise<void>;
    deleteProviderProfiles(
      agentId: string,
      providerId: string,
      profileId?: string
    ): Promise<void>;
    hasProviderProfiles(agentId: string, providerId: string): Promise<boolean>;
    getBestProfile(agentId: string, providerId: string): Promise<unknown>;
  }) {
    const config: BaseProviderConfig = {
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      providerIconUrl: "https://example.com/icon.png",
      credentialEnvVarName: "TEST_PROVIDER_API_KEY",
      secretEnvVarNames: ["TEST_PROVIDER_API_KEY"],
      authType: "api-key",
    };

    super(config, authProfilesManager as any);
  }
}

function createAuthProfilesManagerMock() {
  const upsertCalls: unknown[] = [];
  const deleteCalls: Array<{
    agentId: string;
    providerId: string;
    profileId?: string;
  }> = [];

  const manager = {
    async upsertProfile(input: unknown): Promise<void> {
      upsertCalls.push(input);
    },
    async deleteProviderProfiles(
      agentId: string,
      providerId: string,
      profileId?: string
    ): Promise<void> {
      deleteCalls.push({ agentId, providerId, profileId });
    },
    async hasProviderProfiles(): Promise<boolean> {
      return false;
    },
    async getBestProfile(): Promise<null> {
      return null;
    },
  };

  return { manager, upsertCalls, deleteCalls };
}

/**
 * Build a mini auth router that mirrors the parameterized pattern
 * from gateway.ts (POST /:provider/save-key, POST /:provider/logout).
 */
function createAuthRouter(
  providerModule: TestProviderModule,
  authProfilesManager: ReturnType<
    typeof createAuthProfilesManagerMock
  >["manager"]
) {
  const app = new Hono();
  const providerModuleMap = new Map([
    [providerModule.providerId, providerModule],
  ]);

  app.post("/:provider/save-key", async (c) => {
    try {
      const providerId = c.req.param("provider");
      const mod = providerModuleMap.get(providerId);
      if (!mod) return c.json({ error: "Unknown provider" }, 404);

      const body = await c.req.json();
      const { agentId, apiKey, token } = body;
      if (!agentId || !apiKey) {
        return c.json({ error: "Missing agentId or apiKey" }, 400);
      }

      const queryToken = c.req.query("token");
      const authToken = typeof token === "string" ? token : queryToken;
      const payload = authToken ? verifySettingsToken(authToken) : null;
      if (!payload?.agentId || payload.agentId !== agentId) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      await authProfilesManager.upsertProfile({
        agentId,
        provider: providerId,
        credential: apiKey,
        authType: "api-key",
        label: createAuthProfileLabel(mod.providerDisplayName, apiKey),
        makePrimary: true,
      });

      return c.json({ success: true });
    } catch (_error) {
      return c.json({ error: "Failed to save API key" }, 500);
    }
  });

  app.post("/:provider/logout", async (c) => {
    try {
      const providerId = c.req.param("provider");
      const mod = providerModuleMap.get(providerId);
      if (!mod) return c.json({ error: "Unknown provider" }, 404);

      const body = await c.req.json().catch(() => ({}));
      const agentId = body.agentId || c.req.query("agentId");
      const queryToken = c.req.query("token");
      const authToken =
        typeof body.token === "string" ? body.token : queryToken;

      if (!agentId) {
        return c.json({ error: "Missing agentId" }, 400);
      }

      const payload = authToken ? verifySettingsToken(authToken) : null;
      if (!payload?.agentId || payload.agentId !== agentId) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      await authProfilesManager.deleteProviderProfiles(
        agentId,
        providerId,
        body.profileId
      );

      return c.json({ success: true });
    } catch (_error) {
      return c.json({ error: "Failed to logout" }, 500);
    }
  });

  return app;
}

describe("Auth router parameterized save-key/logout", () => {
  test("rejects unauthenticated save-key requests", async () => {
    const { manager, upsertCalls } = createAuthProfilesManagerMock();
    const module = new TestProviderModule(manager);
    const app = createAuthRouter(module, manager);

    const response = await app.request("/test-provider/save-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
    });

    expect(response.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  test("rejects unauthenticated logout requests", async () => {
    const { manager, deleteCalls } = createAuthProfilesManagerMock();
    const module = new TestProviderModule(manager);
    const app = createAuthRouter(module, manager);

    const response = await app.request("/test-provider/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "agent-1" }),
    });

    expect(response.status).toBe(401);
    expect(deleteCalls).toHaveLength(0);
  });

  test("accepts authenticated save-key requests with matching agent token", async () => {
    const { manager, upsertCalls } = createAuthProfilesManagerMock();
    const module = new TestProviderModule(manager);
    const app = createAuthRouter(module, manager);
    const token = generateSettingsToken("agent-1", "user-1", "slack");

    const response = await app.request(
      `/test-provider/save-key?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
      }
    );

    expect(response.status).toBe(200);
    expect(upsertCalls).toHaveLength(1);
  });

  test("rejects authenticated save-key requests when token agent mismatches", async () => {
    const { manager, upsertCalls } = createAuthProfilesManagerMock();
    const module = new TestProviderModule(manager);
    const app = createAuthRouter(module, manager);
    const token = generateSettingsToken("agent-2", "user-1", "slack");

    const response = await app.request(
      `/test-provider/save-key?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
      }
    );

    expect(response.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  test("rejects channel-scoped token for save-key requests", async () => {
    const { manager, upsertCalls } = createAuthProfilesManagerMock();
    const module = new TestProviderModule(manager);
    const app = createAuthRouter(module, manager);
    const token = generateChannelSettingsToken("user-1", "slack", "C123");

    const response = await app.request(
      `/test-provider/save-key?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
      }
    );

    expect(response.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  test("returns 404 for unknown provider", async () => {
    const { manager } = createAuthProfilesManagerMock();
    const module = new TestProviderModule(manager);
    const app = createAuthRouter(module, manager);
    const token = generateSettingsToken("agent-1", "user-1", "slack");

    const response = await app.request(
      `/unknown-provider/save-key?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-1", apiKey: "sk-test" }),
      }
    );

    expect(response.status).toBe(404);
  });
});
