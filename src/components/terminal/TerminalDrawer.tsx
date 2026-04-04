"use client";

import { useState, useCallback, useRef } from "react";
import { X, ArrowsInLineVertical } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { useTranslation } from "@/hooks/useTranslation";
import { TerminalInstance } from "./TerminalInstance";
import { TerminalTabBar } from "./TerminalTabBar";

const DEFAULT_HEIGHT = 250;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

export function TerminalDrawer() {
  const { terminalOpen, setTerminalOpen } = usePanel();
  const { isElectron, tabs, activeTabId, createTab, closeTab, switchTab, renameTab, setOnData } = useTerminalTabs();
  const { t } = useTranslation();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const heightRef = useRef(height);
  heightRef.current = height;

  // Stable callbacks — avoids creating new function objects on every render,
  // which would force all TerminalInstance children to re-render unnecessarily.
  const writeToTerminal = useCallback((ptyId: string, data: string) => {
    window.electronAPI!.terminal!.write(ptyId, data);
  }, []);

  const resizeTerminal = useCallback((ptyId: string, cols: number, rows: number) => {
    window.electronAPI!.terminal!.resize(ptyId, cols, rows);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = heightRef.current;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  if (!terminalOpen) return null;

  return (
    <div className="shrink-0 border-t border-border/40 bg-background flex flex-col" style={{ height }}>
      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors shrink-0"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border/40 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('terminal.title')}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setHeight(DEFAULT_HEIGHT)}>
            <ArrowsInLineVertical size={12} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={12} />
            <span className="sr-only">{t('terminal.close')}</span>
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={switchTab}
        onCreate={createTab}
        onClose={closeTab}
        onRename={renameTab}
      />

      {/* Terminal body — flex-1 fills remaining height, no magic px constant */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isElectron ? (
          tabs.map(tab => (
            <TerminalInstance
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onTitleChange={renameTab}
              onCloseTab={closeTab}
              write={writeToTerminal}
              resize={resizeTerminal}
              setOnData={setOnData}
            />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t('terminal.notAvailable')}
          </div>
        )}
      </div>
    </div>
  );
}
