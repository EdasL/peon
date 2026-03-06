import { describe, test, expect } from "bun:test"

// Basic structural tests for DashboardPage refactor
// These verify the module exports and key behaviors without a DOM

describe("DashboardPage", () => {
  test("exports DashboardPage component", async () => {
    // Verify the module can be imported and has the expected export
    const mod = await import("./DashboardPage")
    expect(mod.DashboardPage).toBeDefined()
    expect(typeof mod.DashboardPage).toBe("function")
  })

  test("does not export ProjectsSidebar", async () => {
    const mod = await import("./DashboardPage") as Record<string, unknown>
    expect(mod.ProjectsSidebar).toBeUndefined()
  })
})
