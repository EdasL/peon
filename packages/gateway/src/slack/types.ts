#!/usr/bin/env bun

/**
 * Slack-specific type definitions
 * Imports and re-exports types from Slack SDK to ensure type safety
 */

import type { BlockAction, SlackActionMiddlewareArgs } from "@slack/bolt";
import type { GenericMessageEvent, ModalView } from "@slack/types";

// App-specific context type (not in SDK)
export interface SlackContext {
  channelId: string;
  userId: string;
  userDisplayName?: string;
  teamId: string;
  threadTs?: string;
  messageTs: string;
  text: string;
  messageUrl?: string;
}

// Helper type for message events (combining GenericMessageEvent with common properties)
export interface SlackMessageEvent
  extends Omit<GenericMessageEvent, "channel_type"> {
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  channel_type: string;
  team?: string; // Team ID from Slack event (optional - use bodyTeamId as fallback)
}

// Helper type for action body (from middleware args)
export type SlackActionBody = SlackActionMiddlewareArgs<BlockAction>["body"];

// ModalView with state property (Slack SDK types don't include this properly)
export interface ModalViewWithState extends ModalView {
  state: {
    values: Record<string, Record<string, { value?: string }>>;
  };
}
