"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { RemoteConnectionStatus } from "@/types";

type ElectronRemoteAPI = {
  onStatusChanged: (
    callback: (data: { hostId: string; status: RemoteConnectionStatus; hostName?: string }) => void
  ) => () => void;
};

function getElectronRemoteAPI(): ElectronRemoteAPI | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as unknown as { electronAPI?: { remote?: ElectronRemoteAPI } })
    .electronAPI?.remote ?? null;
}

interface ConnectionEntry {
  hostId: string;
  hostName: string;
  status: RemoteConnectionStatus;
}

export function RemoteConnectionStatus() {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);

  useEffect(() => {
    const api = getElectronRemoteAPI();
    if (!api) return;

    const cleanup = api.onStatusChanged(({ hostId, status, hostName }) => {
      setConnections((prev) => {
        const existing = prev.find((c) => c.hostId === hostId);
        const name = hostName ?? existing?.hostName ?? hostId;

        if (status === "disconnected") {
          // Remove from list when disconnected
          return prev.filter((c) => c.hostId !== hostId);
        }

        if (existing) {
          return prev.map((c) =>
            c.hostId === hostId ? { ...c, status, hostName: name } : c
          );
        }

        return [...prev, { hostId, hostName: name, status }];
      });
    });

    return cleanup;
  }, []);

  if (connections.length === 0) return null;

  // Show the first active connection in the topbar
  const active = connections[0];

  const statusLabel = () => {
    const map: Record<RemoteConnectionStatus, string> = {
      disconnected: t("remoteHost.status.disconnected"),
      connecting: t("remoteHost.status.connecting"),
      connected: t("remoteHost.status.connected"),
      reconnecting: t("remoteHost.status.reconnecting"),
      failed: t("remoteHost.status.failed"),
    };
    return map[active.status];
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        active.status === "connected" &&
          "bg-status-success/10 text-status-success",
        (active.status === "connecting" || active.status === "reconnecting") &&
          "bg-status-warning/10 text-status-warning",
        active.status === "failed" && "bg-destructive/10 text-destructive",
        active.status === "disconnected" && "bg-muted text-muted-foreground"
      )}
      title={`${active.hostName}: ${statusLabel()}`}
    >
      <span
        className={cn(
          "block h-1.5 w-1.5 shrink-0 rounded-full",
          active.status === "connected" && "bg-status-success",
          (active.status === "connecting" ||
            active.status === "reconnecting") &&
            "bg-status-warning animate-pulse",
          active.status === "failed" && "bg-destructive",
          active.status === "disconnected" && "bg-muted-foreground/40"
        )}
      />
      <span className="max-w-[80px] truncate">{active.hostName}</span>
    </div>
  );
}
