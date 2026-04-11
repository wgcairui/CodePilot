"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

interface ProviderModelGroup {
  provider_id: string;
  provider_name: string;
  models: Array<{ value: string; label: string }>;
}

interface LogAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogAnalysisDialog({ open, onOpenChange }: LogAnalysisDialogProps) {
  const { t } = useTranslation();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);

  // Provider/model selection state
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Track the log content so re-analyze doesn't re-read the file
  const logContentRef = useRef<string | null>(null);

  // Load providers once when dialog opens
  useEffect(() => {
    if (!open) return;
    setAnalysis(null);
    logContentRef.current = null;

    fetch("/api/providers/models")
      .then(r => r.json())
      .then(data => {
        const groups: ProviderModelGroup[] = data.groups || [];
        setProviderGroups(groups);

        const defaultPid: string = data.default_provider_id || "";
        const defaultGroup = groups.find(g => g.provider_id === defaultPid) || groups[0];
        if (defaultGroup) {
          setSelectedProviderId(defaultGroup.provider_id);
          setSelectedModel(defaultGroup.models[0]?.value ?? "");
        }
      })
      .catch(() => {
        // Providers unavailable — API will fall back to resolveProvider()
      });
  }, [open]);

  const handleProviderChange = (pid: string) => {
    setSelectedProviderId(pid);
    const group = providerGroups.find(g => g.provider_id === pid);
    setSelectedModel(group?.models[0]?.value ?? "");
  };

  const runAnalysis = useCallback(async (content: string) => {
    setAnalyzing(true);
    try {
      const body: Record<string, string> = { content };
      if (selectedProviderId) body.providerId = selectedProviderId;
      if (selectedModel) body.model = selectedModel;

      const response = await fetch("/api/ai/analyze-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      setAnalysis(result.analysis);
      showToast({ type: "success", message: t("remoteHost.analyzeLog.success") });
    } catch (err) {
      console.error("[remote] log analysis failed:", err);
      showToast({ type: "error", message: t("remoteHost.analyzeLog.error") });
    } finally {
      setAnalyzing(false);
    }
  }, [selectedProviderId, selectedModel, t]);

  // Auto-analyze on open once providers are loaded and log is available
  useEffect(() => {
    if (!open || analyzing || analysis || !selectedProviderId) return;

    const startAnalysis = async () => {
      if (!window.electronAPI?.log) {
        showToast({ type: "error", message: "Log API not available" });
        return;
      }

      if (!logContentRef.current) {
        const files = await window.electronAPI.log.list();
        const remoteLog = files.find(f => f.startsWith("remote-"));
        if (!remoteLog) {
          showToast({ type: "error", message: t("remoteHost.analyzeLog.noFile") });
          onOpenChange(false);
          return;
        }
        const content = await window.electronAPI.log.read(remoteLog);
        if (!content) {
          showToast({ type: "error", message: t("remoteHost.analyzeLog.error") });
          onOpenChange(false);
          return;
        }
        logContentRef.current = content;
      }

      runAnalysis(logContentRef.current);
    };

    startAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedProviderId]);

  const handleReanalyze = useCallback(() => {
    if (logContentRef.current) runAnalysis(logContentRef.current);
  }, [runAnalysis]);

  const handleClose = useCallback(() => {
    setAnalysis(null);
    logContentRef.current = null;
    onOpenChange(false);
  }, [onOpenChange]);

  const selectedGroup = providerGroups.find(g => g.provider_id === selectedProviderId);
  const models = selectedGroup?.models ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t("remoteHost.analyzeLog.dialog.title")}</DialogTitle>
        </DialogHeader>

        {/* Model selector row */}
        {providerGroups.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground shrink-0">
              {t("remoteHost.analyzeLog.dialog.provider")}
            </span>
            <Select
              value={selectedProviderId}
              onValueChange={handleProviderChange}
              disabled={analyzing}
            >
              <SelectTrigger size="sm" className="w-full max-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerGroups.map(g => (
                  <SelectItem key={g.provider_id} value={g.provider_id}>
                    {g.provider_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground shrink-0">
              {t("remoteHost.analyzeLog.dialog.model")}
            </span>
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={analyzing}
            >
              <SelectTrigger size="sm" className="w-full max-w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-sm">
                {models.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Analysis result */}
        <div className="flex-1 min-h-0 p-4 bg-background rounded border overflow-y-auto min-h-[300px]">
          {analyzing ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <SpinnerGap size={16} className="animate-spin" />
              {t("remoteHost.analyzeLog.analyzing")}
            </div>
          ) : analysis ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{analysis}</div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              {t("remoteHost.analyzeLog.analyzing")}
            </div>
          )}
        </div>

        <DialogFooter>
          {analysis && !analyzing && (
            <Button variant="outline" onClick={handleReanalyze}>
              {t("remoteHost.analyzeLog.dialog.reanalyze")}
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            {t("remoteHost.analyzeLog.dialog.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
