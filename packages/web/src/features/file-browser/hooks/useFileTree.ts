import { useState, useCallback, useEffect, useRef } from 'react';
import { useOpenClaw } from '@/contexts/OpenClawContext';
import type { TreeEntry } from '../types';

const STORAGE_KEY = 'peon-file-tree-expanded';

function loadExpandedPaths(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set<string>();
}

function saveExpandedPaths(paths: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...paths]));
  } catch { /* ignore */ }
}

function mergeChildren(
  entries: TreeEntry[],
  parentPath: string,
  children: TreeEntry[],
): TreeEntry[] {
  return entries.map((entry) => {
    if (entry.path === parentPath && entry.type === 'directory') {
      return { ...entry, children };
    }
    if (entry.children && entry.type === 'directory') {
      return { ...entry, children: mergeChildren(entry.children, parentPath, children) };
    }
    return entry;
  });
}

/** Hook for managing file tree state via OpenClaw RPC. */
export function useFileTree() {
  const { rpc, connectionState } = useOpenClaw();
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(loadExpandedPaths);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [workspaceInfo, setWorkspaceInfo] = useState<{ isCustomWorkspace: boolean; rootPath: string } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    saveExpandedPaths(expandedPaths);
  }, [expandedPaths]);

  const fetchChildren = useCallback(async (dirPath: string): Promise<TreeEntry[] | null> => {
    try {
      const result = await rpc('files.tree', { path: dirPath || undefined, depth: 1 }) as {
        ok?: boolean;
        entries?: TreeEntry[];
        workspaceInfo?: { isCustomWorkspace: boolean; rootPath: string };
        error?: string;
      };
      if (result.workspaceInfo) {
        setWorkspaceInfo(result.workspaceInfo);
      }
      return result.ok ? (result.entries ?? null) : null;
    } catch {
      return null;
    }
  }, [rpc]);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const children = await fetchChildren('');
    if (!mountedRef.current) return;

    if (children) {
      setEntries(children);

      const expanded = loadExpandedPaths();
      if (expanded.size > 0) {
        const promises = [...expanded].map(async (p) => {
          const ch = await fetchChildren(p);
          return ch ? { path: p, children: ch } : null;
        });
        const results = await Promise.all(promises);
        if (!mountedRef.current) return;

        let tree = children;
        for (const r of results) {
          if (r) tree = mergeChildren(tree, r.path, r.children);
        }
        setEntries(tree);
      }
    } else {
      setError('Failed to load file tree');
    }
    setLoading(false);
  }, [fetchChildren]);

  useEffect(() => {
    if (connectionState === 'connected') {
      void loadRoot();
    }
  }, [loadRoot, connectionState]);

  const toggleDirectory = useCallback(async (dirPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
        return next;
      }
      next.add(dirPath);
      return next;
    });

    if (expandedPaths.has(dirPath)) return;

    const findEntry = (es: TreeEntry[], target: string): TreeEntry | null => {
      for (const e of es) {
        if (e.path === target) return e;
        if (e.children) {
          const found = findEntry(e.children, target);
          if (found) return found;
        }
      }
      return null;
    };
    const entry = findEntry(entries, dirPath);
    if (entry?.children !== null && entry?.children !== undefined) return;

    setLoadingPaths((prev) => new Set([...prev, dirPath]));
    const children = await fetchChildren(dirPath);
    if (!mountedRef.current) return;
    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });

    if (children) {
      setEntries((prev) => mergeChildren(prev, dirPath, children));
    }
  }, [expandedPaths, entries, fetchChildren]);

  const selectFile = useCallback((filePath: string) => {
    setSelectedPath(filePath);
  }, []);

  const refresh = useCallback(() => {
    setEntries([]);
    loadRoot();
  }, [loadRoot]);

  const refreshDirectory = useCallback(async (dirPath: string) => {
    const children = await fetchChildren(dirPath);
    if (!mountedRef.current || !children) return;

    if (!dirPath) {
      setEntries((prev) => {
        return children.map(fresh => {
          const existing = prev.find(e => e.path === fresh.path);
          if (existing?.children && fresh.type === 'directory') {
            return { ...fresh, children: existing.children };
          }
          return fresh;
        });
      });
    } else {
      setEntries((prev) => mergeChildren(prev, dirPath, children));
    }
  }, [fetchChildren]);

  const handleFileChange = useCallback((changedPath: string) => {
    const parentDir = changedPath.includes('/')
      ? changedPath.substring(0, changedPath.lastIndexOf('/'))
      : '';
    if (!parentDir || expandedPaths.has(parentDir)) {
      refreshDirectory(parentDir);
    }
  }, [expandedPaths, refreshDirectory]);

  return {
    entries,
    loading,
    error,
    expandedPaths,
    selectedPath,
    loadingPaths,
    workspaceInfo,
    toggleDirectory,
    selectFile,
    refresh,
    handleFileChange,
  };
}
