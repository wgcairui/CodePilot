"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowClockwise, CaretUp, CaretDown, CaretRight, ChartBar, Trash, DownloadSimple, ArrowSquareOut } from "@/components/ui/icon";
import { showToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { WidgetRenderer } from "@/components/chat/WidgetRenderer";
import type { DashboardConfig, DashboardWidget } from "@/types/dashboard";

function formatWidgetTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (isToday) return hm;
  if (isThisYear) return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

interface SessionGroup {
  sessionId: string;
  sessionTitle: string;
  widgets: DashboardWidget[];
  newestCreatedAt: string;
}

const DASHBOARD_MIN_WIDTH = 320;
const DASHBOARD_MAX_WIDTH = 800;
const DASHBOARD_DEFAULT_WIDTH = 640;

export function DashboardPanel() {
  const { setDashboardPanelOpen, workingDirectory } = usePanel();
  const { t } = useTranslation();
  const router = useRouter();
  const [width, setWidth] = useState(DASHBOARD_DEFAULT_WIDTH);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sessionTitles, setSessionTitles] = useState<Map<string, string>>(new Map());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const initialLoadDone = useRef(false);
  const groupsInitializedRef = useRef(false);

  const handleResize = useCallback((delta: number) => {
    setWidth((w) => Math.min(DASHBOARD_MAX_WIDTH, Math.max(DASHBOARD_MIN_WIDTH, w - delta)));
  }, []);

  // Load dashboard config
  const loadDashboard = useCallback(async () => {
    if (!workingDirectory) return;
    try {
      const res = await fetch(`/api/dashboard?dir=${encodeURIComponent(workingDirectory)}`);
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setAutoRefresh(data.settings?.autoRefreshOnOpen ?? false);
      }
    } catch (e) {
      console.error('[DashboardPanel] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, [workingDirectory]);

  // Load on mount
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Fetch session titles for grouped header display
  useEffect(() => {
    if (!config) return;
    const uniqueSessionIds = [
      ...new Set(
        config.widgets
          .map(w => w.pinnedFrom?.sessionId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (uniqueSessionIds.length === 0) return;
    Promise.all(
      uniqueSessionIds.map(async (sessionId) => {
        try {
          const res = await fetch(`/api/chat/sessions/${sessionId}`);
          if (res.ok) {
            const data = await res.json();
            return [sessionId, data.session?.title || sessionId] as [string, string];
          }
        } catch { /* ignore */ }
        return [sessionId, sessionId] as [string, string];
      }),
    ).then(entries => setSessionTitles(new Map(entries)));
  }, [config]);

  // Auto-refresh on open
  useEffect(() => {
    if (!initialLoadDone.current && config && autoRefresh && config.widgets.length > 0) {
      initialLoadDone.current = true;
      handleRefreshAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, autoRefresh]);

  // Poll for changes during streaming (MCP tools execute during streaming).
  // Also do a one-shot re-fetch 1s after streaming ends to catch the final state.
  const { activeStreamingSessions } = usePanel();
  const isAnyStreaming = activeStreamingSessions.size > 0;
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (!workingDirectory) return;
    if (isAnyStreaming) {
      wasStreamingRef.current = true;
      const knownCount = config?.widgets.length ?? 0;
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/dashboard?dir=${encodeURIComponent(workingDirectory)}`);
          if (res.ok) {
            const data = await res.json();
            if ((data.widgets?.length ?? 0) !== knownCount) {
              setConfig(data);
            }
          }
        } catch { /* ignore */ }
      }, 3000);
      return () => clearInterval(interval);
    } else if (wasStreamingRef.current) {
      // Streaming just ended — do a final fetch to catch any last-moment changes
      wasStreamingRef.current = false;
      loadDashboard();
    }
  }, [workingDirectory, isAnyStreaming, config?.widgets.length, loadDashboard]);

  // Cross-widget communication relay: scoped to dashboard panel only.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const { topic, data, sourceIframe } = (e as CustomEvent).detail || {};
      if (!panelRef.current) return;
      // Ignore events from iframes outside the dashboard panel
      if (sourceIframe && !panelRef.current.contains(sourceIframe)) return;
      const iframes = panelRef.current.querySelectorAll('iframe[title]');
      iframes.forEach(iframe => {
        if (iframe !== sourceIframe && (iframe as HTMLIFrameElement).contentWindow) {
          (iframe as HTMLIFrameElement).contentWindow!.postMessage(
            { type: 'widget:crossFilter', payload: { topic, data } },
            '*',
          );
        }
      });
    };
    window.addEventListener('widget-cross-publish', handler);
    return () => window.removeEventListener('widget-cross-publish', handler);
  }, []);

  const handleRefreshAll = useCallback(async () => {
    if (!workingDirectory || refreshingAll) return;
    setRefreshingAll(true);
    try {
      const res = await fetch('/api/dashboard/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch (e) {
      console.error('[DashboardPanel] Refresh all failed:', e);
    } finally {
      setRefreshingAll(false);
    }
  }, [workingDirectory, refreshingAll]);

  const handleRefreshWidget = useCallback(async (widgetId: string) => {
    if (!workingDirectory || refreshingIds.has(widgetId)) return;
    setRefreshingIds(prev => new Set(prev).add(widgetId));
    try {
      const res = await fetch('/api/dashboard/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory, widgetId }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch (e) {
      console.error('[DashboardPanel] Refresh widget failed:', e);
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(widgetId);
        return next;
      });
    }
  }, [workingDirectory, refreshingIds]);

  const handleDeleteWidget = useCallback(async (widgetId: string) => {
    if (!workingDirectory) return;
    try {
      const res = await fetch(
        `/api/dashboard?dir=${encodeURIComponent(workingDirectory)}&widgetId=${encodeURIComponent(widgetId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        // Notify chat widgets that a pin was removed
        // No need to notify chat Pin buttons — they are stateless triggers
      }
    } catch (e) {
      console.error('[DashboardPanel] Delete widget failed:', e);
    }
  }, [workingDirectory]);

  const handleMoveWidget = useCallback(async (widgetId: string, direction: 'up' | 'down' | 'top') => {
    if (!workingDirectory || !config) return;
    // Optimistic local update — avoids React DOM reorder which destroys iframes
    const widgets = [...config.widgets];
    const idx = widgets.findIndex(w => w.id === widgetId);
    if (idx === -1) return;
    if (direction === 'top' && idx > 0) {
      const [w] = widgets.splice(idx, 1);
      widgets.unshift(w);
    } else if (direction === 'up' && idx > 0) {
      [widgets[idx - 1], widgets[idx]] = [widgets[idx], widgets[idx - 1]];
    } else if (direction === 'down' && idx < widgets.length - 1) {
      [widgets[idx], widgets[idx + 1]] = [widgets[idx + 1], widgets[idx]];
    } else {
      return; // no change
    }
    setConfig({ ...config, widgets });
    // Persist absolute order (race-free — last write wins with correct final state)
    fetch('/api/dashboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDirectory, widgetOrder: widgets.map(w => w.id) }),
    }).catch(e => console.error('[DashboardPanel] Move widget failed:', e));
  }, [workingDirectory, config]);

  const handleToggleAutoRefresh = useCallback(async () => {
    if (!workingDirectory) return;
    const newValue = !autoRefresh;
    setAutoRefresh(newValue);
    try {
      await fetch('/api/dashboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory, settings: { autoRefreshOnOpen: newValue } }),
      });
    } catch (e) {
      console.error('[DashboardPanel] Toggle auto-refresh failed:', e);
      setAutoRefresh(!newValue); // revert on failure
    }
  }, [workingDirectory, autoRefresh]);

  const widgets = config?.widgets ?? [];

  // Group widgets by session, sorted newest group first
  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const groupMap = new Map<string, DashboardWidget[]>();
    for (const widget of widgets) {
      const key = widget.pinnedFrom?.sessionId ?? '__uncategorized__';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(widget);
    }
    const groups: SessionGroup[] = [];
    for (const [sessionId, groupWidgets] of groupMap) {
      const newestCreatedAt = groupWidgets.reduce(
        (latest, w) => (w.createdAt > latest ? w.createdAt : latest),
        '',
      );
      const sessionTitle =
        sessionId === '__uncategorized__'
          ? '未分类'
          : sessionTitles.get(sessionId) || '…';
      groups.push({ sessionId, sessionTitle, widgets: groupWidgets, newestCreatedAt });
    }
    groups.sort((a, b) => b.newestCreatedAt.localeCompare(a.newestCreatedAt));
    return groups;
  }, [widgets, sessionTitles]);

  // Auto-expand the newest group on first load
  useEffect(() => {
    if (sessionGroups.length > 0 && !groupsInitializedRef.current) {
      groupsInitializedRef.current = true;
      setExpandedGroups(new Set([sessionGroups[0].sessionId]));
    }
  }, [sessionGroups]);

  const toggleGroup = useCallback((sessionId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  return (
    <div ref={panelRef} className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div
        className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background"
        style={{ width }}
      >
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dashboard.title')}
          </span>
          <div className="flex items-center gap-1">
            {widgets.length > 0 && (
              <>
                {/* Auto-refresh toggle */}
                <button
                  onClick={handleToggleAutoRefresh}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{t('dashboard.autoRefreshLabel')}</span>
                  <span className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors ${autoRefresh ? 'bg-primary' : 'bg-muted'}`}>
                    <span className={`pointer-events-none block h-3 w-3 rounded-full bg-background shadow-sm ring-0 transition-transform mt-0.5 ${autoRefresh ? 'translate-x-3.5 ml-0' : 'translate-x-0.5'}`} />
                  </span>
                </button>
                {/* Divider */}
                <div className="h-4 w-px bg-border/60 mx-1" />
                {/* Refresh all */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRefreshAll}
                  disabled={refreshingAll}
                  title={t('dashboard.refresh')}
                >
                  <ArrowClockwise size={14} className={refreshingAll ? "animate-spin" : ""} />
                  <span className="sr-only">{t('dashboard.refresh')}</span>
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDashboardPanelOpen(false)}
            >
              <X size={14} />
              <span className="sr-only">{t('common.close')}</span>
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8 gap-5">
              <ChartBar size={36} className="opacity-30 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground/70">{t('dashboard.empty')}</p>
              </div>
              <div className="flex flex-col gap-3 w-full max-w-[260px]">
                <div className="flex items-start gap-3 text-left">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground mt-0.5">1</span>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('dashboard.emptyStep1')}</p>
                </div>
                <div className="flex items-start gap-3 text-left">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground mt-0.5">2</span>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t('dashboard.emptyStep2')}</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/50 italic leading-relaxed max-w-[260px]">{t('dashboard.emptyExample')}</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {sessionGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.sessionId);
                // Stable DOM order within group: sort by ID
                const stableGroup = [...group.widgets].sort((a, b) => a.id.localeCompare(b.id));
                return (
                  <div key={group.sessionId} className="border-b border-border/30 last:border-b-0">
                    {/* Group header */}
                    <div className="flex items-center gap-1 px-3 py-2 hover:bg-muted/40 transition-colors">
                      <button
                        className="flex flex-1 items-center gap-1.5 min-w-0 text-left"
                        onClick={() => toggleGroup(group.sessionId)}
                      >
                        {isExpanded ? (
                          <CaretDown size={12} className="shrink-0 text-muted-foreground" />
                        ) : (
                          <CaretRight size={12} className="shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {group.sessionTitle}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/50">
                          ({group.widgets.length})
                        </span>
                      </button>
                      {group.sessionId !== '__uncategorized__' && (
                        <button
                          onClick={() => router.push(`/chat/${group.sessionId}`)}
                          className="shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          title="前往对话"
                        >
                          <ArrowSquareOut size={12} />
                        </button>
                      )}
                    </div>
                    {/* Group widgets — newest first within group */}
                    {isExpanded && (() => {
                      const sortedGroup = [...group.widgets].sort(
                        (a, b) => b.createdAt.localeCompare(a.createdAt),
                      );
                      const groupOrderMap = new Map(sortedGroup.map((w, i) => [w.id, i]));
                      return (
                        <div className="flex flex-col gap-4 px-3 pb-3">
                          {stableGroup.map((widget) => {
                            const displayIdx = groupOrderMap.get(widget.id) ?? 0;
                            return (
                              <DashboardWidgetCard
                                key={widget.id}
                                widget={widget}
                                style={{ order: displayIdx }}
                                refreshing={refreshingAll || refreshingIds.has(widget.id)}
                                isFirst={displayIdx === 0}
                                isLast={displayIdx === group.widgets.length - 1}
                                onRefresh={() => handleRefreshWidget(widget.id)}
                                onDelete={() => handleDeleteWidget(widget.id)}
                                onMove={(dir) => handleMoveWidget(widget.id, dir)}
                              />
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function DashboardWidgetCard({ widget, refreshing, isFirst, isLast, style, onRefresh, onDelete, onMove }: {
  widget: DashboardWidget;
  refreshing: boolean;
  isFirst: boolean;
  isLast: boolean;
  style?: React.CSSProperties;
  onRefresh: () => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down' | 'top') => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="group/card relative rounded-lg overflow-hidden" style={style}>
      {/* Permanent title bar */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <button
          className="flex flex-col items-start min-w-0 text-left"
          onClick={() => window.dispatchEvent(new CustomEvent('dashboard-widget-drilldown', { detail: { title: widget.title, dataContract: widget.dataContract } }))}
          title={t('dashboard.drilldown')}
        >
          <span className="text-xs font-medium text-foreground/70 truncate hover:text-foreground transition-colors w-full">
            {widget.title}
          </span>
          <span className="text-[10px] text-muted-foreground/50 tabular-nums">
            {formatWidgetTime(widget.createdAt)}
          </span>
        </button>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove('up')}
            disabled={isFirst}
            title={t('dashboard.moveUp')}
            className="h-5 w-5"
          >
            <CaretUp size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove('down')}
            disabled={isLast}
            title={t('dashboard.moveDown')}
            className="h-5 w-5"
          >
            <CaretDown size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={refreshing}
            title={t('dashboard.refreshWidget')}
            className="h-5 w-5"
          >
            <ArrowClockwise size={12} className={refreshing ? "animate-spin" : ""} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={async () => {
              try {
                const { exportWidgetAsImage, downloadBlob } = await import('@/lib/dashboard-export');
                const blob = await exportWidgetAsImage(widget.widgetCode);
                downloadBlob(blob, `${widget.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.png`);
              } catch (e) {
                console.error('[DashboardPanel] Export failed:', e);
                showToast({ type: 'error', message: 'Export failed' });
              }
            }}
            title={t('dashboard.exportWidget')}
            className="h-5 w-5"
          >
            <DownloadSimple size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            title={t('dashboard.deleteWidget')}
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
          >
            <Trash size={12} />
          </Button>
        </div>
      </div>

      {/* Shimmer overlay during refresh */}
      {refreshing && (
        <div className="absolute inset-0 z-5 bg-background/30 backdrop-blur-[1px] flex items-center justify-center">
          <div className="text-xs text-muted-foreground">{t('dashboard.refreshing')}</div>
        </div>
      )}

      {/* Widget render */}
      <WidgetRenderer widgetCode={widget.widgetCode} isStreaming={false} title={widget.title} />
    </div>
  );
}
