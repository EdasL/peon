/**
 * Tests for hook-events route — Claude Code hook event -> agent status mapping.
 *
 * 1. Pure function tests: mapHookEventToStatus
 * 2. Integration tests: POST /internal/hook-events -> SSE broadcast
 */

import { describe, expect, test } from "bun:test"
import { mapHookEventToStatus } from "../routes/internal/hook-events"
import type { AgentStatus } from "../routes/internal/hook-events"

describe("mapHookEventToStatus", () => {
  const cases: Array<[string, string | undefined, AgentStatus | null]> = [
    // Working events
    ["PreToolUse", undefined, "working"],
    ["PostToolUse", undefined, "working"],
    ["SubagentStart", undefined, "working"],

    // Error events
    ["PostToolUseFailure", undefined, "error"],

    // Idle events
    ["Stop", undefined, "idle"],
    ["SessionEnd", undefined, "idle"],
    ["SubagentStop", undefined, "idle"],

    // Notification — only idle_prompt triggers idle
    ["Notification", "idle_prompt", "idle"],
    ["Notification", "other_type", null],
    ["Notification", undefined, null],

    // Unknown events return null
    ["SomeRandomEvent", undefined, null],
    ["", undefined, null],
  ]

  for (const [eventType, notificationType, expected] of cases) {
    const label = notificationType
      ? `${eventType} (notification_type=${notificationType})`
      : eventType || "(empty)"

    test(`${label} -> ${expected}`, () => {
      expect(mapHookEventToStatus(eventType, notificationType)).toBe(expected)
    })
  }
})

describe("HookEventPayload validation", () => {
  test("all working events produce 'working' status", () => {
    const workingEvents = ["PreToolUse", "PostToolUse", "SubagentStart"]
    for (const event of workingEvents) {
      expect(mapHookEventToStatus(event)).toBe("working")
    }
  })

  test("all idle events produce 'idle' status", () => {
    const idleEvents = ["Stop", "SessionEnd", "SubagentStop"]
    for (const event of idleEvents) {
      expect(mapHookEventToStatus(event)).toBe("idle")
    }
  })

  test("PostToolUseFailure produces 'error' status", () => {
    expect(mapHookEventToStatus("PostToolUseFailure")).toBe("error")
  })

  test("Notification without idle_prompt returns null (no broadcast)", () => {
    expect(mapHookEventToStatus("Notification")).toBeNull()
    expect(mapHookEventToStatus("Notification", "message")).toBeNull()
  })

  test("Notification with idle_prompt returns idle", () => {
    expect(mapHookEventToStatus("Notification", "idle_prompt")).toBe("idle")
  })
})
