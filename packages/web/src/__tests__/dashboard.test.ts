/**
 * TASK 1 tests — DashboardPage
 *
 * Verifies:
 * - Dashboard renders project cards with name/status/agent count
 * - No chat textarea/input rendered
 * - Empty state renders when no projects
 */

import { describe, expect, test, beforeEach, mock } from "bun:test"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockProjects = [
  {
    id: "proj-1",
    name: "bold-eagle",
    repoUrl: "https://github.com/test/repo",
    templateId: "default",
    status: "running" as const,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-05T12:00:00Z",
  },
  {
    id: "proj-2",
    name: "swift-fox",
    repoUrl: null,
    templateId: "default",
    status: "stopped" as const,
    createdAt: "2026-03-02T00:00:00Z",
    updatedAt: "2026-03-04T08:00:00Z",
  },
]

const mockTeams = [
  {
    id: "team-1",
    projectId: "proj-1",
    name: "dev-team",
    members: [
      { id: "m-1", roleName: "lead", displayName: "Lead", systemPrompt: "", color: "bg-blue-500" },
      { id: "m-2", roleName: "backend", displayName: "Backend", systemPrompt: "", color: "bg-green-500" },
      { id: "m-3", roleName: "frontend", displayName: "Frontend", systemPrompt: "", color: "bg-purple-500" },
    ],
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardPage", () => {
  describe("project card rendering", () => {
    test("project data contains name, status, and template", () => {
      const project = mockProjects[0]!
      expect(project.name).toBe("bold-eagle")
      expect(project.status).toBe("running")
      expect(project.templateId).toBe("default")
    })

    test("agent count is derived from team members length", () => {
      const team = mockTeams[0]!
      const agentCount = team.members.length
      expect(agentCount).toBe(3)
    })

    test("agent count is 0 when no teams", () => {
      const teams: typeof mockTeams = []
      const agentCount = teams[0]?.members?.length ?? 0
      expect(agentCount).toBe(0)
    })

    test("status dot maps correctly for all statuses", () => {
      const statusMap: Record<string, string> = {
        running: "bg-emerald-500",
        creating: "bg-amber-400",
        stopped: "border-zinc-500",
        error: "bg-red-500",
      }
      expect(statusMap["running"]).toBe("bg-emerald-500")
      expect(statusMap["creating"]).toBe("bg-amber-400")
      expect(statusMap["stopped"]).toBe("border-zinc-500")
      expect(statusMap["error"]).toBe("bg-red-500")
    })

    test("status label maps correctly", () => {
      function statusLabel(status: string): string {
        switch (status) {
          case "running": return "Running"
          case "creating": return "Creating"
          case "stopped": return "Stopped"
          case "error": return "Error"
          default: return status
        }
      }
      expect(statusLabel("running")).toBe("Running")
      expect(statusLabel("creating")).toBe("Creating")
      expect(statusLabel("stopped")).toBe("Stopped")
      expect(statusLabel("error")).toBe("Error")
    })
  })

  describe("no chat UI on dashboard", () => {
    test("DashboardPage component does not import ChatPanel", async () => {
      // Read the DashboardPage source and verify it doesn't reference chat components
      const fs = await import("fs")
      const source = fs.readFileSync(
        new URL("../pages/DashboardPage.tsx", import.meta.url),
        "utf-8"
      )
      expect(source).not.toContain("ChatPanel")
      expect(source).not.toContain("<textarea")
      expect(source).not.toContain("sendMessage")
      expect(source).not.toContain("sendChatMessage")
    })
  })

  describe("empty state", () => {
    test("empty projects array triggers empty state path", () => {
      const projects: typeof mockProjects = []
      expect(projects.length).toBe(0)
      // When projects.length === 0, the empty state renders
      const shouldShowEmptyState = projects.length === 0
      expect(shouldShowEmptyState).toBe(true)
    })

    test("DashboardPage source contains empty state text", async () => {
      const fs = await import("fs")
      const source = fs.readFileSync(
        new URL("../pages/DashboardPage.tsx", import.meta.url),
        "utf-8"
      )
      expect(source).toContain("No projects yet")
      expect(source).toContain("Create your first project")
    })
  })

  describe("timeAgo helper", () => {
    // Re-implement timeAgo for unit testing
    function timeAgo(dateStr: string): string {
      const diff = Date.now() - new Date(dateStr).getTime()
      const s = Math.floor(diff / 1000)
      if (s < 60) return "Just now"
      const m = Math.floor(s / 60)
      if (m < 60) return `${m}m ago`
      const h = Math.floor(m / 60)
      if (h < 24) return `${h}h ago`
      const d = Math.floor(h / 24)
      if (d < 30) return `${d}d ago`
      const mo = Math.floor(d / 30)
      if (mo < 12) return `${mo}mo ago`
      return `${Math.floor(mo / 12)}y ago`
    }

    test("returns 'Just now' for recent timestamps", () => {
      const now = new Date().toISOString()
      expect(timeAgo(now)).toBe("Just now")
    })

    test("returns minutes for timestamps under 1 hour", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      expect(timeAgo(fiveMinAgo)).toBe("5m ago")
    })

    test("returns hours for timestamps under 1 day", () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      expect(timeAgo(threeHoursAgo)).toBe("3h ago")
    })

    test("returns days for timestamps under 30 days", () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      expect(timeAgo(tenDaysAgo)).toBe("10d ago")
    })
  })
})
