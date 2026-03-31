"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, GitCommit, CloudArrowUp, Sparkle, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface CommitDialogProps {
  cwd: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type CommitMode = "commit" | "commit-and-push";

export function CommitDialog({ cwd, open, onClose, onSuccess }: CommitDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<CommitMode>("commit");
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMessage("");
      setError(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleGenerate = useCallback(async () => {
    if (!cwd || generating || committing) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/git/generate-commit-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setMessage(data.message || "");
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [cwd, generating, committing]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || !cwd || committing) return;
    setCommitting(true);
    setError(null);
    try {
      // Commit (45s timeout covers git add + commit + pre-commit hooks)
      const commitAbort = AbortSignal.timeout(45_000);
      const commitRes = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, message: trimmed }),
        signal: commitAbort,
      });
      if (!commitRes.ok) {
        const data = await commitRes.json();
        throw new Error(data.error || "Commit failed");
      }

      // Push if selected
      if (mode === "commit-and-push") {
        const pushAbort = AbortSignal.timeout(60_000);
        const pushRes = await fetch("/api/git/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd }),
          signal: pushAbort,
        });
        if (!pushRes.ok) {
          const data = await pushRes.json();
          throw new Error(data.error || "Push failed");
        }
      }

      setMessage("");
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setCommitting(false);
    }
  }, [cwd, message, mode, committing, onClose, onSuccess]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-[420px] rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h3 className="text-sm font-semibold">{t('git.commitAll')}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('git.commitMessage')}
              disabled={generating}
              className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 pr-9 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || committing}
              title="AI 生成提交信息"
              className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? (
                <SpinnerGap size={13} className="animate-spin" />
              ) : (
                <Sparkle size={13} />
              )}
            </button>
          </div>

          {/* Mode selector */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="commit-mode"
                checked={mode === "commit"}
                onChange={() => setMode("commit")}
                className="accent-primary"
              />
              <GitCommit size={14} className="text-muted-foreground" />
              {t('topBar.commit')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="commit-mode"
                checked={mode === "commit-and-push"}
                onChange={() => setMode("commit-and-push")}
                className="accent-primary"
              />
              <CloudArrowUp size={14} className="text-muted-foreground" />
              {t('git.commitAndPush')}
            </label>
          </div>

          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!message.trim() || committing}
            onClick={handleSubmit}
          >
            {mode === "commit-and-push" ? (
              <CloudArrowUp size={14} className="mr-1.5" />
            ) : (
              <GitCommit size={14} className="mr-1.5" />
            )}
            {committing
              ? t('git.loading')
              : mode === "commit-and-push"
                ? t('git.commitAndPush')
                : t('git.commitAll')
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
