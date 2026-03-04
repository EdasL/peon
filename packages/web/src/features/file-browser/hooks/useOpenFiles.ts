import { useState, useCallback, useRef, useEffect } from 'react';
import { useOpenClaw } from '@/contexts/OpenClawContext';
import { isImageFile } from '../utils/fileTypes';
import type { OpenFile } from '../types';

const STORAGE_KEY_FILES = 'peon-open-files';
const STORAGE_KEY_TAB = 'peon-active-tab';
const MAX_OPEN_TABS = 20;

function loadPersistedFiles(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FILES);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function loadPersistedTab(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_TAB) || 'chat';
  } catch { return 'chat'; }
}

function persistFiles(files: OpenFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files.map(f => f.path)));
  } catch { /* ignore */ }
}

function persistTab(tab: string) {
  try {
    localStorage.setItem(STORAGE_KEY_TAB, tab);
  } catch { /* ignore */ }
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function matchesPathPrefix(candidatePath: string, prefix: string): boolean {
  return candidatePath === prefix || candidatePath.startsWith(`${prefix}/`);
}

function remapPathPrefix(candidatePath: string, fromPrefix: string, toPrefix: string): string {
  if (candidatePath === fromPrefix) return toPrefix;
  if (!candidatePath.startsWith(`${fromPrefix}/`)) return candidatePath;
  return `${toPrefix}${candidatePath.slice(fromPrefix.length)}`;
}

export function useOpenFiles() {
  const { rpc } = useOpenClaw();
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeTab, setActiveTabState] = useState<string>(loadPersistedTab);
  const initializedRef = useRef(false);

  const recentSaveMtimes = useRef<Map<string, number>>(new Map());
  const savingPaths = useRef<Set<string>>(new Set());

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    persistTab(tab);
  }, []);

  const openFilesRef = useRef<OpenFile[]>([]);
  openFilesRef.current = openFiles;

  const initializeFiles = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const paths = loadPersistedFiles();
    if (paths.length === 0) return;

    const files: OpenFile[] = [];
    for (const p of paths) {
      try {
        const data = await rpc('files.read', { path: p }) as {
          ok?: boolean;
          content?: string;
          mtime?: number;
          error?: string;
        };
        if (!data.ok) continue;
        files.push({
          path: p,
          name: basename(p),
          content: data.content ?? '',
          savedContent: data.content ?? '',
          dirty: false,
          locked: false,
          mtime: data.mtime ?? 0,
          loading: false,
        });
      } catch {
        // Skip files that can't be loaded
      }
    }

    if (files.length > 0) {
      setOpenFiles(files);
    }
  }, [rpc]);

  const openFile = useCallback(async (filePath: string) => {
    if (openFilesRef.current.some(f => f.path === filePath)) {
      setActiveTab(filePath);
      return;
    }

    setOpenFiles((prev) => {
      const existing = prev.find(f => f.path === filePath);
      if (existing) return prev;

      let base = prev;
      if (base.length >= MAX_OPEN_TABS) {
        const oldest = base.find(f => !f.dirty);
        if (oldest) {
          base = base.filter(f => f.path !== oldest.path);
        } else {
          base = base.slice(1);
        }
      }

      const newFile: OpenFile = {
        path: filePath,
        name: basename(filePath),
        content: '',
        savedContent: '',
        dirty: false,
        locked: false,
        mtime: 0,
        loading: true,
      };
      const next = [...base, newFile];
      persistFiles(next);
      return next;
    });

    setActiveTab(filePath);

    if (isImageFile(basename(filePath))) {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath ? { ...f, loading: false } : f,
        ),
      );
      return;
    }

    try {
      const data = await rpc('files.read', { path: filePath }) as {
        ok?: boolean;
        content?: string;
        mtime?: number;
        error?: string;
      };

      setOpenFiles((prev) =>
        prev.map((f) => {
          if (f.path !== filePath) return f;
          if (!data.ok) {
            return { ...f, loading: false, error: data.error || 'Failed to load' };
          }
          return {
            ...f,
            content: data.content ?? '',
            savedContent: data.content ?? '',
            mtime: data.mtime ?? 0,
            loading: false,
            error: undefined,
          };
        }),
      );
    } catch {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath
            ? { ...f, loading: false, error: 'Network error' }
            : f,
        ),
      );
    }
  }, [rpc, setActiveTab]);

  const closeFile = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter(f => f.path !== filePath);
      persistFiles(next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (currentTab !== filePath) return currentTab;
      const tab = 'chat';
      persistTab(tab);
      return tab;
    });
  }, []);

  const updateContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path !== filePath) return f;
        return { ...f, content, dirty: content !== f.savedContent };
      }),
    );
  }, []);

  const saveFile = useCallback(async (filePath: string): Promise<{ ok: boolean; conflict?: boolean }> => {
    const file = openFilesRef.current.find(f => f.path === filePath);
    if (!file) return { ok: false };

    try {
      savingPaths.current.add(filePath);

      const data = await rpc('files.write', {
        path: filePath,
        content: file.content,
        expectedMtime: file.mtime,
      }) as {
        ok?: boolean;
        mtime?: number;
        conflict?: boolean;
        error?: string;
      };

      if (data.ok) {
        recentSaveMtimes.current.set(filePath, data.mtime ?? 0);
        setTimeout(() => recentSaveMtimes.current.delete(filePath), 2000);

        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === filePath
              ? { ...f, savedContent: f.content, dirty: false, mtime: data.mtime ?? 0 }
              : f,
          ),
        );
        savingPaths.current.delete(filePath);
        return { ok: true };
      }

      if (data.conflict) {
        savingPaths.current.delete(filePath);
        return { ok: false, conflict: true };
      }

      savingPaths.current.delete(filePath);
      return { ok: false };
    } catch {
      savingPaths.current.delete(filePath);
      return { ok: false };
    }
  }, [rpc]);

  const reloadFile = useCallback(async (filePath: string) => {
    try {
      const data = await rpc('files.read', { path: filePath }) as {
        ok?: boolean;
        content?: string;
        mtime?: number;
        error?: string;
      };

      if (!data.ok) {
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === filePath
              ? { ...f, error: data.error || 'File was deleted', locked: false, loading: false }
              : f,
          ),
        );
        return;
      }

      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath
            ? {
                ...f,
                content: data.content ?? '',
                savedContent: data.content ?? '',
                dirty: false,
                mtime: data.mtime ?? 0,
                error: undefined,
              }
            : f,
        ),
      );
    } catch { /* ignore */ }
  }, [rpc]);

  const unlockTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const timers = unlockTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const handleFileChanged = useCallback((changedPath: string) => {
    if (recentSaveMtimes.current.has(changedPath)) return;
    if (savingPaths.current.has(changedPath)) return;

    const isOpen = openFilesRef.current.some(f => f.path === changedPath);
    if (!isOpen) return;

    setOpenFiles((prev) =>
      prev.map(f =>
        f.path === changedPath ? { ...f, locked: true } : f,
      ),
    );

    reloadFile(changedPath).then(() => {
      const existing = unlockTimers.current.get(changedPath);
      if (existing) clearTimeout(existing);

      const timer = window.setTimeout(() => {
        unlockTimers.current.delete(changedPath);
        setOpenFiles((prev) =>
          prev.map(f =>
            f.path === changedPath ? { ...f, locked: false } : f,
          ),
        );
      }, 5000);
      unlockTimers.current.set(changedPath, timer);
    });
  }, [reloadFile]);

  const remapOpenPaths = useCallback((fromPath: string, toPath: string) => {
    if (!fromPath || !toPath || fromPath === toPath) return;

    setOpenFiles((prev) => {
      const next = prev.map((f) => {
        if (!matchesPathPrefix(f.path, fromPath)) return f;
        const nextPath = remapPathPrefix(f.path, fromPath, toPath);
        return {
          ...f,
          path: nextPath,
          name: basename(nextPath),
        };
      });
      persistFiles(next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (!matchesPathPrefix(currentTab, fromPath)) return currentTab;
      const nextTab = remapPathPrefix(currentTab, fromPath, toPath);
      persistTab(nextTab);
      return nextTab;
    });
  }, []);

  const closeOpenPathsByPrefix = useCallback((pathPrefix: string) => {
    if (!pathPrefix) return;

    setOpenFiles((prev) => {
      const next = prev.filter((f) => !matchesPathPrefix(f.path, pathPrefix));
      persistFiles(next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (!matchesPathPrefix(currentTab, pathPrefix)) return currentTab;
      persistTab('chat');
      return 'chat';
    });
  }, []);

  return {
    openFiles,
    activeTab,
    setActiveTab,
    openFile,
    closeFile,
    updateContent,
    saveFile,
    reloadFile,
    initializeFiles,
    handleFileChanged,
    remapOpenPaths,
    closeOpenPathsByPrefix,
  };
}
