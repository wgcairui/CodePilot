"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpinnerGap, CheckCircle, Warning, Trash, Play, PencilSimple, X } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { ScheduledTask, TaskRunLog } from "@/types";

interface ChannelBinding {
  channelType: string;
  chatId: string;
}

interface ScheduledTaskDetailDialogProps {
  task: ScheduledTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  bindings: ChannelBinding[];
}

interface EditDraft {
  name: string;
  prompt: string;
  schedule_value: string;
  priority: string;
  notify_on_complete: number;
}

/** Split "channelType::chatId" at the FIRST "::" only — chatIds may contain "::" themselves. */
function splitChannelValue(value: string): [string, string] {
  const idx = value.indexOf("::");
  if (idx === -1) return [value, ""];
  return [value.slice(0, idx), value.slice(idx + 2)];
}

export function ScheduledTaskDetailDialog({
  task,
  open,
  onOpenChange,
  onDelete,
  onRefresh,
  bindings,
}: ScheduledTaskDetailDialogProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<TaskRunLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [savingBridge, setSavingBridge] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  // Polling after Run Now
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const fetchLogs = useCallback(async (taskId: string, showSpinner = true): Promise<TaskRunLog[]> => {
    if (showSpinner) setLoadingLogs(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`);
      if (res.ok) {
        const data = await res.json();
        const fetched: TaskRunLog[] = data.logs ?? [];
        setLogs(fetched);
        return fetched;
      }
    } catch { /* best effort */ }
    finally { if (showSpinner) setLoadingLogs(false); }
    return [];
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollCountRef.current = 0;
    setIsPolling(false);
  }, []);

  // Start polling for log updates; stops when a terminal log appears (max 120s)
  const startPolling = useCallback((taskId: string) => {
    stopPolling();
    pollCountRef.current = 0;
    setIsPolling(true);
    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      const latest = await fetchLogs(taskId, false);
      const hasRunning = latest.some(l => l.status === 'running');
      const hasTerminal = latest.some(l => l.status === 'success' || l.status === 'error');
      if (hasTerminal && !hasRunning) {
        stopPolling();
        return;
      }
      if (pollCountRef.current >= 120) stopPolling();
    }, 1000);
  }, [fetchLogs, stopPolling]);

  useEffect(() => {
    if (open && task) {
      setExpandedLogId(null);
      setEditing(false);
      setDraft(null);
      stopPolling();
      fetchLogs(task.id).then(initialLogs => {
        const hasRunning = initialLogs.some(l => l.status === 'running') || task.last_status === 'running';
        if (hasRunning) startPolling(task.id);
      });
    }
    if (!open) stopPolling();
  }, [open, task, fetchLogs, stopPolling, startPolling]);

  // Clean up on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const startEdit = useCallback(() => {
    if (!task) return;
    setDraft({
      name: task.name,
      prompt: task.prompt,
      schedule_value: task.schedule_value,
      priority: task.priority,
      notify_on_complete: task.notify_on_complete,
    });
    setEditing(true);
  }, [task]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!task || !draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        setEditing(false);
        setDraft(null);
        onRefresh();
      }
    } catch { /* best effort */ }
    finally { setSaving(false); }
  }, [task, draft, onRefresh]);

  const handleBridgeChange = useCallback(async (value: string) => {
    if (!task) return;
    setSavingBridge(true);
    try {
      const [channelType, chatId] = value === "__none__"
        ? [null, null]
        : splitChannelValue(value);
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bridge_channel_type: channelType, bridge_chat_id: chatId }),
      });
      onRefresh();
    } catch { /* best effort */ }
    finally { setSavingBridge(false); }
  }, [task, onRefresh]);

  const handleTogglePause = useCallback(async () => {
    if (!task) return;
    setTogglingPause(true);
    try {
      await fetch(`/api/tasks/${task.id}/pause`, { method: "POST" });
      onRefresh();
    } catch { /* best effort */ }
    finally { setTogglingPause(false); }
  }, [task, onRefresh]);

  const handleRunNow = useCallback(async () => {
    if (!task) return;
    setRunningNow(true);
    let launched = false;
    try {
      const res = await fetch(`/api/tasks/${task.id}/run`, { method: "POST" });
      if (res.ok) launched = true;
    } catch { /* best effort */ }
    finally { setRunningNow(false); }

    if (launched) startPolling(task.id);
  }, [task, startPolling]);

  const handleDelete = useCallback(() => {
    if (!task) return;
    onDelete(task.id);
    onOpenChange(false);
  }, [task, onDelete, onOpenChange]);

  if (!task) return null;

  const bridgeValue = task.bridge_channel_type && task.bridge_chat_id
    ? `${task.bridge_channel_type}::${task.bridge_chat_id}`
    : "__none__";

  const statusColor: Record<string, string> = {
    active: "bg-status-success-muted text-status-success-foreground",
    paused: "bg-status-warning-muted text-status-warning-foreground",
    completed: "bg-muted text-muted-foreground",
    disabled: "bg-muted text-muted-foreground",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-w-2xl + taller for comfortable editing */}
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="text-sm font-semibold">{t("assistant.taskDetails")}</DialogTitle>
            {!editing && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={startEdit}>
                <PencilSimple size={12} className="mr-1" />
                {t("assistant.taskEdit")}
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Basic info / Edit form */}
        <div className="space-y-3">
          {editing && draft ? (
            // ── Edit mode ──
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("assistant.taskName")}</label>
                <Input
                  value={draft.name}
                  onChange={e => setDraft(d => d && { ...d, name: e.target.value })}
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("assistant.taskPrompt")}</label>
                <textarea
                  value={draft.prompt}
                  onChange={e => setDraft(d => d && { ...d, prompt: e.target.value })}
                  rows={8}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("assistant.taskSchedule")} ({task.schedule_type})</label>
                  <Input
                    value={draft.schedule_value}
                    onChange={e => setDraft(d => d && { ...d, schedule_value: e.target.value })}
                    className="h-7 text-xs font-mono"
                    placeholder={task.schedule_type === 'interval' ? '30m / 2h / 1d' : '0 9 * * *'}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("assistant.taskPriority")}</label>
                  <Select value={draft.priority} onValueChange={v => setDraft(d => d && { ...d, priority: v })}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="normal">normal</SelectItem>
                      <SelectItem value="urgent">urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.notify_on_complete === 1}
                  onChange={e => setDraft(d => d && { ...d, notify_on_complete: e.target.checked ? 1 : 0 })}
                  className="rounded"
                />
                {t("assistant.taskNotify")}
              </label>
            </div>
          ) : (
            // ── View mode ──
            <>
              <div>
                <p className="text-sm font-medium">{task.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{task.prompt}</p>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="text-muted-foreground">{t("assistant.taskSchedule")}</div>
                <div className="font-mono">{task.schedule_type}: {task.schedule_value}</div>

                <div className="text-muted-foreground">{t("assistant.taskNextRun")}</div>
                <div>{task.next_run ? new Date(task.next_run).toLocaleString() : "—"}</div>

                <div className="text-muted-foreground">Status</div>
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${statusColor[task.status] ?? "bg-muted text-muted-foreground"}`}>
                    {task.status}
                  </span>
                  {(task.status === 'active' || task.status === 'paused') && (
                    <button
                      className="text-[10px] underline text-muted-foreground"
                      onClick={handleTogglePause}
                      disabled={togglingPause}
                    >
                      {togglingPause
                        ? <SpinnerGap size={10} className="animate-spin" />
                        : task.status === 'active' ? t("assistant.taskPause") : t("assistant.taskResume")}
                    </button>
                  )}
                </div>

                <div className="text-muted-foreground">{t("assistant.taskPriority")}</div>
                <div>{task.priority}</div>

                <div className="text-muted-foreground">{t("assistant.taskNotify")}</div>
                <div>{task.notify_on_complete ? '✓' : '—'}</div>
              </div>
            </>
          )}

          {/* Bridge channel selector (always visible) */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">{t("assistant.taskBridgeChannel")}:</span>
            {bindings.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t("assistant.taskBridgeNotRunning")}</span>
            ) : (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <Select value={bridgeValue} onValueChange={handleBridgeChange} disabled={savingBridge}>
                  <SelectTrigger className="h-7 text-xs w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-w-sm">
                    <SelectItem value="__none__">{t("assistant.taskBridgeNone")}</SelectItem>
                    {bindings.map(b => {
                      const val = `${b.channelType}::${b.chatId}`;
                      return (
                        <SelectItem key={val} value={val}>
                          <span className="truncate">{b.channelType}: {b.chatId}</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {savingBridge && <SpinnerGap size={12} className="animate-spin shrink-0" />}
              </div>
            )}
          </div>
        </div>

        {/* Last result */}
        {!editing && task.last_status && (
          <div className="border-t border-border/40 pt-3 space-y-1.5">
            <p className="text-xs font-medium">{t("assistant.taskLastResult")}</p>
            <div className="flex items-center gap-1.5">
              {task.last_status === "success"
                ? <CheckCircle size={12} className="text-status-success-foreground shrink-0" />
                : task.last_status === "error"
                  ? <Warning size={12} className="text-status-error-foreground shrink-0" />
                  : task.last_status === "running"
                    ? <SpinnerGap size={12} className="animate-spin shrink-0" />
                    : null}
              <span className="text-xs text-muted-foreground">
                {task.last_run ? new Date(task.last_run).toLocaleString() : ""}
                {task.last_status === "running" && " · 执行中..."}
              </span>
            </div>
            {task.last_result && (
              <pre className="text-xs bg-muted rounded p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {task.last_result}
              </pre>
            )}
            {task.last_error && (
              <pre className="text-xs bg-status-error-muted text-status-error-foreground rounded p-2 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                {task.last_error}
              </pre>
            )}
          </div>
        )}

        {/* Run history */}
        {!editing && (
          <div className="border-t border-border/40 pt-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium">{t("assistant.taskRunHistory")}</p>
              {isPolling && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <SpinnerGap size={10} className="animate-spin" />
                  等待执行结果...
                </span>
              )}
            </div>
            {loadingLogs && logs.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
                <SpinnerGap size={12} className="animate-spin" />
                <span>Loading...</span>
              </div>
            ) : logs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">{t("assistant.taskNoLogs")}</p>
            ) : (
              <div className="space-y-1">
                {logs.map(log => (
                  <div key={log.id} className="text-xs border border-border/30 rounded px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {log.status === "success"
                          ? <CheckCircle size={11} className="text-status-success-foreground shrink-0" />
                          : log.status === "running"
                            ? <SpinnerGap size={11} className="animate-spin shrink-0" />
                            : <Warning size={11} className="text-status-error-foreground shrink-0" />}
                        <span className="text-muted-foreground">{new Date(log.created_at).toLocaleString()}</span>
                        <span className={`text-[10px] px-1 rounded ${
                          log.status === "success" ? "bg-status-success-muted text-status-success-foreground" :
                          log.status === "running" ? "bg-status-warning-muted text-status-warning-foreground" :
                          "bg-status-error-muted text-status-error-foreground"
                        }`}>{log.status}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {log.duration_ms != null && (
                          <span>{(log.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                        {(log.error || log.result) && (
                          <button
                            className="underline text-[10px]"
                            onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                          >
                            {expandedLogId === log.id ? "收起" : "详情"}
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedLogId === log.id && (
                      <pre className="mt-1.5 text-[11px] bg-muted rounded p-1.5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                        {log.error ?? log.result}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="border-t border-border/40 pt-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-status-error-foreground hover:bg-status-error-muted"
            onClick={handleDelete}
          >
            <Trash size={13} className="mr-1" />
            {t("assistant.taskDelete")}
          </Button>

          {editing ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={cancelEdit} disabled={saving}>
                <X size={13} className="mr-1" />
                {t("assistant.taskCancel")}
              </Button>
              <Button size="sm" className="text-xs" onClick={handleSave} disabled={saving}>
                {saving && <SpinnerGap size={13} className="animate-spin mr-1" />}
                {t("assistant.taskSave")}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={handleRunNow}
              disabled={runningNow}
            >
              {runningNow
                ? <SpinnerGap size={13} className="animate-spin mr-1" />
                : <Play size={13} className="mr-1" />}
              {t("assistant.taskRunNow")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
