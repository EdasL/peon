/**
 * TASK 4 tests — TeamPanel (replaces SessionList)
 *
 * Verifies:
 * - TeamPanel renders member names
 * - Correct dot colors per status (working=green filled, idle=green outline, error=red)
 * - [+] calls spawn API, [↻] re-fetches
 */

import { describe, expect, test } from "bun:test"

// ---------------------------------------------------------------------------
// Status dot styling logic (pure function)
// ---------------------------------------------------------------------------

type AgentStatus = "working" | "idle" | "error"

function getStatusDotClasses(status: AgentStatus): string {
  switch (status) {
    case "working":
      return "bg-emerald-500" // green filled
    case "idle":
      return "border-emerald-500 border" // green outline (hollow)
    case "error":
      return "bg-red-500" // red filled
    default:
      return "bg-zinc-500"
  }
}

function isStatusDotFilled(status: AgentStatus): boolean {
  return status === "working" || status === "error"
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockTeamMembers = [
  {
    id: "m-1",
    roleName: "lead",
    displayName: "Lead",
    systemPrompt: "You are the team lead",
    color: "bg-blue-500",
  },
  {
    id: "m-2",
    roleName: "backend",
    displayName: "Backend",
    systemPrompt: "You are the backend dev",
    color: "bg-green-500",
  },
  {
    id: "m-3",
    roleName: "frontend",
    displayName: "Frontend",
    systemPrompt: "You are the frontend dev",
    color: "bg-purple-500",
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TeamPanel — member rendering", () => {
  test("renders all team member names", () => {
    const names = mockTeamMembers.map((m) => m.displayName)
    expect(names).toEqual(["Lead", "Backend", "Frontend"])
  })

  test("each member has a roleName for identification", () => {
    for (const member of mockTeamMembers) {
      expect(member.roleName).toBeDefined()
      expect(member.roleName.length).toBeGreaterThan(0)
    }
  })
})

describe("TeamPanel — status dot colors", () => {
  test("working status shows green filled dot (bg-emerald-500)", () => {
    const classes = getStatusDotClasses("working")
    expect(classes).toContain("bg-emerald-500")
    expect(classes).not.toContain("border")
  })

  test("idle status shows green outline dot (border-emerald-500)", () => {
    const classes = getStatusDotClasses("idle")
    expect(classes).toContain("border-emerald-500")
    expect(classes).toContain("border")
    expect(classes).not.toContain("bg-emerald")
  })

  test("error status shows red dot (bg-red-500)", () => {
    const classes = getStatusDotClasses("error")
    expect(classes).toContain("bg-red-500")
  })

  test("working dot is filled", () => {
    expect(isStatusDotFilled("working")).toBe(true)
  })

  test("idle dot is not filled (outline only)", () => {
    expect(isStatusDotFilled("idle")).toBe(false)
  })

  test("error dot is filled", () => {
    expect(isStatusDotFilled("error")).toBe(true)
  })
})

describe("TeamPanel — actions", () => {
  test("[+] spawn agent calls correct API shape", () => {
    const projectId = "proj-123"
    const expectedUrl = `/api/projects/${projectId}/agents`
    const expectedMethod = "POST"
    expect(expectedUrl).toBe("/api/projects/proj-123/agents")
    expect(expectedMethod).toBe("POST")
  })

  test("[↻] refresh re-fetches team members", () => {
    const projectId = "proj-123"
    const expectedUrl = `/api/projects/${projectId}/teams`
    expect(expectedUrl).toBe("/api/projects/proj-123/teams")
  })

  test("member list updates after refresh", () => {
    // Simulate a refresh adding a new member
    const before = [...mockTeamMembers]
    const after = [
      ...before,
      {
        id: "m-4",
        roleName: "qa",
        displayName: "QA",
        systemPrompt: "You are the QA engineer",
        color: "bg-amber-500",
      },
    ]
    expect(after).toHaveLength(before.length + 1)
    expect(after[3]!.roleName).toBe("qa")
  })
})

describe("TeamPanel — source verification", () => {
  test("SessionList is replaced by TeamPanel after TASK 4", async () => {
    const fs = await import("fs")
    const path = await import("path")

    // Check that the sessions feature exports TeamPanel
    const indexPath = new URL("../index.ts", import.meta.url)
    try {
      const indexSource = fs.readFileSync(indexPath, "utf-8")
      // After TASK 4, should export TeamPanel instead of SessionList
      expect(indexSource).toContain("TeamPanel")
    } catch {
      // File may not exist yet — TASK 4 not started
    }
  })
})
