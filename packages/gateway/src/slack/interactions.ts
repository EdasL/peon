import { createLogger, type UserSuggestion } from "@lobu/core";
import type { WebClient } from "@slack/web-api";
import type { QueueProducer } from "../infrastructure/queue/queue-producer";
import type {
  InteractionService,
  PostedGrantRequest,
  PostedLinkButton,
  PostedQuestion,
} from "../interactions";
import type { GrantStore } from "../permissions/grant-store";
import { convertMarkdownToSlack } from "./converters/markdown";
import type { MessageHandler as SlackMessageHandler } from "./events/messages";
import type { SlackContext } from "./types";

const logger = createLogger("slack-interactions");

// ============================================================================
// SLACK INTERACTION RENDERER
// ============================================================================

interface StoredGrant {
  userId: string;
  agentId: string;
  channelId: string;
  conversationId: string;
  teamId?: string;
  domains: string[];
  reason: string;
  createdAt: number;
}

// Auto-cleanup after 1 hour
const GRANT_TTL_MS = 60 * 60 * 1000;

export class SlackInteractionRenderer {
  private storedGrants = new Map<string, StoredGrant>();

  constructor(
    private client: WebClient,
    private interactionService: InteractionService,
    _grantStore?: GrantStore,
    _queueProducer?: QueueProducer
  ) {
    this.interactionService.on(
      "question:created",
      (question: PostedQuestion) => {
        this.renderQuestion(question).catch((error) => {
          logger.error("Failed to render question:", error);
        });
      }
    );

    this.interactionService.on(
      "suggestion:created",
      (suggestion: UserSuggestion) => {
        this.renderSuggestion(suggestion).catch((error) => {
          logger.error("Failed to render suggestion:", error);
        });
      }
    );

    this.interactionService.on("grant:requested", (req: PostedGrantRequest) => {
      this.renderGrantRequest(req).catch((error) => {
        logger.error("Failed to render grant request:", error);
      });
    });

    this.interactionService.on(
      "link-button:created",
      (btn: PostedLinkButton) => {
        if (btn.platform !== "slack") return;
        this.renderLinkButton(btn).catch((error) => {
          logger.error("Failed to render link button:", error);
        });
      }
    );

    setInterval(() => {
      const now = Date.now();
      for (const [id, stored] of this.storedGrants) {
        if (now - stored.createdAt > GRANT_TTL_MS) {
          this.storedGrants.delete(id);
        }
      }
    }, GRANT_TTL_MS);
  }

  /**
   * Render question with radio buttons inline
   */
  async renderQuestion(question: PostedQuestion): Promise<void> {
    logger.info(`Rendering question ${question.id}`);

    const questionText = convertMarkdownToSlack(question.question);

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: questionText },
      },
      {
        type: "actions",
        elements: [
          {
            type: "radio_buttons",
            action_id: `radio_${question.id}`,
            options: question.options.map((opt, idx) => ({
              text: {
                type: "plain_text",
                text: opt.length > 75 ? `${opt.substring(0, 72)}...` : opt,
              },
              value: `${idx}`,
            })),
          },
        ],
      },
    ];

    await this.client.chat.postMessage({
      channel: question.channelId,
      thread_ts: question.conversationId,
      text: questionText,
      blocks,
    });

    await this.setThreadStatus(question.channelId, question.conversationId, "");
  }

  /**
   * Render suggestions
   */
  async renderSuggestion(suggestion: UserSuggestion): Promise<void> {
    try {
      await this.client.assistant.threads.setSuggestedPrompts({
        channel_id: suggestion.channelId,
        thread_ts: suggestion.conversationId,
        prompts: suggestion.prompts.map((p) => ({
          title: p.title,
          message: p.message,
        })),
      });
    } catch (error) {
      logger.warn("Failed to set suggested prompts:", error);
    }
  }

  /**
   * Render grant request with approve/deny buttons.
   */
  async renderGrantRequest(req: PostedGrantRequest): Promise<void> {
    const shortId = req.id.replace("gr_", "").substring(0, 8);
    const domainList = req.domains.join(", ");

    logger.info(
      { grantId: req.id, shortId, domains: req.domains },
      "Rendering grant request"
    );

    this.storedGrants.set(shortId, {
      userId: req.userId,
      agentId: req.agentId,
      channelId: req.channelId,
      conversationId: req.conversationId,
      teamId: req.teamId,
      domains: req.domains,
      reason: req.reason,
      createdAt: Date.now(),
    });

    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🔒 *Domain access requested*\n\n*Domains:* ${domainList}\n*Reason:* ${req.reason}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ Approve (1h)" },
            action_id: `grant_1h_${shortId}`,
            style: "primary",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "✅ Approve" },
            action_id: `grant_perm_${shortId}`,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "❌ Deny" },
            action_id: `grant_deny_${shortId}`,
            style: "danger",
          },
        ],
      },
    ];

    await this.client.chat.postMessage({
      channel: req.channelId,
      thread_ts: req.conversationId,
      text: `🔒 Domain access requested: ${domainList}`,
      blocks,
    });

    await this.setThreadStatus(req.channelId, req.conversationId, "");
  }

  /**
   * Render a link button using Block Kit URL button.
   */
  async renderLinkButton(btn: PostedLinkButton): Promise<void> {
    logger.info(
      { buttonId: btn.id, channelId: btn.channelId, linkType: btn.linkType },
      "Rendering link button"
    );

    const blocks: any[] = [
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: btn.label },
            url: btn.url,
            action_id: `link_btn_${btn.id.replace("lb_", "").substring(0, 8)}`,
          },
        ],
      },
    ];

    try {
      await this.client.chat.postMessage({
        channel: btn.channelId,
        thread_ts: btn.conversationId,
        text: btn.label,
        blocks,
      });
    } catch (error) {
      logger.error("Failed to render link button:", error);
    }

    await this.setThreadStatus(btn.channelId, btn.conversationId, "");
  }

  /**
   * Set thread status (or clear if null)
   */
  async setThreadStatus(
    channelId: string,
    conversationId: string,
    status: string | null
  ): Promise<void> {
    try {
      await this.client.assistant.threads.setStatus({
        channel_id: channelId,
        thread_ts: conversationId,
        status: status || "",
      });
    } catch (error) {
      logger.warn("Failed to set thread status:", error);
    }
  }

  /** Get a stored grant by short ID (used by registerGrantHandlers). */
  getStoredGrant(shortId: string): StoredGrant | undefined {
    return this.storedGrants.get(shortId);
  }

  /** Delete a stored grant by short ID. */
  deleteStoredGrant(shortId: string): void {
    this.storedGrants.delete(shortId);
  }
}

// ============================================================================
// INTERACTION HANDLERS
// ============================================================================

/**
 * Register radio button handler — on selection, post chosen option as a
 * synthetic user message and route through normal message handling.
 */
export function registerInteractionHandlers(
  app: any,
  messageHandler: SlackMessageHandler
): void {
  // Radio button selection → post selected option as synthetic message
  app.action(/^radio_(.+)$/, async ({ ack, action, body, client }: any) => {
    await ack();

    const matches = action.action_id.match(/^radio_(.+)$/);
    if (!matches) return;

    const [_, questionId] = matches;
    const selectedIndex = parseInt(action.selected_option.value, 10);
    const selectedText =
      action.selected_option?.text?.text || `Option ${selectedIndex + 1}`;

    const userId = body.user?.id;
    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    const threadTs = body.message?.thread_ts || messageTs;

    if (!channelId || !threadTs) {
      logger.warn("Missing channel or thread info for radio selection");
      return;
    }

    logger.info({ questionId, selectedText, userId }, "Radio option selected");

    // Update original message to show selection (disable buttons)
    try {
      const questionText = body.message?.blocks?.[0]?.text?.text || "Question";
      await (client as WebClient).chat.update({
        channel: channelId,
        ts: messageTs,
        text: `${questionText}\n\n> ${selectedText}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: questionText },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `> ${selectedText}` },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Selected by <@${userId}>`,
              },
            ],
          },
        ],
      });
    } catch (error) {
      logger.warn("Failed to update question message:", error);
    }

    // Post selection as a visible message in the thread
    try {
      const postResult = await (client as WebClient).chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: selectedText,
      });

      // Route through normal message handling
      const context: SlackContext = {
        userId: userId!,
        channelId,
        teamId: body.team?.id || "",
        messageTs: postResult.ts as string,
        threadTs,
        text: selectedText,
      };

      await messageHandler.handleUserRequest(
        context,
        selectedText,
        client as WebClient
      );
    } catch (error) {
      logger.error("Failed to route radio selection as message:", error);
    }
  });
}

/**
 * Register grant button handlers — approve/deny domain access requests.
 */
export function registerGrantHandlers(
  app: any,
  interactionRenderer: SlackInteractionRenderer,
  grantStore: GrantStore,
  queueProducer?: QueueProducer
): void {
  app.action(
    /^grant_(1h|perm|deny)_(.+)$/,
    async ({ ack, action, body, client }: any) => {
      await ack();

      const matches = action.action_id.match(/^grant_(1h|perm|deny)_(.+)$/);
      if (!matches) return;

      const [, actionType, shortId] = matches;
      const stored = interactionRenderer.getStoredGrant(shortId);
      if (!stored) {
        logger.warn({ shortId }, "Grant request expired or not found");
        return;
      }

      // Verify clicking user
      const clickerId = body.user?.id;
      if (clickerId !== stored.userId) {
        logger.warn(
          { clickerId, expectedUserId: stored.userId },
          "User mismatch on grant callback"
        );
        return;
      }

      const channelId = body.channel?.id;
      const messageTs = body.message?.ts;
      const threadTs = body.message?.thread_ts || messageTs;
      const domainList = stored.domains.join(", ");

      if (!channelId || !threadTs) {
        logger.warn("Missing channel or thread info for grant callback");
        return;
      }

      try {
        let resultText: string;

        if (actionType === "deny") {
          for (const domain of stored.domains) {
            await grantStore.grant(stored.agentId, domain, null, true);
          }
          resultText = `Denied access to ${domainList}`;
        } else {
          const expiresAt =
            actionType === "1h" ? Date.now() + 60 * 60 * 1000 : null;
          const durationLabel = actionType === "1h" ? " for 1 hour" : "";
          for (const domain of stored.domains) {
            await grantStore.grant(stored.agentId, domain, expiresAt);
          }
          resultText = `Approved access to ${domainList}${durationLabel}`;
        }

        const emoji = actionType === "deny" ? "❌" : "✅";

        // Update original message: keep request context, show result, remove buttons
        try {
          await (client as WebClient).chat.update({
            channel: channelId,
            ts: messageTs,
            text: `🔒 Domain access requested: ${domainList}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🔒 *Domain access requested*\n\n*Domains:* ${domainList}\n*Reason:* ${stored.reason}`,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `> ${emoji} ${resultText}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Responded by <@${clickerId}>`,
                  },
                ],
              },
            ],
          });
        } catch (error) {
          logger.warn("Failed to update grant message:", error);
        }

        // Enqueue message to worker queue (invisible to user)
        if (queueProducer) {
          const messageId = `grant_${shortId}_${Date.now()}`;
          await queueProducer.enqueueMessage({
            userId: stored.userId,
            conversationId: stored.conversationId,
            messageId,
            channelId: stored.channelId,
            teamId: stored.teamId || "",
            agentId: stored.agentId,
            botId: "slack-bot",
            platform: "slack",
            messageText: resultText,
            platformMetadata: {},
            agentOptions: {},
          });
        }

        // Clean up
        interactionRenderer.deleteStoredGrant(shortId);

        logger.info(
          {
            shortId,
            actionType,
            domains: stored.domains,
            agentId: stored.agentId,
          },
          "Grant request handled"
        );
      } catch (error) {
        logger.error("Failed to handle grant callback:", error);
      }
    }
  );
}
