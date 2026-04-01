"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Gauge, DotOutline } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";
import { getActiveSessionIds, forceGCAllCompleted } from "@/lib/stream-session-manager";

interface ServerStats {
  totalSessions: number;
  dbSizeMb: number;
  rssMb: number;
}

interface GCResult {
  sessionsDeleted: number;
  dbSizeMb: number;
  rssMb: number;
}

const POLL_INTERVAL_MS = 30_000;

export function ResourceMonitor() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [activeStreams, setActiveStreams] = useState(0);
  const [isReclaiming, setIsReclaiming] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref keeps handleReclaim stable across serverStats updates
  const serverStatsRef = useRef<ServerStats | null>(null);
  useEffect(() => { serverStatsRef.current = serverStats; }, [serverStats]);

  const fetchStats = useCallback(async () => {
    setActiveStreams(getActiveSessionIds().length);
    try {
      const res = await fetch("/api/system/stats");
      if (res.ok) setServerStats(await res.json());
    } catch {
      // best effort
    }
  }, []);

  // Start polling when popover opens, stop when closed
  useEffect(() => {
    if (!open) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }
    fetchStats();
    pollTimerRef.current = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [open, fetchStats]);

  // Keep badge up-to-date even when popover is closed; skip setState when value unchanged
  useEffect(() => {
    const timer = setInterval(() => {
      const count = getActiveSessionIds().length;
      setActiveStreams(prev => (prev !== count ? count : prev));
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  const handleReclaim = useCallback(async () => {
    setIsReclaiming(true);
    setLastResult(null);
    const { count } = forceGCAllCompleted();
    try {
      const res = await fetch("/api/system/gc", { method: "POST" });
      const data: GCResult = res.ok
        ? await res.json()
        : { sessionsDeleted: 0, dbSizeMb: serverStatsRef.current?.dbSizeMb ?? 0, rssMb: serverStatsRef.current?.rssMb ?? 0 };
      setLastResult(t("system.reclaimResult", { streams: String(count), sessions: String(data.sessionsDeleted) }));
      setServerStats(prev => prev ? { ...prev, dbSizeMb: data.dbSizeMb, rssMb: data.rssMb } : prev);
      setActiveStreams(getActiveSessionIds().length);
    } catch {
      // Show client-side GC result even if server call fails
      setLastResult(t("system.reclaimResult", { streams: String(count), sessions: "0" }));
    } finally {
      setIsReclaiming(false);
    }
  }, [t]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={open ? "secondary" : "ghost"}
              size="icon-sm"
              className={open ? "" : "text-muted-foreground hover:text-foreground"}
            >
              <Gauge size={16} />
              {activeStreams > 0 && (
                <span className="flex items-center gap-0.5 text-[11px] text-status-warning">
                  <DotOutline size={10} weight="fill" />
                  {activeStreams}
                </span>
              )}
              <span className="sr-only">{t("topBar.resources")}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("topBar.resources")}</TooltipContent>
      </Tooltip>

      <PopoverContent className="w-64">
        <p className="mb-3 text-sm font-semibold">{t("system.title")}</p>
        <div className="space-y-1.5 text-sm">
          <StatRow label={t("system.activeStreams")} value={String(activeStreams)} />
          <StatRow label={t("system.totalSessions")} value={serverStats ? String(serverStats.totalSessions) : "—"} />
          <StatRow label={t("system.database")} value={serverStats ? `${serverStats.dbSizeMb} MB` : "—"} />
          <StatRow label={t("system.memory")} value={serverStats ? `${serverStats.rssMb} MB` : "—"} />
        </div>
        <div className="mt-4 space-y-2">
          <Button
            size="sm"
            className="w-full"
            onClick={handleReclaim}
            disabled={isReclaiming}
          >
            {isReclaiming ? t("system.reclaiming") : t("system.reclaimMemory")}
          </Button>
          {lastResult && (
            <p className="text-xs text-muted-foreground">{lastResult}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
