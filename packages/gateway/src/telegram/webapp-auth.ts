/**
 * Telegram WebApp initData verification.
 *
 * When a page is opened via a `web_app` inline keyboard button, Telegram
 * provides a cryptographically signed `initData` payload that proves the
 * user's identity. This module validates the HMAC-SHA256 signature using
 * the bot token, following the algorithm described at:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createLogger } from "@lobu/core";

const logger = createLogger("telegram-webapp-auth");

/** Maximum age of initData before it's considered stale (1 hour). */
const MAX_AUTH_AGE_S = 3600;

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramWebAppData {
  user: TelegramWebAppUser;
  auth_date: number;
  hash: string;
  query_id?: string;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
}

/**
 * Verify Telegram WebApp initData and extract user information.
 *
 * Algorithm:
 * 1. Parse initData as URL-encoded key-value pairs
 * 2. Remove the `hash` field
 * 3. Sort remaining fields alphabetically
 * 4. Build data-check-string: `key=value\nkey=value\n...`
 * 5. secret = HMAC-SHA256("WebAppData", botToken)
 * 6. Compute HMAC-SHA256(secret, dataCheckString)
 * 7. Compare with received hash using timing-safe comparison
 * 8. Validate auth_date is within MAX_AUTH_AGE_S
 *
 * Returns parsed data if valid, null otherwise.
 */
export function verifyTelegramWebAppData(
  initData: string,
  botToken: string
): TelegramWebAppData | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) {
      logger.warn("initData missing hash");
      return null;
    }

    // Build data-check-string: sorted key=value pairs (excluding hash)
    const entries: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key !== "hash") {
        entries.push(`${key}=${value}`);
      }
    }
    entries.sort();
    const dataCheckString = entries.join("\n");

    // secret = HMAC-SHA256("WebAppData", botToken)
    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();

    // computed = HMAC-SHA256(secret, dataCheckString)
    const computed = createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");

    // Timing-safe comparison
    const hashBuf = Buffer.from(hash, "hex");
    const computedBuf = Buffer.from(computed, "hex");
    if (
      hashBuf.length !== computedBuf.length ||
      !timingSafeEqual(hashBuf, computedBuf)
    ) {
      logger.warn("initData hash mismatch");
      return null;
    }

    // Parse auth_date
    const authDateStr = params.get("auth_date");
    if (!authDateStr) {
      logger.warn("initData missing auth_date");
      return null;
    }
    const authDate = parseInt(authDateStr, 10);
    if (!Number.isFinite(authDate)) {
      logger.warn("initData invalid auth_date");
      return null;
    }

    // Check freshness
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > MAX_AUTH_AGE_S) {
      logger.warn({ authDate, now }, "initData too old");
      return null;
    }

    // Parse user
    const userStr = params.get("user");
    if (!userStr) {
      logger.warn("initData missing user");
      return null;
    }

    let user: TelegramWebAppUser;
    try {
      user = JSON.parse(userStr);
    } catch {
      logger.warn("initData invalid user JSON");
      return null;
    }

    if (!user.id || typeof user.id !== "number") {
      logger.warn("initData user missing id");
      return null;
    }

    logger.debug({ userId: user.id }, "initData verified");

    return {
      user,
      auth_date: authDate,
      hash,
      query_id: params.get("query_id") ?? undefined,
      chat_instance: params.get("chat_instance") ?? undefined,
      chat_type: params.get("chat_type") ?? undefined,
      start_param: params.get("start_param") ?? undefined,
    };
  } catch (error) {
    logger.warn({ error }, "Failed to verify initData");
    return null;
  }
}
