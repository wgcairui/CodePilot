"use client";

import { useState, useCallback } from "react";
import { GitBranch, GitCommit, CloudArrowUp, ArrowUp, ArrowLeft, Plus, Minus, ArrowsCounterClockwise, Trash } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import { usePanel } from "@/hooks/usePanel";
import { showToast } from "@/hooks/useToast";
import { CommitDialog } from "./CommitDialog";
import type { GitStatus, GitChangedFile } from "@/types";

interface GitStatusSectionProps {
  status: GitStatus;
}

export function GitStatusSection({ status }: GitStatusSectionProps) {
  const { t } = useTranslation();
  const { workingDirectory } = usePanel();
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [pushing, setPushing] = useState(false);

  const handlePush = useCallback(async () => {
    if (!workingDirectory || pushing) return;
    setPushing(true);
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workingDirectory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Push failed' }));
        showToast({ type: 'error', message: data.error || 'Push failed' });
        return;
      }
      showToast({ type: 'success', message: t('git.pushSuccess') });
      window.dispatchEvent(new CustomEvent('git-refresh'));
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Push failed' });
    } finally {
      setPushing(false);
    }
  }, [workingDirectory, pushing, t]);

  const handleCommitSuccess = useCallback(() => {
    window.dispatchEvent(new CustomEvent('git-refresh'));
  }, []);

  if (!status.isRepo) {
    return (
      <div className="px-3 py-4 text-sm text-muted-foreground text-center">
        {t('git.notARepo')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Branch + upstream */}
      <div className="flex items-center gap-2 px-3">
        <GitBranch size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{status.branch || t('git.noBranch')}</span>
        {status.upstream && (
          <span className="text-[11px] text-muted-foreground truncate">
            → {status.upstream}
          </span>
        )}
      </div>

      {/* Ahead / behind */}
      {(status.ahead > 0 || status.behind > 0) && (
        <div className="flex items-center gap-3 px-3">
          {status.ahead > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
              <ArrowUp size={12} />
              {t('git.ahead', { count: String(status.ahead) })}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-orange-600 dark:text-orange-400">
              <ArrowLeft size={12} />
              {t('git.behind', { count: String(status.behind) })}
            </span>
          )}
        </div>
      )}

      {/* Changed files — grouped by staging area / workspace */}
      {(() => {
        const staged = status.changedFiles.filter(f => f.staged);
        // Unstaged includes both tracked unstaged + untracked
        const unstaged = status.changedFiles.filter(f => !f.staged);

        if (staged.length === 0 && unstaged.length === 0) {
          return (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t('git.allCommitted')}
            </div>
          );
        }

        const refresh = () => window.dispatchEvent(new CustomEvent('git-refresh'));
        return (
          <div className="space-y-2">
            {staged.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
                  {t('git.staged')} ({staged.length})
                </div>
                <div className="max-h-[180px] overflow-y-auto">
                  {staged.map((file, i) => (
                    <FileChangeItem key={`staged-${file.path}-${i}`} file={file} cwd={workingDirectory} onRefresh={refresh} />
                  ))}
                </div>
              </div>
            )}
            {unstaged.length > 0 && (
              <div className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('git.unstaged')} ({unstaged.length})
                </div>
                <div className="max-h-[180px] overflow-y-auto">
                  {unstaged.map((file, i) => (
                    <FileChangeItem key={`unstaged-${file.path}-${i}`} file={file} cwd={workingDirectory} onRefresh={refresh} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Commit & Push actions */}
      <div className="flex items-center gap-2 px-3 pt-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={() => setCommitDialogOpen(true)}
          disabled={!status.dirty}
        >
          <GitCommit size={14} />
          {t('topBar.commit')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 flex-1"
          onClick={handlePush}
          disabled={pushing}
        >
          <CloudArrowUp size={14} />
          {pushing ? t('git.loading') : t('topBar.push')}
        </Button>
      </div>

      <CommitDialog
        cwd={workingDirectory}
        open={commitDialogOpen}
        onClose={() => setCommitDialogOpen(false)}
        onSuccess={handleCommitSuccess}
      />
    </div>
  );
}

interface FileChangeItemProps {
  file: GitChangedFile;
  cwd: string;
  onRefresh: () => void;
}

function FileChangeItem({ file, cwd, onRefresh }: FileChangeItemProps) {
  const [loading, setLoading] = useState(false);

  const statusColors: Record<string, string> = {
    modified: 'text-amber-500',
    added: 'text-green-500',
    deleted: 'text-red-500',
    renamed: 'text-blue-500',
    copied: 'text-blue-500',
    untracked: 'text-muted-foreground',
  };

  const statusLetters: Record<string, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: '?',
  };

  const callApi = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    if (loading || !cwd) return;
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, path: file.path, ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast({ type: 'error', message: data.error || 'Operation failed' });
        return;
      }
      onRefresh();
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : 'Operation failed' });
    } finally {
      setLoading(false);
    }
  }, [loading, cwd, file.path, onRefresh]);

  const handleStage = () => callApi('/api/git/stage', {});
  const handleUnstage = () => callApi('/api/git/unstage', {});
  const handleDiscard = () => {
    const isUntracked = file.status === 'untracked';
    const msg = isUntracked
      ? `删除未跟踪文件 "${file.path}"？此操作不可撤销。`
      : `撤销 "${file.path}" 的修改？未提交的改动将丢失。`;
    if (!window.confirm(msg)) return;
    callApi('/api/git/discard', { untracked: isUntracked });
  };

  return (
    <div className="group flex items-center gap-2 px-3 py-0.5 text-[12px] hover:bg-muted/50">
      <span className={`shrink-0 font-mono ${statusColors[file.status] || 'text-muted-foreground'}`}>
        {statusLetters[file.status] || '?'}
      </span>
      <span className="truncate text-foreground/80 flex-1 min-w-0">{file.path}</span>

      {/* Action buttons — visible on hover */}
      <div className={`shrink-0 flex items-center gap-0.5 ${loading ? 'opacity-50' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
        {file.staged ? (
          // Staged: unstage only
          <ActionButton title="取消暂存" onClick={handleUnstage} disabled={loading}>
            <Minus size={11} />
          </ActionButton>
        ) : (
          <>
            {/* Unstaged tracked or untracked: stage + discard */}
            <ActionButton title="暂存" onClick={handleStage} disabled={loading}>
              <Plus size={11} />
            </ActionButton>
            <ActionButton
              title={file.status === 'untracked' ? '删除文件' : '撤销修改'}
              onClick={handleDiscard}
              disabled={loading}
              destructive
            >
              {file.status === 'untracked' ? <Trash size={11} /> : <ArrowsCounterClockwise size={11} />}
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  disabled,
  destructive = false,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className={`flex items-center justify-center w-4 h-4 rounded transition-colors disabled:cursor-not-allowed
        ${destructive
          ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
    >
      {children}
    </button>
  );
}
