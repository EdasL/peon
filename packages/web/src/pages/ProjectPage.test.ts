import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = typeof import.meta.dir !== "undefined"
  ? import.meta.dir
  : dirname(fileURLToPath(import.meta.url))

describe("ProjectPage", () => {
  const source = readFileSync(
    join(__dirname, "ProjectPage.tsx"),
    "utf-8"
  )

  test("exports ProjectPage component", async () => {
    const mod = await import("./ProjectPage")
    expect(mod.ProjectPage).toBeDefined()
    expect(typeof mod.ProjectPage).toBe("function")
  })

  test("does not import ActivityFeed", () => {
    expect(source).not.toContain("ActivityFeed")
  })

  test("does not import PanelRightClose or PanelRightOpen", () => {
    expect(source).not.toContain("PanelRightClose")
    expect(source).not.toContain("PanelRightOpen")
  })

  test("does not reference rightOpen state", () => {
    expect(source).not.toContain("rightOpen")
  })

  test("does not import useAgentActivity", () => {
    expect(source).not.toContain("useAgentActivity")
  })

  test("keeps left panel toggle", () => {
    expect(source).toContain("leftOpen")
    expect(source).toContain("PanelLeftClose")
  })

  test("keeps Chat and Board tabs", () => {
    expect(source).toContain("ChatPanel")
    expect(source).toContain("KanbanPanel")
    expect(source).toContain('"chat"')
    expect(source).toContain('"board"')
  })

  test("left panel is 220px or 240px wide", () => {
    expect(source).toMatch(/w-\[2[24]0px\]/)
  })
})
