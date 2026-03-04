import type { Session } from "@/lib/openclaw-types"
import { getSessionKey } from "@/lib/openclaw-types"

export interface TreeNode {
  session: Session
  key: string
  parentId: string | null
  depth: number
  children: TreeNode[]
  isExpanded: boolean
}

export function getSessionType(
  sessionKey: string,
): "main" | "subagent" | "cron" | "cron-run" {
  if (/:cron:[^:]+:run:/.test(sessionKey)) return "cron-run"
  if (/:cron:/.test(sessionKey)) return "cron"
  if (/:subagent:/.test(sessionKey)) return "subagent"
  return "main"
}

function inferParentKey(sessionKey: string): string | null {
  const cronRunMatch = sessionKey.match(/^(.+:cron:[^:]+):run:.+$/)
  if (cronRunMatch) return cronRunMatch[1]
  const subMatch = sessionKey.match(/^(agent:[^:]+):subagent:.+$/)
  if (subMatch) return `${subMatch[1]}:main`
  const cronMatch = sessionKey.match(/^(agent:[^:]+):cron:.+$/)
  if (cronMatch) return `${cronMatch[1]}:main`
  return null
}

export function buildSessionTree(sessions: Session[]): TreeNode[] {
  if (sessions.length === 0) return []

  const keyMap = new Map<string, Session>()
  for (const s of sessions) {
    keyMap.set(getSessionKey(s), s)
  }

  const parentMap = new Map<string, string | null>()
  for (const s of sessions) {
    const sk = getSessionKey(s)
    if (s.parentId) {
      parentMap.set(sk, keyMap.has(s.parentId) ? s.parentId : null)
    } else {
      const inferred = inferParentKey(sk)
      parentMap.set(sk, inferred && keyMap.has(inferred) ? inferred : null)
    }
  }

  const childrenOf = new Map<string | null, Session[]>()
  for (const s of sessions) {
    const sk = getSessionKey(s)
    const pid = parentMap.get(sk) ?? null
    const list = childrenOf.get(pid)
    if (list) {
      list.push(s)
    } else {
      childrenOf.set(pid, [s])
    }
  }

  function buildNodes(parentKey: string | null, depth: number): TreeNode[] {
    const children = childrenOf.get(parentKey)
    if (!children) return []

    const typeOrder = { main: 0, subagent: 1, cron: 2, "cron-run": 3 }
    const sorted = [...children].sort((a, b) => {
      const ta = typeOrder[getSessionType(getSessionKey(a))] ?? 9
      const tb = typeOrder[getSessionType(getSessionKey(b))] ?? 9
      if (ta !== tb) return ta - tb
      if (ta === 3) {
        const timeA = a.lastActivity
          ? new Date(String(a.lastActivity)).getTime()
          : 0
        const timeB = b.lastActivity
          ? new Date(String(b.lastActivity)).getTime()
          : 0
        return timeB - timeA
      }
      const la = (a.label || getSessionKey(a)).toLowerCase()
      const lb = (b.label || getSessionKey(b)).toLowerCase()
      return la.localeCompare(lb)
    })

    return sorted.map((s) => {
      const sk = getSessionKey(s)
      return {
        session: s,
        key: sk,
        parentId: parentKey,
        depth,
        children: buildNodes(sk, depth + 1),
        isExpanded: true,
      }
    })
  }

  return buildNodes(null, 0)
}

export function flattenTree(
  roots: TreeNode[],
  expandedState: Record<string, boolean>,
): TreeNode[] {
  const result: TreeNode[] = []

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      result.push(node)
      const isExpanded = expandedState[node.key] ?? node.isExpanded
      if (isExpanded && node.children.length > 0) {
        walk(node.children)
      }
    }
  }

  walk(roots)
  return result
}
