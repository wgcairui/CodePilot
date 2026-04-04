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

  const commitRename = (tab: TerminalTab, value: string) => {
    const val = value.trim();
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
                onBlur={e => commitRename(tab, e.currentTarget.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename(tab, e.currentTarget.value);
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
              aria-label={`Close ${tab.title}`}
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
        aria-label="New tab"
        className="px-2 h-full text-muted-foreground hover:text-foreground shrink-0"
        onClick={onCreate}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
