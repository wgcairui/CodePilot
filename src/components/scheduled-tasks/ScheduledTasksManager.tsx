"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Clock, SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n/en";
import type { ScheduledTask } from "@/types";
import { ScheduledTaskDetailPanel } from "./ScheduledTaskDetailPanel";
import { ScheduledTaskDetailDialog } from "@/components/settings/ScheduledTaskDetailDialog";

export function ScheduledTasksManager() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [channelBindings, setChannelBindings] = useState<{ channelType: string; chatId: string }[]>([]);
  const [selected, setSelected] = useState<ScheduledTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/list");
      if (res.ok) {
        const data = await res.json();
        const fetched: ScheduledTask[] = data.tasks || [];
        setTasks(fetched);
        // Keep selected in sync
        setSelected(prev => prev ? (fetched.find(t => t.id === prev.id) ?? null) : null);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchBindings = useCallback(async () => {
    try {
      const res = await fetch("/api/bridge/bindings");
      if (res.ok) {
        const data = await res.json();
        setChannelBindings(data.bindings ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchBindings();
  }, [fetchTasks, fetchBindings]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      setTasks(prev => prev.filter(t => t.id !== id));
      setSelected(prev => prev?.id === id ? null : prev);
    } catch { /* ignore */ }
  }, []);

  const statusDot: Record<string, string> = {
    active: "bg-status-success",
    paused: "bg-status-warning",
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 px-6 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t('nav.scheduledTasks' as TranslationKey)}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('assistant.scheduledTasks' as TranslationKey)}
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
            <Plus size={14} />
            {t('assistant.taskCreate' as TranslationKey)}
          </Button>
        </div>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        {/* Left: task list */}
        <div className="w-64 shrink-0 flex flex-col overflow-hidden border-r border-border/50">
          <div className="flex-1 overflow-y-auto min-h-0 p-2">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <Clock size={32} className="opacity-40" />
                <p className="text-xs text-center">{t('assistant.noTasks' as TranslationKey)}</p>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setShowCreate(true)}
                  className="gap-1"
                >
                  <Plus size={12} />
                  Create one
                </Button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {tasks.map(task => {
                  const isActive = selected?.id === task.id;
                  return (
                    <button
                      key={task.id}
                      onClick={() => setSelected(task)}
                      className={`w-full text-left rounded px-3 py-2 text-xs transition-colors ${
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[task.status] ?? "bg-muted-foreground/40"}`} />
                        <span className="truncate font-medium">{task.name}</span>
                      </div>
                      <div className="mt-0.5 pl-3.5 text-[10px] text-muted-foreground/70 font-mono truncate">
                        {task.schedule_type}: {task.schedule_value}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {selected ? (
            <ScheduledTaskDetailPanel
              key={selected.id}
              task={selected}
              bindings={channelBindings}
              onDelete={handleDelete}
              onRefresh={fetchTasks}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Clock size={48} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium">{t('assistant.scheduledTasks' as TranslationKey)}</p>
                <p className="text-xs mt-1">{t('assistant.noTasks' as TranslationKey)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New task dialog */}
      <ScheduledTaskDetailDialog
        task={null}
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) fetchTasks();
        }}
        onDelete={handleDelete}
        onRefresh={fetchTasks}
        bindings={channelBindings}
      />
    </div>
  );
}
