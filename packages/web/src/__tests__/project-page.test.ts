/**
 * TASK 2 tests — ProjectPage
 *
 * Verifies:
 * - ActivityFeed not in DOM (right panel removed)
 * - Right panel toggle not rendered
 * - Two-panel layout present (left team + center content)
 */

import { describe, expect, test } from "bun:test"

describe("ProjectPage — right panel removal", () => {
  // Source-level verification that ActivityFeed and right panel toggle are removed.
  // These tests read the actual component source to verify the spec.

  let projectPageSource: string

  test("loads ProjectPage source", async () => {
    const fs = await import("fs")
    projectPageSource = fs.readFileSync(
      new URL("../pages/ProjectPage.tsx", import.meta.url),
      "utf-8"
    )
    expect(projectPageSource.length).toBeGreaterThan(0)
  })

  test("ActivityFeed is not rendered in ProjectBody", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../pages/ProjectPage.tsx", import.meta.url),
      "utf-8"
    )
    // After TASK 2, ActivityFeed should not be rendered (import may remain but usage removed)
    // Check that <ActivityFeed is not in JSX
    const activityFeedUsages = (source.match(/<ActivityFeed/g) || []).length
    // TASK 2 spec: ActivityFeed not in DOM
    // If this fails, TASK 2 has not been completed yet
    expect(activityFeedUsages).toBe(0)
  })

  test("right panel toggle button (PanelRightClose/PanelRightOpen) is not rendered", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../pages/ProjectPage.tsx", import.meta.url),
      "utf-8"
    )
    // After TASK 2, the right panel toggle should be removed
    expect(source).not.toContain("PanelRightClose")
    expect(source).not.toContain("PanelRightOpen")
  })

  test("rightOpen state is not used", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../pages/ProjectPage.tsx", import.meta.url),
      "utf-8"
    )
    // After TASK 2, rightOpen state should be removed
    expect(source).not.toContain("rightOpen")
    expect(source).not.toContain("setRightOpen")
  })

  test("two-panel layout: left panel and center content exist", async () => {
    const fs = await import("fs")
    const source = fs.readFileSync(
      new URL("../pages/ProjectPage.tsx", import.meta.url),
      "utf-8"
    )
    // Left panel should still exist
    expect(source).toContain("leftOpen")
    expect(source).toContain("PanelLeftClose")
    // Center content with chat/board tabs should still exist
    expect(source).toContain("ChatPanel")
    expect(source).toContain("KanbanPanel")
  })
})
