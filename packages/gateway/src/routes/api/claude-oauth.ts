import { Hono } from "hono";
import { createLogger } from "@lobu/core";
import { requireAuth, getSession } from "../../auth/middleware.js";
import { ensurePeonAgent, bridgeCredentials } from "../../peon/agent-helper.js";
import { getPeonPlatform } from "../../peon/platform.js";
import { ClaudeOAuthClient } from "../../auth/oauth/claude-client.js";
import { createClaudeOAuthStateStore } from "../../auth/oauth/state-store.js";
import { AuthProfilesManager } from "../../auth/settings/auth-profiles-manager.js";
import { ProviderCatalogService } from "../../auth/provider-catalog.js";
import { CLAUDE_PROVIDER } from "../../auth/oauth/providers.js";

const logger = createLogger("claude-oauth-web");

const ANTHROPIC_CALLBACK = "https://console.anthropic.com/oauth/code/callback";

export const claudeOAuthRouter = new Hono();

claudeOAuthRouter.use("*", requireAuth);

/**
 * POST /web-init
 * Returns the Anthropic OAuth authorization URL.
 * The frontend opens this URL in a new tab; Anthropic displays
 * a CODE#STATE string that the user copies back.
 */
claudeOAuthRouter.post("/web-init", async (c) => {
  try {
    const { userId } = getSession(c);
    const agentId = await ensurePeonAgent(userId);

    logger.info({ userId, agentId }, "Initializing Claude OAuth web flow");

    const services = getPeonPlatform().getServices();
    const redis = services.getQueue().getRedisClient();
    const stateStore = createClaudeOAuthStateStore(redis);

    const oauthClient = new ClaudeOAuthClient();
    const codeVerifier = oauthClient.generateCodeVerifier();

    const state = await stateStore.create({
      userId,
      agentId,
      codeVerifier,
    });

    const authUrl = oauthClient.buildAuthUrl(state, codeVerifier, ANTHROPIC_CALLBACK);

    return c.json({ authUrl });
  } catch (error) {
    logger.error("Failed to initiate Claude OAuth", { error });
    return c.json({ error: "Failed to start OAuth flow" }, 500);
  }
});

/**
 * POST /web-exchange
 * Accepts the CODE#STATE string the user copied from Anthropic's callback page.
 * Parses it, retrieves the PKCE verifier from Redis, exchanges the code for tokens,
 * and stores the credentials.
 */
claudeOAuthRouter.post("/web-exchange", async (c) => {
  try {
    const body = await c.req.json<{ authCode: string }>();
    const input = body.authCode?.trim();

    if (!input) {
      return c.json({ error: "Authentication code is required" }, 400);
    }

    let code: string;
    let state: string;

    if (input.startsWith("http://") || input.startsWith("https://")) {
      const url = new URL(input);
      code = url.searchParams.get("code") || "";
      state = url.hash.substring(1);
    } else {
      const hashIdx = input.indexOf("#");
      if (hashIdx === -1) {
        return c.json({ error: "Invalid format — expected CODE#STATE" }, 400);
      }
      code = input.substring(0, hashIdx).trim();
      state = input.substring(hashIdx + 1).trim();
    }

    if (!code || !state) {
      return c.json({ error: "Could not parse code and state from input" }, 400);
    }

    logger.info("Exchanging Claude OAuth code for tokens");

    const services = getPeonPlatform().getServices();
    const redis = services.getQueue().getRedisClient();
    const stateStore = createClaudeOAuthStateStore(redis);

    const stateData = await stateStore.consume(state);
    if (!stateData) {
      return c.json({ error: "OAuth session expired, please try again" }, 400);
    }

    const { userId, agentId, codeVerifier } = stateData;

    const oauthClient = new ClaudeOAuthClient();
    const credentials = await oauthClient.exchangeCodeForToken(
      code,
      codeVerifier,
      ANTHROPIC_CALLBACK,
      state,
    );

    const agentSettingsStore = services.getAgentSettingsStore();
    const profilesManager = new AuthProfilesManager(agentSettingsStore);
    const catalogService = new ProviderCatalogService(
      agentSettingsStore,
      profilesManager,
    );

    await catalogService.installProvider(agentId, "claude");

    await profilesManager.upsertProfile({
      agentId,
      provider: "claude",
      credential: credentials.accessToken,
      authType: "oauth",
      label: "Claude subscription (OAuth)",
      metadata: {
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt,
        scopes: credentials.scopes,
        clientId: CLAUDE_PROVIDER.clientId,
      },
      makePrimary: true,
    });

    logger.info({ userId, agentId }, "Claude OAuth credentials stored");

    await bridgeCredentials(userId, agentId, services);

    // Recycle the container so the new OAuth token takes effect
    const { recycleUserContainer } = await import("../../web/credential-refresh.js");
    await recycleUserContainer(userId, agentId);

    logger.info({ userId, agentId }, "Claude OAuth web flow complete");
    return c.json({ ok: true });
  } catch (error) {
    logger.error("Claude OAuth exchange failed", { error });
    const message = error instanceof Error ? error.message : "Failed to complete authentication";
    return c.json({ error: message }, 500);
  }
});
