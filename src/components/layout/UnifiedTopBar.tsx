"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  GitBranch,
  TreeStructure,
  PencilSimple,
  DotOutline,
  ChartBar,
  Terminal,
  Brain,
  Check,
  Lock,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { GitBranch as GitBranchType } from "@/types";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { useClientPlatform } from '@/hooks/useClientPlatform';
import { showToast } from '@/hooks/useToast';
import { ResourceMonitor } from './ResourceMonitor';
import { RemoteConnectionStatus } from '@/components/remote/ConnectionStatus';
import { type Species } from '@/lib/buddy';
import { BuddyAvatar } from '@/components/ui/buddy-avatar';

export function UnifiedTopBar() {
  const {
    sessionTitle,
    setSessionTitle,
    sessionId,
    workingDirectory,
    fileTreeOpen,
    setFileTreeOpen,
    gitPanelOpen,
    setGitPanelOpen,
    terminalOpen,
    setTerminalOpen,
    dashboardPanelOpen,
    setDashboardPanelOpen,
    assistantPanelOpen,
    setAssistantPanelOpen,
    isAssistantWorkspace,
    currentBranch,
    gitDirtyCount,
  } = usePanel();
  const { t } = useTranslation();
  const { isWindows } = useClientPlatform();
  const [assistantName, setAssistantName] = useState('');
  const [buddyEmoji, setBuddyEmoji] = useState('');
  const [buddySpecies, setBuddySpecies] = useState('');

  useEffect(() => {
    if (!isAssistantWorkspace) return;
    let cancelled = false;
    fetch('/api/workspace/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) { setAssistantName(data?.name || ''); setBuddyEmoji(data?.buddy?.emoji || ''); setBuddySpecies(data?.buddy?.species || ''); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAssistantWorkspace]);
  const pathname = usePathname();

  // Only show Git/terminal/panel controls on chat detail routes (/chat/[id]),
  // not on the empty /chat page where panels aren't mounted.
  const isChatRoute = pathname.startsWith("/chat/") && pathname !== "/chat";

  // --- Branch switcher popover ---
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchSortByDate, setBranchSortByDate] = useState(true);
  const isDirty = gitDirtyCount > 0;

  useEffect(() => {
    if (!branchPopoverOpen || !workingDirectory) return;
    setBranchesLoading(true);
    setCheckoutError(null);
    fetch(`/api/git/branches?cwd=${encodeURIComponent(workingDirectory)}`)
      .then(res => res.json())
      .then(data => setBranches(data.branches || []))
      .catch(() => {})
      .finally(() => setBranchesLoading(false));
  }, [branchPopoverOpen, workingDirectory]);

  const handleBranchCheckout = useCallback(async (branch: string) => {
    if (isDirty || branch === currentBranch) return;
    setCheckingOut(branch);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory, branch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Checkout failed' }));
        throw new Error(data.error || 'Checkout failed');
      }
      setBranchPopoverOpen(false);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckingOut(null);
    }
  }, [isDirty, currentBranch, workingDirectory]);

  // --- Title editing ---
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleStartEditTitle = useCallback(() => {
    setEditTitle(sessionTitle || t('chat.newConversation'));
    setIsEditingTitle(true);
  }, [sessionTitle, t]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setIsEditingTitle(false);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setSessionTitle(trimmed);
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: sessionId, title: trimmed } }));
      }
    } catch {
      showToast({ type: 'error', message: t('error.titleSaveFailed') });
    }
    setIsEditingTitle(false);
  }, [editTitle, sessionId, setSessionTitle, t]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  }, [handleSaveTitle]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Extract project name from working directory
  const projectName = workingDirectory ? workingDirectory.split(/[\\/]/).filter(Boolean).pop() || '' : '';

  // On non-chat routes, render only a thin drag region (no visible bar)
  if (!isChatRoute) {
    // Thin drag region for macOS window dragging — just enough for traffic light area
    return (
      <div
        className="h-3 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
    );
  }

  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-2 bg-background px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: chat title + project folder */}
        <div
          className="flex items-center gap-1.5 min-w-0 shrink"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && sessionTitle && (
            isEditingTitle ? (
              <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <Input
                  ref={titleInputRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleSaveTitle}
                  className="h-7 text-sm max-w-[200px]"
                />
              </div>
            ) : (
              <div className="flex items-center gap-1 cursor-default max-w-[200px]">
                <h2 className="text-sm font-medium text-foreground/80 truncate">
                  {sessionTitle}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleStartEditTitle}
                  className="shrink-0 h-auto w-auto p-0.5"
                >
                  <PencilSimple size={12} className="text-muted-foreground" />
                </Button>
              </div>
            )
          )}

          {isChatRoute && projectName && sessionTitle && (
            <span className="text-xs text-muted-foreground/60 shrink-0">/</span>
          )}

          {isChatRoute && projectName && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground/60 shrink-0 hover:text-foreground transition-colors h-auto p-0"
                  onClick={() => {
                    if (workingDirectory) {
                      if (window.electronAPI?.shell?.openPath) {
                        window.electronAPI.shell.openPath(workingDirectory);
                      } else {
                        fetch('/api/files/open', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ path: workingDirectory }),
                        }).catch(() => {});
                      }
                    }
                  }}
                >
                  {projectName}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs break-all">{workingDirectory}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: action buttons */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isChatRoute && (
            <>
              <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        variant={gitPanelOpen && !branchPopoverOpen ? "secondary" : "ghost"}
                        size="sm"
                        className={`h-7 gap-1 px-1.5 ${gitPanelOpen && !branchPopoverOpen ? "" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <GitBranch size={16} />
                        {currentBranch && (
                          <span className="text-xs max-w-[100px] truncate">{currentBranch}</span>
                        )}
                        {gitDirtyCount > 0 && (
                          <span className="flex items-center gap-0.5 text-[11px] text-amber-500">
                            <DotOutline size={10} weight="fill" />
                            {gitDirtyCount}
                          </span>
                        )}
                        <span className="sr-only">{t('topBar.git')}</span>
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('topBar.switchBranch')}</TooltipContent>
                </Tooltip>
                <PopoverContent side="bottom" align="end" className="w-64 p-0">
                  <div className="px-2 py-2 border-b flex items-center gap-1">
                    <input
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      placeholder={t('topBar.searchBranch')}
                      value={branchSearch}
                      onChange={e => setBranchSearch(e.target.value)}
                      autoFocus
                    />
                    <button
                      title={branchSortByDate ? t('topBar.sortByDate') : t('topBar.sortByName')}
                      className="text-[10px] text-muted-foreground hover:text-foreground px-1 shrink-0"
                      onClick={() => setBranchSortByDate(v => !v)}
                    >
                      {branchSortByDate ? t('topBar.sortByDate') : t('topBar.sortByName')}
                    </button>
                  </div>
                  {checkoutError && (
                    <p className="px-3 py-1.5 text-[11px] text-destructive border-b">{checkoutError}</p>
                  )}
                  <div className="max-h-[240px] overflow-y-auto">
                    {branchesLoading ? (
                      <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('git.loading')}</div>
                    ) : (() => {
                      const localBranches = branches
                        .filter(b => !b.isRemote)
                        .filter(b => !branchSearch || b.name.toLowerCase().includes(branchSearch.toLowerCase()))
                        .sort((a, b) => {
                          if (branchSortByDate) {
                            const da = a.lastCommitDate ? new Date(a.lastCommitDate).getTime() : 0;
                            const db = b.lastCommitDate ? new Date(b.lastCommitDate).getTime() : 0;
                            return db - da;
                          }
                          return a.name.localeCompare(b.name);
                        });
                      if (localBranches.length === 0) {
                        return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t('git.noBranch')}</div>;
                      }
                      return localBranches.map(branch => {
                        const isCurrent = branch.name === currentBranch;
                        const isOccupied = !!branch.worktreePath && !isCurrent;
                        const disabled = isDirty || isOccupied || isCurrent;
                        return (
                          <button
                            key={branch.name}
                            title={branch.name}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-left hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={disabled || checkingOut !== null}
                            onClick={() => handleBranchCheckout(branch.name)}
                          >
                            {isCurrent && <Check size={12} className="text-status-success shrink-0" />}
                            {isOccupied && <Lock size={12} className="text-muted-foreground shrink-0" />}
                            {!isCurrent && !isOccupied && <span className="w-3 shrink-0" />}
                            <span className="truncate flex-1">{branch.name}</span>
                            {checkingOut === branch.name && (
                              <span className="text-[10px] text-muted-foreground shrink-0">{t('git.checkingOut')}</span>
                            )}
                            {isOccupied && (
                              <span className="text-[10px] text-muted-foreground shrink-0">{t('git.worktreeOccupied')}</span>
                            )}
                            {isDirty && !isCurrent && !isOccupied && (
                              <span className="text-[10px] text-amber-500 shrink-0">{t('git.dirtyWorkTree')}</span>
                            )}
                          </button>
                        );
                      });
                    })()}
                  </div>
                  <div className="border-t px-3 py-2">
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground w-full text-left"
                      onClick={() => { setBranchPopoverOpen(false); setGitPanelOpen(true); }}
                    >
                      {t('topBar.git')} →
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={fileTreeOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={fileTreeOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setFileTreeOpen(!fileTreeOpen)}
                  >
                    <TreeStructure size={16} />
                    <span className="sr-only">{t('topBar.fileTree')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.fileTree')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={terminalOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={terminalOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setTerminalOpen(!terminalOpen)}
                  >
                    <Terminal size={16} />
                    <span className="sr-only">{t('topBar.terminal')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('topBar.terminal')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={dashboardPanelOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    className={dashboardPanelOpen ? "" : "text-muted-foreground hover:text-foreground"}
                    onClick={() => setDashboardPanelOpen(!dashboardPanelOpen)}
                  >
                    {isAssistantWorkspace
                      ? <BuddyAvatar species={buddySpecies as Species | undefined} size={16} className="rounded-sm" />
                      : <ChartBar size={16} />}
                    <span className="sr-only">{t('topBar.dashboard')}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isAssistantWorkspace ? 'Assistant' : t('topBar.dashboard')}
                </TooltipContent>
              </Tooltip>

              <RemoteConnectionStatus />
              <ResourceMonitor />
            </>
          )}
          {isWindows && <div style={{ width: 138 }} className="shrink-0" />}
        </div>
      </div>
    </>
  );
}
