/**
 * Telegram webhook route using Grammy's built-in Hono adapter.
 */

import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import { Hono } from "hono";

/**
 * Create a Hono router that handles Telegram webhook updates.
 * Grammy's Hono adapter handles JSON parsing, secret header verification,
 * and dispatching updates to the bot.
 */
export function createTelegramWebhookRoute(
  bot: Bot,
  webhookSecret: string
): Hono {
  const router = new Hono();

  router.post(
    "/",
    webhookCallback(bot, "hono", { secretToken: webhookSecret })
  );

  return router;
}
