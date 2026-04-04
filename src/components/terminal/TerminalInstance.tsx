"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { TerminalTab } from "@/hooks/useTerminalTabs";

interface TerminalInstanceProps {
  tab: TerminalTab;
  isActive: boolean;
  onTitleChange: (id: string, title: string) => void;
  onCloseTab: (id: string) => void;
  write: (ptyId: string, data: string) => void;
  resize: (ptyId: string, cols: number, rows: number) => void;
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
  onTitleChange,
  onCloseTab,
  write,
  resize,
  setOnData,
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);

  // Calls fitAddon.fit() then syncs PTY dimensions — shared by activation and ResizeObserver.
  // Must only be called when tab is active (display:block); fit() reads offsetWidth/Height.
  const fitAndSync = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon) return;
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) resize(tab.ptyId, dims.cols, dims.rows);
  }, [tab.ptyId, resize]);

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
    // Do NOT call fitAddon.fit() here — if this tab is not yet active (display:none),
    // offsetWidth/Height are 0 and fit() would resize the PTY to 0 cols/rows.
    // The activation effect below handles the first proper fit when isActive becomes true.

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const unsubData = setOnData(tab.ptyId, (data) => term.write(data));
    term.onData((data) => write(tab.ptyId, data));

    // OSC 2: shell updates tab title (e.g. when vim opens a file)
    term.parser.registerOscHandler(2, (data) => {
      if (data) onTitleChange(tab.id, data);
      return true;
    });

    // ⌘W: intercept before xterm processes it — only way to reliably catch keys
    // while the xterm canvas holds focus (div onKeyDown doesn't fire in that state)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.metaKey && e.key === "w") {
        onCloseTab(tab.id);
        return false;
      }
      return true;
    });

    return () => {
      unsubData();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit when tab becomes active (was hidden via display:none, dims were 0)
  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !termRef.current) return;
    const raf = requestAnimationFrame(() => fitAndSync());
    return () => cancelAnimationFrame(raf);
  }, [isActive, fitAndSync]);

  // Re-fit when container is resized (Drawer height drag) — RAF-throttled to avoid IPC flood
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isActive) return;
    const observer = new ResizeObserver(() => {
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        fitAndSync();
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [isActive, fitAndSync]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: isActive ? "block" : "none" }}
    />
  );
}
