# Terminal xterm.js + 多 Tab 升级 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 xterm.js 替换现有 ansi-to-react + input 终端实现，增加多 Tab 管理，支持 vim/htop 等交互程序和 ⌘T/⌘W 快捷键。

**Architecture:** `useTerminalTabs` hook 维护多 tab 状态并直接调用 `electronAPI.terminal` IPC（完全替代现有 `useTerminal`）。每个 `TerminalInstance` 持有独立 xterm.js `Terminal` 实例，非活跃 tab 用 `display:none` 保持挂载。`TerminalTabBar` 是纯展示组件，所有操作通过 props 回调。

**Tech Stack:** `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, Electron `globalShortcut`, Node.js built-in test runner

**Spec:** `docs/superpowers/specs/2026-04-03-terminal-xterm-multitab-design.md`

---

## File Map

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/hooks/useTerminalTabs.ts` | **新建** | Tab 状态管理 + PTY 生命周期，替代 useTerminal |
| `src/components/terminal/TerminalTabBar.tsx` | **新建** | Tab 列表 UI（纯展示，props-driven） |
| `src/components/terminal/TerminalInstance.tsx` | **重写** | xterm.js 终端渲染（替换 ansi-to-react） |
| `src/components/terminal/TerminalDrawer.tsx` | **小改** | 插入 TabBar，更新高度 calc |
| `electron/preload.ts` | **小改** | 暴露 `terminal.onNewTab` IPC push 通道 |
| `electron/main.ts` | **小改** | import globalShortcut，注册 ⌘T |
| `src/__tests__/unit/terminal-tabs.test.ts` | **新建** | 单元测试：tab 状态辅助函数 |
| `package.json` | **改** | 新增三个 @xterm 依赖，移除 ansi-to-react |

---

## Chunk 1: 依赖安装与状态基础

### Task 1: 安装 xterm.js 依赖，移除 ansi-to-react

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装新依赖，移除旧依赖**

```bash
cd /Users/cairui/Code/CodePilot
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
npm uninstall ansi-to-react
```

- [ ] **Step 2: 验证安装**

```bash
node -e "require('@xterm/xterm'); require('@xterm/addon-fit'); require('@xterm/addon-web-links'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: replace ansi-to-react with @xterm/xterm + addons"
```

---

### Task 2: 创建 useTerminalTabs hook

这是整个功能的核心。Hook 直接调用 `electronAPI.terminal` IPC，维护 `tabs` 数组和 `activeTabId`。

**Files:**
- Create: `src/hooks/useTerminalTabs.ts`
- Create: `src/__tests__/unit/terminal-tabs.test.ts`

- [ ] **Step 1: 先写单元测试（纯逻辑部分）**

创建 `src/__tests__/unit/terminal-tabs.test.ts`：

```typescript
/**
 * Unit tests for terminal tab pure helpers.
 * Run: npx tsx --test src/__tests__/unit/terminal-tabs.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We'll test the exported pure helpers once the file is created.
// These tests validate: tab creation, tab removal, title update.

describe('terminal tab helpers', () => {
  it('buildNewTab creates tab with unique id and ptyId', async () => {
    const { buildNewTab } = await import('../../hooks/useTerminalTabs');
    const tab = buildNewTab('bash');
    assert.ok(tab.id.startsWith('tab-'), `id should start with tab-, got: ${tab.id}`);
    assert.ok(tab.ptyId.startsWith('pty-'), `ptyId should start with pty-, got: ${tab.ptyId}`);
    assert.equal(tab.title, 'bash');
  });

  it('buildNewTab generates unique ids on each call', async () => {
    const { buildNewTab } = await import('../../hooks/useTerminalTabs');
    const a = buildNewTab('bash');
    const b = buildNewTab('bash');
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.ptyId, b.ptyId);
  });

  it('removeTab removes the specified tab', async () => {
    const { buildNewTab, removeTab } = await import('../../hooks/useTerminalTabs');
    const t1 = buildNewTab('bash');
    const t2 = buildNewTab('bash');
    const result = removeTab([t1, t2], t1.id);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, t2.id);
  });

  it('updateTabTitle updates only the matching tab', async () => {
    const { buildNewTab, updateTabTitle } = await import('../../hooks/useTerminalTabs');
    const t1 = buildNewTab('bash');
    const t2 = buildNewTab('bash');
    const result = updateTabTitle([t1, t2], t1.id, 'vim');
    assert.equal(result.find(t => t.id === t1.id)!.title, 'vim');
    assert.equal(result.find(t => t.id === t2.id)!.title, 'bash');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx tsx --test src/__tests__/unit/terminal-tabs.test.ts
```

Expected: 失败（`useTerminalTabs` 尚未创建）

- [ ] **Step 3: 实现 useTerminalTabs hook**

创建 `src/hooks/useTerminalTabs.ts`：

```typescript
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
    id: `tab-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    ptyId: `pty-${ts}-${Math.random().toString(36).slice(2, 6)}`,
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
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isElectron] = useState(
    () => typeof window !== "undefined" && !!window.electronAPI?.terminal
  );

  const onDataCallbacksRef = useRef<Map<string, (data: string) => void>>(new Map());

  // Subscribe to PTY data/exit once on mount
  useEffect(() => {
    const api = window.electronAPI?.terminal;
    if (!api) return;

    const unsubData = api.onData((payload) => {
      onDataCallbacksRef.current.get(payload.id)?.(payload.data);
    });

    const unsubExit = api.onExit((payload) => {
      // payload.id is the PTY id (ptyId), not the tab's own id
      setTabs(prev => {
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

  // Listen for ⌘T IPC push from main process
  useEffect(() => {
    const api = window.electronAPI?.terminal;
    if (!api?.onNewTab) return;
    const unsub = api.onNewTab(() => createTab());
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDirectory]);

  // Create initial tab when drawer opens
  useEffect(() => {
    if (terminalOpen && isElectron && tabs.length === 0) {
      createTab();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalOpen, isElectron]);

  const createTab = useCallback(async () => {
    const api = window.electronAPI?.terminal;
    if (!api || !workingDirectory) return;

    if (!terminalOpen) setTerminalOpen(true);

    const shell = detectShellName();
    const newTab = buildNewTab(shell);

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);

    await api.create({ id: newTab.ptyId, cwd: workingDirectory, cols: 120, rows: 30 });
    return newTab;
  }, [workingDirectory, terminalOpen, setTerminalOpen]);

  const closeTab = useCallback(async (tabId: string) => {
    const api = window.electronAPI?.terminal;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (api) {
      try { await api.kill(tab.ptyId); } catch { /* ignore */ }
    }

    setTabs(prev => {
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
  }, [tabs, setTerminalOpen]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const renameTab = useCallback((tabId: string, title: string) => {
    setTabs(prev => updateTabTitle(prev, tabId, title));
  }, []);

  const setOnData = useCallback((ptyId: string, cb: (data: string) => void) => {
    onDataCallbacksRef.current.set(ptyId, cb);
    return () => { onDataCallbacksRef.current.delete(ptyId); };
  }, []);

  // Clean up all PTY processes on unmount
  useEffect(() => {
    return () => {
      const api = window.electronAPI?.terminal;
      if (!api) return;
      tabs.forEach(t => api.kill(t.ptyId).catch(() => {}));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx tsx --test src/__tests__/unit/terminal-tabs.test.ts
```

Expected: 4 tests pass

- [ ] **Step 5: typecheck**

```bash
npm run typecheck
```

Expected: 无 `useTerminalTabs.ts` 相关错误（可能有其他未修改文件的已有错误，忽略）

- [ ] **Step 6: 提交**

```bash
git add src/hooks/useTerminalTabs.ts src/__tests__/unit/terminal-tabs.test.ts
git commit -m "feat: add useTerminalTabs hook with multi-tab PTY management"
```

---

## Chunk 2: UI 组件

### Task 3: 创建 TerminalTabBar 组件

纯展示组件，所有逻辑通过 props 传入。使用语义 token 颜色。

**Files:**
- Create: `src/components/terminal/TerminalTabBar.tsx`

- [ ] **Step 1: 实现 TerminalTabBar**

创建 `src/components/terminal/TerminalTabBar.tsx`：

```typescript
"use client";

import { useRef, useState } from "react";
import { Plus, X } from "@/components/ui/icon";
import type { TerminalTab } from "@/hooks/useTerminalTabs";

interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  onSwitch,
  onCreate,
  onClose,
  onRename,
}: TerminalTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = (tab: TerminalTab) => {
    setEditingId(tab.id);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = (tab: TerminalTab) => {
    const val = inputRef.current?.value.trim();
    if (val) onRename(tab.id, val);
    setEditingId(null);
  };

  return (
    <div className="flex items-center bg-muted/30 border-b border-border/40 h-[30px] overflow-x-auto shrink-0">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={[
              "flex items-center gap-1.5 px-3 h-full border-r border-border/30 cursor-pointer shrink-0 select-none group",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            ].join(" ")}
            onClick={() => onSwitch(tab.id)}
          >
            {/* Status dot */}
            <span
              className={[
                "w-1.5 h-1.5 rounded-full shrink-0",
                isActive ? "bg-status-success" : "bg-muted-foreground/40",
              ].join(" ")}
            />

            {/* Tab title — editable on double-click */}
            {editingId === tab.id ? (
              <input
                ref={inputRef}
                defaultValue={tab.title}
                className="bg-transparent outline-none text-[11px] w-16 text-foreground"
                onBlur={() => commitRename(tab)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename(tab);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span
                className="text-[11px] max-w-[80px] truncate"
                onDoubleClick={() => handleDoubleClick(tab)}
              >
                {tab.title}
              </span>
            )}

            {/* Close button */}
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground ml-0.5 shrink-0"
              onClick={e => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X size={10} />
            </button>
          </div>
        );
      })}

      {/* New tab button */}
      <button
        className="px-2 h-full text-muted-foreground hover:text-foreground shrink-0"
        onClick={onCreate}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: 无 `TerminalTabBar.tsx` 相关错误

- [ ] **Step 3: 检查颜色规范**

```bash
npm run lint:colors
```

Expected: 通过（无原始 Tailwind 颜色）

- [ ] **Step 4: 提交**

```bash
git add src/components/terminal/TerminalTabBar.tsx
git commit -m "feat: add TerminalTabBar component with rename and close support"
```

---

### Task 4: 重写 TerminalInstance（xterm.js）

核心变更：用 xterm.js `Terminal` 实例替换 `ansi-to-react` + `<input>`。包含 FitAddon、WebLinksAddon、⌘W 拦截、OSC 2 标题回调。

**Files:**
- Modify: `src/components/terminal/TerminalInstance.tsx`

- [ ] **Step 1: 重写 TerminalInstance**

替换 `src/components/terminal/TerminalInstance.tsx` 全部内容：

```typescript
"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { TerminalTab } from "@/hooks/useTerminalTabs";

interface TerminalInstanceProps {
  tab: TerminalTab;
  isActive: boolean;
  workingDirectory: string;
  onTitleChange: (id: string, title: string) => void;
  onCloseTab: (id: string) => void;
  write: (ptyId: string, data: string) => void;
  resize: (ptyId: string, cols: number, rows: number) => void;
  create: (ptyId: string, cwd: string, cols: number, rows: number) => Promise<void>;
  setOnData: (ptyId: string, cb: (data: string) => void) => () => void;
}

const XTERM_THEME = {
  background: "#1a1a1a",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#4ec9b0",
  yellow: "#dcdcaa",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#4ec9b0",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f44747",
  brightGreen: "#4ec9b0",
  brightYellow: "#dcdcaa",
  brightBlue: "#569cd6",
  brightMagenta: "#c586c0",
  brightCyan: "#9cdcfe",
  brightWhite: "#ffffff",
};

export function TerminalInstance({
  tab,
  isActive,
  workingDirectory,
  onTitleChange,
  onCloseTab,
  write,
  resize,
  create,
  setOnData,
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  // Initialize xterm.js once
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // PTY input → xterm
    const unsubData = setOnData(tab.ptyId, (data) => term.write(data));

    // xterm input → PTY
    term.onData((data) => write(tab.ptyId, data));

    // OSC 2: update tab title from shell
    term.parser.registerOscHandler(2, (data) => {
      if (data) onTitleChange(tab.id, data);
      return true;
    });

    // ⌘W: intercept before xterm processes it
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.metaKey && e.key === "w") {
        onCloseTab(tab.id);
        return false; // prevent xterm default
      }
      return true;
    });

    // Start PTY
    const { cols, rows } = fitAddon.proposeDimensions() ?? { cols: 120, rows: 30 };
    create(tab.ptyId, workingDirectory, cols ?? 120, rows ?? 30);

    return () => {
      unsubData();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit when tab becomes active (container was display:none, dimensions were 0)
  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !termRef.current) return;

    // rAF ensures the container is visible before measuring
    const raf = requestAnimationFrame(() => {
      const fitAddon = fitAddonRef.current;
      const term = termRef.current;
      if (!fitAddon || !term) return;
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) resize(tab.ptyId, dims.cols, dims.rows);
    });

    return () => cancelAnimationFrame(raf);
  }, [isActive, tab.ptyId, resize]);

  // Fit on container resize (Drawer height drag)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isActive) return;

    const observer = new ResizeObserver(() => {
      const fitAddon = fitAddonRef.current;
      const term = termRef.current;
      if (!fitAddon || !term) return;
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) resize(tab.ptyId, dims.cols, dims.rows);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isActive, tab.ptyId, resize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: isActive ? "block" : "none" }}
    />
  );
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: 无 `TerminalInstance.tsx` 相关错误

- [ ] **Step 3: 提交**

```bash
git add src/components/terminal/TerminalInstance.tsx
git commit -m "feat: rewrite TerminalInstance with xterm.js (FitAddon + WebLinksAddon + OSC2)"
```

---

## Chunk 3: 连线与 Electron

### Task 5: 更新 TerminalDrawer

插入 `TerminalTabBar`，换用 `useTerminalTabs`，更新高度 calc。

**Files:**
- Modify: `src/components/terminal/TerminalDrawer.tsx`

- [ ] **Step 1: 重写 TerminalDrawer**

替换 `src/components/terminal/TerminalDrawer.tsx` 全部内容：

```typescript
"use client";

import { useState, useCallback } from "react";
import { X, ArrowsInLineVertical } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { useTranslation } from "@/hooks/useTranslation";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalInstance } from "./TerminalInstance";

const DEFAULT_HEIGHT = 250;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

// Layout heights:
//   resize handle  = h-1   (0.25rem  = 4px)
//   header row     = h-8   (2rem     = 32px)
//   tab bar        = 30px  (1.875rem)
// content = calc(100% - 30px - 32px - 4px) ≈ calc(100% - 66px)
const CONTENT_HEIGHT = "calc(100% - 66px)";

export function TerminalDrawer() {
  const { terminalOpen, setTerminalOpen, workingDirectory } = usePanel();
  const { t } = useTranslation();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  const {
    isElectron,
    tabs,
    activeTabId,
    createTab,
    closeTab,
    switchTab,
    renameTab,
    setOnData,
  } = useTerminalTabs();

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [height]);

  const api = typeof window !== "undefined" ? window.electronAPI?.terminal : undefined;

  if (!terminalOpen) return null;

  return (
    <div className="shrink-0 border-t border-border/40 bg-background" style={{ height }}>
      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("terminal.title")}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setHeight(DEFAULT_HEIGHT)}>
            <ArrowsInLineVertical size={12} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={12} />
            <span className="sr-only">{t("terminal.close")}</span>
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      {isElectron && (
        <TerminalTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitch={switchTab}
          onCreate={createTab}
          onClose={closeTab}
          onRename={renameTab}
        />
      )}

      {/* Terminal instances */}
      <div style={{ height: CONTENT_HEIGHT, overflow: "hidden" }}>
        {isElectron && api ? (
          tabs.map(tab => (
            <TerminalInstance
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              workingDirectory={workingDirectory ?? ""}
              onTitleChange={renameTab}
              onCloseTab={closeTab}
              write={(ptyId, data) => api.write(ptyId, data)}
              resize={(ptyId, cols, rows) => api.resize(ptyId, cols, rows)}
              create={(ptyId, cwd, cols, rows) => api.create({ id: ptyId, cwd, cols, rows })}
              setOnData={setOnData}
            />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t("terminal.notAvailable")}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: 通过

- [ ] **Step 3: lint:colors**

```bash
npm run lint:colors
```

Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/components/terminal/TerminalDrawer.tsx
git commit -m "feat: wire TerminalDrawer to useTerminalTabs and TerminalTabBar"
```

---

### Task 6: preload.ts — 暴露 terminal:new-tab IPC 通道

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

- [ ] **Step 1: 确认类型声明文件位置**

```bash
grep -rn "onData\|onExit" src/types/ --include="*.d.ts" --include="*.ts" | head -10
```

Expected: 找到 `src/types/electron.d.ts` 中的 `ElectronTerminalAPI` interface

- [ ] **Step 2: 在 src/types/electron.d.ts 的 ElectronTerminalAPI 中添加 onNewTab**

在 `onExit` 声明之后添加：

```typescript
onNewTab: (callback: () => void) => () => void;
```

- [ ] **Step 3: 在 electron/preload.ts 的 terminal 对象末尾（onExit 之后）添加 onNewTab**

```typescript
    onNewTab: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('terminal:new-tab', listener);
      return () => { ipcRenderer.removeListener('terminal:new-tab', listener); };
    },
```

- [ ] **Step 4: typecheck**

```bash
npm run typecheck
```

Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add electron/preload.ts src/types/electron.d.ts
git commit -m "feat: expose terminal:new-tab IPC push channel in preload"
```

---

### Task 7: main.ts — 注册 ⌘T 全局快捷键

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 在 import 行添加 globalShortcut**

在 `electron/main.ts` 顶部，修改第一行 import：

```typescript
import { app, BrowserWindow, Notification, nativeImage, dialog, session, utilityProcess, ipcMain, shell, Tray, Menu, globalShortcut } from 'electron';
```

- [ ] **Step 2: 在 createWindow() 函数末尾（mainWindow 已创建后）添加快捷键注册**

在 `electron/main.ts` 中，找到 `createWindow` 函数内 `mainWindow` 创建完毕后的位置（`mainWindow = new BrowserWindow(...)` 之后），添加：

```typescript
  // ⌘T: open terminal and create new tab (register/unregister on focus/blur)
  mainWindow.on('focus', () => {
    globalShortcut.register('CommandOrControl+T', () => {
      mainWindow?.webContents.send('terminal:new-tab');
    });
  });

  mainWindow.on('blur', () => {
    globalShortcut.unregister('CommandOrControl+T');
  });
```

注意：必须在 `mainWindow` 实例上调用 `.on('focus'/.on('blur')`，不能用 `app.on('browser-window-focus')` — 后者不是有效的 Electron app 事件。

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add electron/main.ts
git commit -m "feat: register Cmd+T global shortcut for new terminal tab"
```

---

## Chunk 4: 验证

### Task 8: 全量测试 + CDP 验证

- [ ] **Step 1: 运行全量单元测试**

```bash
npm run test
```

Expected: typecheck 通过 + 所有单元测试通过（包括新增的 `terminal-tabs.test.ts`）

- [ ] **Step 2: 启动开发环境**

```bash
npm run electron:dev
```

等待应用启动完成。

- [ ] **Step 3: CDP 截图确认 Tab 栏渲染**

使用 chrome-devtools MCP：
1. 打开终端 Drawer
2. 截图确认 Tab 栏出现在 Header 下方
3. 确认活跃 Tab 有绿色状态点，文字颜色符合语义 token
4. 检查 console 无报错

- [ ] **Step 4: 验证交互程序**

在终端中运行以下命令验证 xterm.js 功能：
```
vim --version   # 打开后能正常显示、:q 退出
htop            # 或 top，交互界面正常
ls -la | less   # less 翻页正常
echo "test" | grep test  # 管道正常
```

- [ ] **Step 5: 验证箭头键历史、Tab 补全和 Ctrl+C**

1. 输入一条命令后按回车
2. 按 ↑ 键确认历史可用
3. 输入 `git ` 后按 Tab 确认补全
4. 输入 `sleep 10` 后按 Ctrl+C，确认中断信号生效（prompt 重现，进程结束）

- [ ] **Step 6: 验证多 Tab 功能**

1. 点击 `+` 按钮新建第二个 Tab
2. 在两个 Tab 各运行不同命令
3. 切换 Tab 确认内容保留（含滚动位置）
4. 关闭 Tab 1，Tab 2 内容不丢失
5. 关闭最后一个 Tab，确认 Drawer 收起

- [ ] **Step 7: 验证 ⌘T 快捷键**

按 ⌘T，确认新建 Tab 并 focus。

- [ ] **Step 8: 验证 resize 自适应**

拖拽 Drawer 高度，确认 xterm.js 自动适配列宽（不出现乱行）。

- [ ] **Step 9: 最终提交**

```bash
git add -A
npm run test
git commit -m "feat: terminal xterm.js multi-tab — verification complete"
```
