"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePanel } from "./usePanel";

export interface TerminalTab {
  id: string;
  title: string;
  ptyId: string;
}

// ── Pure helpers (exported for testing) ──────────────────────────

export function buildNewTab(shellName: string): TerminalTab {
  const ts = Date.now();
  return {
    id: `tab-${ts}-${Math.random().toString(36).slice(2, 9)}`,
    ptyId: `pty-${ts}-${Math.random().toString(36).slice(2, 9)}`,
    title: shellName,
  };
}

export function removeTab(tabs: TerminalTab[], id: string): TerminalTab[] {
  return tabs.filter(t => t.id !== id);
}

export function updateTabTitle(
  tabs: TerminalTab[],
  id: string,
  title: string
): TerminalTab[] {
  return tabs.map(t => (t.id === id ? { ...t, title } : t));
}

// ── Detect default shell name ─────────────────────────────────────

function detectShellName(): string {
  if (typeof process !== "undefined") {
    const shell = process.env.SHELL ?? "";
    if (shell) return shell.split("/").pop() ?? "bash";
  }
  return "bash";
}

// ── Hook ─────────────────────────────────────────────────────────

export function useTerminalTabs() {
  const { workingDirectory, terminalOpen, setTerminalOpen } = usePanel();
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const tabsRef = useRef<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.terminal;

  const onDataCallbacksRef = useRef<Map<string, (data: string) => void>>(new Map());
  const creatingRef = useRef(false);

  const setTabsAndRef = useCallback((fn: (prev: TerminalTab[]) => TerminalTab[]) => {
    setTabs(prev => {
      const next = fn(prev);
      tabsRef.current = next;
      return next;
    });
  }, []);

  // Subscribe to PTY data/exit once on mount
  useEffect(() => {
    const api = window.electronAPI?.terminal;
    if (!api) return;

    const unsubData = api.onData((payload) => {
      onDataCallbacksRef.current.get(payload.id)?.(payload.data);
    });

    const unsubExit = api.onExit((payload) => {
      // payload.id is the PTY id (ptyId), not the tab's own id
      setTabsAndRef(prev => {
        const tab = prev.find(t => t.ptyId === payload.id);
        if (!tab) return prev;
        const remaining = removeTab(prev, tab.id);
        if (remaining.length === 0) {
          setTerminalOpen(false);
          setActiveTabId(null);
          return [];
        }
        setActiveTabId(activeId => {
          if (activeId === tab.id) return remaining[remaining.length - 1].id;
          return activeId;
        });
        return remaining;
      });
    });

    return () => {
      unsubData();
      unsubExit();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createTab = useCallback(async () => {
    const api = window.electronAPI?.terminal;
    if (!api || !workingDirectory) return;
    if (creatingRef.current) return;
    creatingRef.current = true;

    try {
      if (!terminalOpen) setTerminalOpen(true);

      const shell = detectShellName();
      const newTab = buildNewTab(shell);

      // Create PTY first — TerminalInstance will mount after state update and
      // should find the PTY already running when it attaches xterm.js
      await api.create({ id: newTab.ptyId, cwd: workingDirectory, cols: 120, rows: 30 });

      setTabsAndRef(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);

      return newTab;
    } finally {
      creatingRef.current = false;
    }
  }, [workingDirectory, terminalOpen, setTerminalOpen, setTabsAndRef]);

  // Listen for ⌘T IPC push from main process
  useEffect(() => {
    const api = window.electronAPI?.terminal;
    if (!api?.onNewTab) return;
    const unsub = api.onNewTab(() => createTab());
    return unsub;
  }, [createTab]);

  // Create initial tab when drawer opens
  useEffect(() => {
    if (terminalOpen && isElectron && tabs.length === 0) {
      createTab();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalOpen, isElectron]);

  const closeTab = useCallback(async (tabId: string) => {
    const api = window.electronAPI?.terminal;
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab) return;

    if (api) {
      try { await api.kill(tab.ptyId); } catch { /* ignore */ }
    }

    setTabsAndRef(prev => {
      const remaining = removeTab(prev, tabId);
      if (remaining.length === 0) {
        setTerminalOpen(false);
        setActiveTabId(null);
        return [];
      }
      setActiveTabId(id => {
        if (id === tabId) return remaining[remaining.length - 1].id;
        return id;
      });
      return remaining;
    });
  }, [setTerminalOpen, setTabsAndRef]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const renameTab = useCallback((tabId: string, title: string) => {
    setTabsAndRef(prev => updateTabTitle(prev, tabId, title));
  }, [setTabsAndRef]);

  const setOnData = useCallback((ptyId: string, cb: (data: string) => void) => {
    onDataCallbacksRef.current.set(ptyId, cb);
    return () => { onDataCallbacksRef.current.delete(ptyId); };
  }, []);

  // Clean up all PTY processes on unmount
  useEffect(() => {
    return () => {
      const api = window.electronAPI?.terminal;
      if (!api) return;
      tabsRef.current.forEach(t => api.kill(t.ptyId).catch(() => {}));
    };
  }, []);

  return {
    isElectron,
    tabs,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
    renameTab,
    setOnData,
  };
}
