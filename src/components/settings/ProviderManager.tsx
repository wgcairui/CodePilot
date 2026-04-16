"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SpinnerGap, PencilSimple, Stethoscope, CheckCircle, DotsSixVertical } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { ProviderForm } from "./ProviderForm";
import { ProviderDoctorDialog } from "./ProviderDoctorDialog";
import type { ProviderFormData } from "./ProviderForm";
import { PresetConnectDialog } from "./PresetConnectDialog";
import {
  QUICK_PRESETS,
  GEMINI_IMAGE_MODELS,
  getGeminiImageModel,
  MINIMAX_IMAGE_MODELS,
  MINIMAX_VIDEO_MODELS,
  getMinimaxImageModel,
  getMinimaxVideoModel,
  getProviderIcon,
  findMatchingPreset,
  type QuickPreset,
} from "./provider-presets";
import type { ApiProvider, ProviderModelGroup } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import Anthropic from "@lobehub/icons/es/Anthropic";
import { ProviderOptionsSection } from "./ProviderOptionsSection";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProviderManager() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [envDetected, setEnvDetected] = useState<Record<string, string>>({});
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  // Edit dialog state — fallback ProviderForm for providers that don't match any preset
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null);

  // Preset connect/edit dialog state
  const [connectPreset, setConnectPreset] = useState<QuickPreset | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [presetEditProvider, setPresetEditProvider] = useState<ApiProvider | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<ApiProvider | null>(null);
  const [deleting, setDeleting] = useState(false);

  // OpenAI OAuth state
  const [openaiAuth, setOpenaiAuth] = useState<{ authenticated: boolean; email?: string; plan?: string } | null>(null);
  const [openaiLoggingIn, setOpenaiLoggingIn] = useState(false);
  const [openaiError, setOpenaiError] = useState<string | null>(null);

  // Doctor dialog state
  const [doctorOpen, setDoctorOpen] = useState(false);

  // Env provider override state (manual base_url / auth_token)
  const [envOverrideBaseUrl, setEnvOverrideBaseUrl] = useState('');
  const [envOverrideToken, setEnvOverrideToken] = useState('');
  const [envOverrideSaving, setEnvOverrideSaving] = useState(false);

  // MiniMax quota state: { [providerId]: { loading, models, error } }
  const [minimaxQuotas, setMinimaxQuotas] = useState<Record<string, {
    loading: boolean;
    models?: Array<{
      modelName: string;
      weeklyRemains: number; weeklyTotal: number;
      weeklyStartTime?: number; weeklyEndTime?: number; weeklyRemainsMs?: number;
      intervalRemains: number; intervalTotal: number;
      intervalStartTime?: number; intervalEndTime?: number; intervalRemainsMs?: number;
    }>;
    error?: string;
  }>>({});

  // Global default model state
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [globalDefaultProvider, setGlobalDefaultProvider] = useState('');

  const fetchProviders = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/providers");
      if (!res.ok) throw new Error("Failed to load providers");
      const data = await res.json();
      setProviders(data.providers || []);
      setEnvDetected(data.env_detected || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  // Load env provider overrides on mount
  useEffect(() => {
    fetch('/api/settings/app')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.settings) {
          setEnvOverrideBaseUrl(data.settings.anthropic_base_url || '');
          setEnvOverrideToken(data.settings.anthropic_auth_token || '');
        }
      })
      .catch(() => {});
  }, []);

  const handleEnvOverrideSave = useCallback(async () => {
    setEnvOverrideSaving(true);
    try {
      await fetch('/api/settings/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            anthropic_base_url: envOverrideBaseUrl,
            anthropic_auth_token: envOverrideToken.startsWith('***') ? undefined : envOverrideToken,
          },
        }),
      });
      window.dispatchEvent(new Event('provider-changed'));
    } catch { /* ignore */ } finally {
      setEnvOverrideSaving(false);
    }
  }, [envOverrideBaseUrl, envOverrideToken]);
  // Fetch OpenAI OAuth status
  useEffect(() => {
    fetch('/api/openai-oauth/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setOpenaiAuth(data); })
      .catch(() => {});
  }, []);

  // Fetch all provider models for the global default model selector
  const fetchModels = useCallback(() => {
    fetch('/api/providers/models')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.groups) setProviderGroups(data.groups);
      })
      .catch(() => {});
    // Load current global default model
    fetch('/api/providers/options?providerId=__global__')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.options?.default_model) {
          setGlobalDefaultModel(data.options.default_model);
          setGlobalDefaultProvider(data.options.default_model_provider || '');
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchModels();
    const handler = () => fetchModels();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchModels]);

  const handleEdit = (provider: ApiProvider) => {
    // Try to match provider to a quick preset for a cleaner edit experience
    const matchedPreset = findMatchingPreset(provider);
    if (matchedPreset) {
      // Clear stale generic-form state to prevent handleEditSave picking the wrong target
      setEditingProvider(null);
      setConnectPreset(matchedPreset);
      setPresetEditProvider(provider);
      setConnectDialogOpen(true);
    } else {
      // Clear stale preset-edit state
      setPresetEditProvider(null);
      setEditingProvider(provider);
      setFormOpen(true);
    }
  };

  const handleEditSave = async (data: ProviderFormData) => {
    const target = presetEditProvider || editingProvider;
    if (!target) return;
    const res = await fetch(`/api/providers/${target.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to update provider");
    }
    const result = await res.json();
    setProviders((prev) => prev.map((p) => (p.id === target.id ? result.provider : p)));
    window.dispatchEvent(new Event("provider-changed"));
  };

  const handlePresetAdd = async (data: ProviderFormData) => {
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to create provider");
    }
    const result = await res.json();
    const newProvider: ApiProvider = result.provider;
    setProviders((prev) => [...prev, newProvider]);

    window.dispatchEvent(new Event("provider-changed"));
  };

  const handleOpenPresetDialog = (preset: QuickPreset) => {
    setConnectPreset(preset);
    setPresetEditProvider(null); // ensure create mode
    setConnectDialogOpen(true);
  };

  const handleDisconnect = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/providers/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setProviders((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        window.dispatchEvent(new Event("provider-changed"));
      }
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleEnvModelChange = useCallback(async (
    provider: ApiProvider,
    field: string,
    value: string,
  ) => {
    try {
      const env = JSON.parse(provider.extra_env || '{}') as Record<string, string>;
      env[field] = value;
      const res = await fetch(`/api/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key,
          extra_env: JSON.stringify(env),
          notes: provider.notes,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setProviders(prev => prev.map(p => p.id === provider.id ? result.provider : p));
        window.dispatchEvent(new Event('provider-changed'));
      }
    } catch { /* ignore */ }
  }, []);

  const fetchMinimaxQuota = useCallback(async (providerId: string) => {
    setMinimaxQuotas(prev => ({ ...prev, [providerId]: { loading: true } }));
    try {
      const res = await fetch(`/api/providers/${providerId}/quota`);
      const data = await res.json();
      if (!res.ok) {
        setMinimaxQuotas(prev => ({ ...prev, [providerId]: { loading: false, error: data.error || 'Failed' } }));
        return;
      }
      setMinimaxQuotas(prev => ({
        ...prev,
        [providerId]: {
          loading: false,
          models: (data.models ?? []) as Array<{
            modelName: string;
            weeklyRemains: number; weeklyTotal: number;
            weeklyStartTime?: number; weeklyEndTime?: number; weeklyRemainsMs?: number;
            intervalRemains: number; intervalTotal: number;
            intervalStartTime?: number; intervalEndTime?: number; intervalRemainsMs?: number;
          }>,
        },
      }));
    } catch (err) {
      setMinimaxQuotas(prev => ({
        ...prev,
        [providerId]: { loading: false, error: err instanceof Error ? err.message : 'Failed' },
      }));
    }
  }, []);

  // Renders the MiniMax quota block for a given provider.
  // filterFn narrows which models to show (undefined = show all).
  const renderMinimaxQuota = useCallback((
    providerId: string,
    filterFn?: (m: { modelName: string; weeklyRemains: number; weeklyTotal: number; intervalRemains: number; intervalTotal: number }) => boolean,
  ) => {
    const q = minimaxQuotas[providerId];
    if (!q) {
      return (
        <div className="flex items-center mt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] text-muted-foreground h-auto px-2 py-0.5"
            onClick={() => fetchMinimaxQuota(providerId)}
          >
            {isZh ? '查看配额' : 'Check quota'}
          </Button>
        </div>
      );
    }
    if (q.loading) {
      return <p className="text-[11px] text-muted-foreground mt-1">{isZh ? '加载中…' : 'Loading…'}</p>;
    }
    if (q.error) {
      return (
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[11px] text-destructive">{q.error}</span>
          <Button variant="ghost" size="sm" className="text-[11px] h-auto px-1.5 py-0.5" onClick={() => fetchMinimaxQuota(providerId)}>
            {isZh ? '重试' : 'Retry'}
          </Button>
        </div>
      );
    }
    // Filter: exclude models where both weekly and interval total are 0 (not in plan)
    const baseModels = (q.models ?? []).filter(m => m.weeklyTotal > 0 || m.intervalTotal > 0);
    const visibleModels = filterFn ? baseModels.filter(filterFn) : baseModels;
    if (visibleModels.length === 0) {
      return (
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[11px] text-muted-foreground">{isZh ? '暂无相关配额数据' : 'No quota data'}</span>
          <Button variant="ghost" size="sm" className="text-[11px] h-auto px-1.5 py-0.5 text-muted-foreground" onClick={() => fetchMinimaxQuota(providerId)}>
            {isZh ? '刷新' : 'Refresh'}
          </Button>
        </div>
      );
    }
    // Format a ms timestamp as HH:mm (UTC+8)
    const fmtTime = (ms: number) => {
      const d = new Date(ms + 8 * 3600_000); // shift to UTC+8
      const h = String(d.getUTCHours()).padStart(2, '0');
      const min = String(d.getUTCMinutes()).padStart(2, '0');
      return `${h}:${min}`;
    };
    // Format ms duration as "X 小时 Y 分钟" / "Xh Ym"
    const fmtRemains = (ms: number) => {
      const totalMin = Math.ceil(ms / 60_000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      if (isZh) return h > 0 ? `${h} 小时 ${m} 分钟后重置` : `${m} 分钟后重置`;
      return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
    };

    return (
      <div className="mt-2 space-y-2.5">
        {visibleModels.map(m => {
          const periods: Array<{
            label: string; used: number; total: number;
            startTime?: number; endTime?: number; remainsMs?: number;
          }> = [];
          if (m.intervalTotal > 0) {
            periods.push({
              label: isZh ? '周期' : 'Interval',
              used: m.intervalTotal - m.intervalRemains,
              total: m.intervalTotal,
              startTime: m.intervalStartTime,
              endTime: m.intervalEndTime,
              remainsMs: m.intervalRemainsMs,
            });
          }
          if (m.weeklyTotal > 0) {
            periods.push({
              label: isZh ? '本周' : 'Weekly',
              used: m.weeklyTotal - m.weeklyRemains,
              total: m.weeklyTotal,
              startTime: m.weeklyStartTime,
              endTime: m.weeklyEndTime,
              remainsMs: m.weeklyRemainsMs,
            });
          }
          return (
            <div key={m.modelName}>
              <p className="text-[11px] font-medium mb-1 text-foreground">{m.modelName}</p>
              <div className="rounded-md bg-muted/40 px-2.5 py-2 space-y-2">
                {periods.map(p => {
                  const pct = p.total > 0 ? Math.round((p.used / p.total) * 100) : 0;
                  return (
                    <div key={p.label}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="font-medium text-primary">{p.label}</span>
                        <span className="text-muted-foreground">
                          {p.used.toLocaleString()}/{p.total.toLocaleString()}
                          <span className="ml-1.5">{pct}%</span>
                        </span>
                      </div>
                      {(p.startTime || p.remainsMs) && (
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                          {p.startTime && p.endTime
                            ? <span>{fmtTime(p.startTime)}-{fmtTime(p.endTime)}(UTC+8)</span>
                            : <span />}
                          {p.remainsMs
                            ? <span>{fmtRemains(p.remainsMs)}</span>
                            : null}
                        </div>
                      )}
                      <div className="h-[3px] rounded-full bg-primary/15 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/55"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <Button variant="ghost" size="sm" className="text-[11px] h-auto px-0 py-0.5 text-muted-foreground" onClick={() => fetchMinimaxQuota(providerId)}>
          {isZh ? '刷新' : 'Refresh'}
        </Button>
      </div>
    );
  }, [minimaxQuotas, fetchMinimaxQuota, isZh]);

  const handleOpenAILogin = async () => {
    setOpenaiLoggingIn(true);
    setOpenaiError(null);
    try {
      const res = await fetch("/api/openai-oauth/start");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start OAuth');
      }
      const { authUrl } = await res.json();
      window.open(authUrl, '_blank');

      // Poll for completion with timeout
      let pollCount = 0;
      const maxPolls = 150; // 5 minutes at 2s intervals
      const poll = setInterval(async () => {
        pollCount++;
        if (pollCount >= maxPolls) {
          clearInterval(poll);
          setOpenaiLoggingIn(false);
          setOpenaiError(isZh ? '登录超时，请重试' : 'Login timed out, please try again');
          return;
        }
        try {
          const statusRes = await fetch("/api/openai-oauth/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (status.authenticated) {
              clearInterval(poll);
              setOpenaiAuth(status);
              setOpenaiLoggingIn(false);
              fetchModels(); // refresh model list to include OpenAI models
              // OAuth is a virtual provider source that hasCodePilotProvider()
              // counts; broadcast so listeners (SetupCenter's ProviderCard,
              // anywhere reading provider presence) re-evaluate.
              window.dispatchEvent(new Event('provider-changed'));
            }
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (err) {
      setOpenaiLoggingIn(false);
      setOpenaiError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleOpenAILogout = async () => {
    try {
      await fetch("/api/openai-oauth/status", { method: "DELETE" });
      setOpenaiAuth({ authenticated: false });
      fetchModels(); // refresh model list
      // Logout removes the virtual OAuth provider; listeners must re-check
      // so SetupCenter's ProviderCard can downgrade if OAuth was the only source.
      window.dispatchEvent(new Event('provider-changed'));
    } catch { /* ignore */ }
  };

  const sorted = [...providers].sort((a, b) => a.sort_order - b.sort_order);

  // ── Drag-to-reorder state ──
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setOverIndex(index);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  const handleDrop = async (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const reordered = [...sorted];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    const orders = reordered.map((p, i) => ({ id: p.id, sort_order: i }));
    // Optimistic update
    setProviders(prev => {
      const updated = [...prev];
      orders.forEach(({ id, sort_order }) => {
        const idx = updated.findIndex(p => p.id === id);
        if (idx !== -1) updated[idx] = { ...updated[idx], sort_order };
      });
      return updated;
    });
    setDragIndex(null);
    setOverIndex(null);
    await fetch('/api/providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    }).catch(() => {});
    window.dispatchEvent(new Event('provider-changed'));
  };

  // Save global default model — also syncs default_provider_id for backend consumers
  const handleGlobalDefaultModelChange = useCallback(async (compositeValue: string) => {
    if (compositeValue === '__auto__') {
      setGlobalDefaultModel('');
      setGlobalDefaultProvider('');
      // Clear both global default model AND legacy default_provider_id in one call
      await fetch('/api/providers/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: '__global__',
          options: { default_model: '', default_model_provider: '', legacy_default_provider_id: '' },
        }),
      }).catch(() => {});
    } else {
      // compositeValue format: "providerId::modelValue"
      const sepIdx = compositeValue.indexOf('::');
      const pid = compositeValue.slice(0, sepIdx);
      const model = compositeValue.slice(sepIdx + 2);
      setGlobalDefaultModel(model);
      setGlobalDefaultProvider(pid);
      // Write global default model + sync legacy default_provider_id in one call
      await fetch('/api/providers/options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: '__global__',
          options: { default_model: model, default_model_provider: pid, legacy_default_provider_id: pid },
        }),
      }).catch(() => {});
    }
    window.dispatchEvent(new Event('provider-changed'));
  }, []);

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* ─── Section 0: Troubleshooting + Default Model ─── */}
      <div className="rounded-lg border border-border/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{isZh ? '连接诊断' : 'Connection Diagnostics'}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isZh
                ? '检查 CLI、认证、模型兼容性和网络连接是否正常'
                : 'Check CLI, auth, model compatibility, and network connectivity'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setDoctorOpen(true)}
          >
            <Stethoscope size={14} />
            {isZh ? '运行诊断' : 'Run Diagnostics'}
          </Button>
        </div>

        {/* Divider */}
        <div className="border-t border-border/30 my-3" />

        {/* Global default model */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{t('settings.defaultModel' as TranslationKey)}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('settings.defaultModelDesc' as TranslationKey)}
            </p>
          </div>
          {providerGroups.length > 0 && (
            <Select
              value={globalDefaultModel ? `${globalDefaultProvider}::${globalDefaultModel}` : '__auto__'}
              onValueChange={handleGlobalDefaultModelChange}
            >
              <SelectTrigger className="w-[160px] h-7 text-[11px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">
                  {t('settings.defaultModelAuto' as TranslationKey)}
                </SelectItem>
                {providerGroups.map(group => (
                  <SelectGroup key={group.provider_id}>
                    <SelectLabel className="text-[10px] text-muted-foreground">
                      {group.provider_name}
                    </SelectLabel>
                    {group.models.map(m => (
                      <SelectItem
                        key={`${group.provider_id}::${m.value}`}
                        value={`${group.provider_id}::${m.value}`}
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          <p className="text-sm">{t('common.loading')}</p>
        </div>
      )}

      {/* ─── Section 1: Connected Providers ─── */}
      {!loading && (
        <div className="rounded-lg border border-border/50 p-4 space-y-2">
          <h3 className="text-sm font-medium mb-1">{t('provider.connectedProviders')}</h3>

          {/* Claude Code — settings link */}
          <div className="border-b border-border/30 pb-2">
            <div className="flex items-center gap-3 py-2.5 px-1">
              <div className="shrink-0 w-[22px] flex justify-center">
                <Anthropic size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Claude Code</span>
                  {Object.keys(envDetected).length > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-status-success-foreground border-status-success-border">
                      ENV
                    </Badge>
                  )}
                </div>
              </div>
              <a
                href="/settings#cli"
                className="text-xs text-primary hover:underline flex-shrink-0"
              >
                {t('provider.goToClaudeCodeSettings')}
              </a>
            </div>
            <p className="text-[11px] text-muted-foreground ml-[34px] leading-relaxed">
              {t('provider.ccSwitchHint')}
            </p>
            <ProviderOptionsSection providerId="env" showThinkingOptions />
            {/* Manual overrides for env provider — persisted in CodePilot DB, override env vars */}
            <div className="ml-[34px] mt-3 space-y-2">
              <p className="text-[11px] text-muted-foreground font-medium">
                {isZh ? '手动覆盖（优先于环境变量）' : 'Manual overrides (take precedence over env vars)'}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground w-20 shrink-0">Base URL</span>
                <Input
                  value={envOverrideBaseUrl}
                  onChange={e => setEnvOverrideBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                  className="h-7 text-[11px] font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground w-20 shrink-0">Auth Token</span>
                <Input
                  value={envOverrideToken}
                  onChange={e => setEnvOverrideToken(e.target.value)}
                  placeholder={isZh ? '留空则使用环境变量' : 'Leave empty to use env var'}
                  type="password"
                  className="h-7 text-[11px] font-mono"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleEnvOverrideSave}
                  disabled={envOverrideSaving}
                >
                  {envOverrideSaving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}
                </Button>
              </div>
            </div>
          </div>

          {/* OpenAI OAuth login */}
          <div className="border-b border-border/30 pb-2">
            <div className="flex items-center gap-3 py-2.5 px-1">
              <div className="shrink-0 w-[22px] flex justify-center">
                <span className="text-sm font-bold">AI</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">OpenAI</span>
                  {openaiAuth?.authenticated && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-status-success-foreground border-status-success-border">
                      {openaiAuth.plan || 'OAuth'}
                    </Badge>
                  )}
                </div>
                {openaiAuth?.authenticated && openaiAuth.email && (
                  <p className="text-[10px] text-muted-foreground">{openaiAuth.email}</p>
                )}
              </div>
              {openaiAuth?.authenticated ? (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={handleOpenAILogout}>
                  {t('cli.openaiLogout')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleOpenAILogin}
                  disabled={openaiLoggingIn}
                >
                  {openaiLoggingIn && <SpinnerGap size={12} className="animate-spin" />}
                  {t('cli.openaiLogin')}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground ml-[34px] leading-relaxed">
              {t('provider.openaiOAuthHint')}
            </p>
            {openaiError && (
              <p className="text-[11px] text-destructive ml-[34px] mt-1">
                {openaiError}
              </p>
            )}
          </div>

          {/* Connected provider list */}
          {sorted.length > 0 ? (
            sorted.map((provider, index) => (
              <div
                key={provider.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`py-2.5 px-1 border-b border-border/30 last:border-b-0 transition-opacity ${
                  dragIndex === index ? 'opacity-40' : ''
                } ${overIndex === index && dragIndex !== index ? 'border-t-2 border-t-primary' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
                    title={isZh ? '拖拽排序' : 'Drag to reorder'}
                  >
                    <DotsSixVertical size={14} />
                  </div>
                  <div className="shrink-0 w-[22px] flex justify-center">
                    {getProviderIcon(provider.name, provider.base_url)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{provider.name}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {provider.api_key
                          ? (findMatchingPreset(provider)?.authStyle === 'auth_token' ? "Auth Token" : "API Key")
                          : t('provider.configured')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Edit"
                      onClick={() => handleEdit(provider)}
                    >
                      <PencilSimple size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(provider)}
                    >
                      {t('provider.disconnect')}
                    </Button>
                  </div>
                </div>
                {/* Provider options — thinking/1M for Anthropic-official only */}
                {provider.provider_type !== 'gemini-image' && provider.base_url === 'https://api.anthropic.com' && (
                  <ProviderOptionsSection
                    providerId={provider.id}
                    showThinkingOptions
                    indent={60}
                  />
                )}
                {/* Gemini Image model selector — capsule buttons */}
                {provider.provider_type === 'gemini-image' && (
                  <div className="ml-[60px] mt-2 flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground mr-1">{isZh ? '模型' : 'Model'}:</span>
                    {GEMINI_IMAGE_MODELS.map((m) => {
                      const isActive = getGeminiImageModel(provider) === m.value;
                      return (
                        <Button
                          key={m.value}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEnvModelChange(provider, 'GEMINI_IMAGE_MODEL', m.value)}
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border h-auto ${
                            isActive
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-accent/50'
                          }`}
                        >
                          {m.label}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {/* MiniMax Chat provider quota (shows all models) */}
                {provider.provider_type !== 'minimax-media' &&
                  (provider.base_url?.includes('minimaxi.com') || provider.base_url?.includes('minimax.io')) && (
                  <div className="ml-[60px] mt-1.5">
                    {renderMinimaxQuota(provider.id)}
                  </div>
                )}
                {/* MiniMax Media model selectors + quota */}
                {provider.provider_type === 'minimax-media' && (
                  <div className="ml-[60px] mt-2 space-y-1.5">
                    {/* Image model */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground w-16">{isZh ? '图片模型' : 'Image'}:</span>
                      {MINIMAX_IMAGE_MODELS.map((m) => {
                        const isActive = getMinimaxImageModel(provider) === m.value;
                        return (
                          <Button
                            key={m.value}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEnvModelChange(provider, 'MINIMAX_IMAGE_MODEL', m.value)}
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border h-auto ${
                              isActive
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-accent/50'
                            }`}
                          >
                            {m.label}
                          </Button>
                        );
                      })}
                    </div>
                    {/* Video model */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground w-16">{isZh ? '视频模型' : 'Video'}:</span>
                      {MINIMAX_VIDEO_MODELS.map((m) => {
                        const isActive = getMinimaxVideoModel(provider) === m.value;
                        return (
                          <Button
                            key={m.value}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEnvModelChange(provider, 'MINIMAX_VIDEO_MODEL', m.value)}
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border h-auto ${
                              isActive
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-accent/50'
                            }`}
                          >
                            {m.label}
                          </Button>
                        );
                      })}
                    </div>
                    {/* Quota row — image + video models */}
                    {renderMinimaxQuota(provider.id, m =>
                      m.modelName.startsWith('image-') || m.modelName.startsWith('MiniMax-Hailuo'),
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            Object.keys(envDetected).length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                {t('provider.noConnected')}
              </p>
            )
          )}
        </div>
      )}

      {/* ─── Section 2: Add Provider (Quick Presets) ─── */}
      {!loading && (
        <div className="rounded-lg border border-border/50 p-4">
          <h3 className="text-sm font-medium mb-1">{t('provider.addProviderSection')}</h3>
          <p className="text-xs text-muted-foreground mb-3">
            {t('provider.addProviderDesc')}
          </p>

          {/* Chat Providers */}
          <div className="mb-1">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('provider.chatProviders')}
            </h4>
            {QUICK_PRESETS.filter((p) => p.category !== "media").map((preset) => (
              <div
                key={preset.key}
                className="flex items-center gap-3 py-2.5 px-1 border-b border-border/30 last:border-b-0"
              >
                <div className="shrink-0 w-[22px] flex justify-center">{preset.icon}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{preset.name}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {isZh ? preset.descriptionZh : preset.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0 gap-1"
                  onClick={() => handleOpenPresetDialog(preset)}
                >
                  + {t('provider.connect')}
                </Button>
              </div>
            ))}
          </div>

          {/* Media Providers */}
          <div className="mt-4 pt-3 border-t border-border/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('provider.mediaProviders')}
            </h4>
            {QUICK_PRESETS.filter((p) => p.category === "media").map((preset) => (
              <div
                key={preset.key}
                className="flex items-center gap-3 py-2.5 px-1 border-b border-border/30 last:border-b-0"
              >
                <div className="shrink-0 w-[22px] flex justify-center">{preset.icon}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{preset.name}</span>
                  <p className="text-xs text-muted-foreground truncate">
                    {isZh ? preset.descriptionZh : preset.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0 gap-1"
                  onClick={() => handleOpenPresetDialog(preset)}
                >
                  + {t('provider.connect')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit dialog (full form for editing existing providers) */}
      <ProviderForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="edit"
        provider={editingProvider}
        onSave={handleEditSave}
        initialPreset={null}
      />

      {/* Preset connect/edit dialog */}
      <PresetConnectDialog
        preset={connectPreset}
        open={connectDialogOpen}
        onOpenChange={(open) => {
          setConnectDialogOpen(open);
          if (!open) setPresetEditProvider(null);
        }}
        onSave={presetEditProvider ? handleEditSave : handlePresetAdd}
        editProvider={presetEditProvider}
      />

      {/* Provider Doctor dialog */}
      <ProviderDoctorDialog open={doctorOpen} onOpenChange={setDoctorOpen} />

      {/* Disconnect confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('provider.disconnectProvider')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('provider.disconnectConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? t('provider.disconnecting') : t('provider.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
