"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SpinnerGap, Plus, Trash, PencilSimple } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { AddHostDialog } from "./AddHostDialog";
import { SetupGuide, type CheckResult, type InstallPlan } from "./SetupGuide";
import type { RemoteHost, RemoteConnectionStatus } from "@/types";

function getElectronRemoteAPI() {
  if (typeof window === "undefined") return null;
  return window.electronAPI?.remote ?? null;
}

interface StatusDotProps {
  status: RemoteConnectionStatus;
}

function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={cn(
        "block h-2 w-2 shrink-0 rounded-full",
        status === "connected" && "bg-status-success",
        status === "connecting" && "bg-status-warning animate-pulse",
        status === "reconnecting" && "bg-status-warning animate-pulse",
        status === "failed" && "bg-destructive",
        status === "disconnected" && "bg-muted-foreground/40"
      )}
    />
  );
}

interface SetupState {
  hostId: string;
  checkResult: CheckResult;
  installPlan: InstallPlan;
}

export function RemoteHostList() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, RemoteConnectionStatus>>({});
  const [setupState, setSetupState] = useState<SetupState | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editHost, setEditHost] = useState<RemoteHost | null>(null);

  const fetchHosts = useCallback(async () => {
    try {
      const res = await fetch("/api/remote/hosts");
      if (res.ok) {
        const data: RemoteHost[] = await res.json();
        setHosts(data);
      }
    } catch {
      // ignore fetch errors silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  // Subscribe to status updates from Electron
  useEffect(() => {
    const api = getElectronRemoteAPI();
    if (!api) return;
    const cleanup = api.onStatusChanged(({ hostId, status }) => {
      setStatusMap((prev) => {
        if (prev[hostId] === status) return prev;
        return { ...prev, [hostId]: status };
      });
    });
    return cleanup;
  }, []);

  const getStatus = useCallback(
    (host: RemoteHost): RemoteConnectionStatus => {
      return statusMap[host.id] ?? host.status ?? "disconnected";
    },
    [statusMap]
  );

  const handleConnect = useCallback(
    async (host: RemoteHost) => {
      const api = getElectronRemoteAPI();
      if (!api) {
        // In web context, just show a message
        return;
      }

      setConnectingId(host.id);
      setStatusMap((prev) => ({ ...prev, [host.id]: "connecting" }));

      try {
        // Step 1: SSH connect
        await api.connect(host.id);

        // Step 2: Wait for 'connected' status (via onStatusChanged subscription above)
        // Give it a brief moment for the status callback to fire
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Step 3: Check environment
        const { checkResult, installPlan } = await api.checkEnv(host.id);

        const needsSetup =
          installPlan.needsNode ||
          installPlan.needsClaude ||
          installPlan.needsAgentDeploy;

        if (needsSetup) {
          setSetupState({ hostId: host.id, checkResult, installPlan });
          setConnectingId(null);
          return;
        }

        // Step 4: Start agent
        await api.startAgent(host.id, host.agentPort);

        // Step 6: Poll until agent is running (max 10 attempts, 1s each)
        let running = false;
        for (let i = 0; i < 10; i++) {
          running = await api.isAgentRunning(host.id, host.agentPort);
          if (running) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (!running) {
          setStatusMap((prev) => ({ ...prev, [host.id]: "failed" }));
        } else {
          setStatusMap((prev) => ({ ...prev, [host.id]: "connected" }));
        }
      } catch {
        setStatusMap((prev) => ({ ...prev, [host.id]: "failed" }));
      } finally {
        setConnectingId(null);
      }
    },
    []
  );

  const handleAutoInstall = useCallback(async () => {
    if (!setupState) return;
    const api = getElectronRemoteAPI();
    if (!api) return;

    const host = hosts.find((h) => h.id === setupState.hostId);
    if (!host) return;

    setConnectingId(host.id);
    setSetupState(null);

    try {
      await api.deployAgent(host.id);
      await api.startAgent(host.id, host.agentPort);

      let running = false;
      for (let i = 0; i < 10; i++) {
        running = await api.isAgentRunning(host.id, host.agentPort);
        if (running) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      setStatusMap((prev) => ({
        ...prev,
        [host.id]: running ? "connected" : "failed",
      }));
    } catch {
      setStatusMap((prev) => ({ ...prev, [host.id]: "failed" }));
    } finally {
      setConnectingId(null);
    }
  }, [setupState, hosts]);

  const handleDisconnect = useCallback(async (hostId: string) => {
    const api = getElectronRemoteAPI();
    if (!api) return;
    try {
      await api.disconnect(hostId);
      setStatusMap((prev) => ({ ...prev, [hostId]: "disconnected" }));
    } catch {
      // ignore
    }
  }, []);

  const handleDelete = useCallback(
    async (hostId: string) => {
      try {
        await fetch(`/api/remote/hosts/${hostId}`, { method: "DELETE" });
        setHosts((prev) => prev.filter((h) => h.id !== hostId));
        setStatusMap((prev) => {
          const next = { ...prev };
          delete next[hostId];
          return next;
        });
      } catch {
        // ignore
      }
    },
    []
  );

  const statusLabel = useCallback(
    (status: RemoteConnectionStatus): string => {
      const map: Record<RemoteConnectionStatus, string> = {
        disconnected: t("remoteHost.status.disconnected"),
        connecting: t("remoteHost.status.connecting"),
        connected: t("remoteHost.status.connected"),
        reconnecting: t("remoteHost.status.reconnecting"),
        failed: t("remoteHost.status.failed"),
      };
      return map[status];
    },
    [t]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <SpinnerGap size={16} className="animate-spin" />
        Loading hosts...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{t("remoteHost.title")}</h3>
          <p className="text-xs text-muted-foreground">
            Manage SSH connections to remote development hosts
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            setEditHost(null);
            setAddDialogOpen(true);
          }}
        >
          <Plus size={14} />
          {t("remoteHost.addHost")}
        </Button>
      </div>

      {/* Host list */}
      {hosts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No remote hosts configured.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Add a host to connect to remote development environments.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {hosts.map((host) => {
            const status = getStatus(host);
            const isConnecting =
              connectingId === host.id ||
              status === "connecting" ||
              status === "reconnecting";
            const isConnected = status === "connected";

            return (
              <div
                key={host.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5"
              >
                {/* Status dot */}
                <StatusDot status={status} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{host.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {host.username}@{host.host}:{host.port}
                  </p>
                </div>

                {/* Status label */}
                <span
                  className={cn(
                    "text-xs shrink-0",
                    isConnected && "text-status-success",
                    status === "failed" && "text-destructive",
                    (status === "connecting" || status === "reconnecting") &&
                      "text-status-warning",
                    status === "disconnected" && "text-muted-foreground"
                  )}
                >
                  {statusLabel(status)}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setEditHost(host);
                      setAddDialogOpen(true);
                    }}
                    disabled={isConnecting}
                    title="Edit"
                  >
                    <PencilSimple size={14} />
                  </Button>

                  {isConnected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleDisconnect(host.id)}
                    >
                      {t("remoteHost.disconnect")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => handleConnect(host)}
                      disabled={isConnecting}
                    >
                      {isConnecting && (
                        <SpinnerGap size={12} className="animate-spin" />
                      )}
                      {status === "failed"
                        ? t("remoteHost.reconnect")
                        : t("remoteHost.connect")}
                    </Button>
                  )}

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(host.id)}
                    disabled={isConnecting || isConnected}
                    title="Delete"
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Setup Guide overlay */}
      {setupState && (
        <div className="rounded-lg border border-border/50 p-4 space-y-3">
          <p className="text-sm font-medium">Remote Setup Required</p>
          <SetupGuide
            checkResult={setupState.checkResult}
            installPlan={setupState.installPlan}
            onAutoInstall={handleAutoInstall}
            onRetry={() => {
              const host = hosts.find((h) => h.id === setupState.hostId);
              if (host) {
                setSetupState(null);
                handleConnect(host);
              }
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-muted-foreground"
            onClick={() => setSetupState(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Add/Edit dialog */}
      <AddHostDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onComplete={fetchHosts}
        editHost={editHost}
      />
    </div>
  );
}
