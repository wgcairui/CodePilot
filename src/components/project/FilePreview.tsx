"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Copy, Check, SpinnerGap, PencilSimple, Eye } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "next-themes";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeFamily } from "@/lib/theme/context";
import { resolveCodeTheme, resolveHljsStyle } from "@/lib/theme/code-themes";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import type { FilePreview as FilePreviewType } from "@/types";

const CodeMirrorEditor = dynamic(
  () => import("./CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor })),
  { ssr: false }
);

function useFilePreviewCodeTheme() {
  const { resolvedTheme } = useTheme();
  const { family, families } = useThemeFamily();
  const isDark = resolvedTheme === "dark";
  const codeTheme = resolveCodeTheme(families, family);
  return resolveHljsStyle(codeTheme, isDark);
}

interface FilePreviewProps {
  filePath: string;
  onBack: () => void;
}

export function FilePreview({ filePath, onBack }: FilePreviewProps) {
  const { workingDirectory } = usePanel();
  const { t } = useTranslation();
  const hljsStyle = useFilePreviewCodeTheme();
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editContent, setEditContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    async function loadPreview() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t('filePreview.failedToLoad'));
        }
        const data = await res.json();
        setPreview(data.preview);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('filePreview.failedToLoad'));
      } finally {
        setLoading(false);
      }
    }

    loadPreview();
  }, [filePath, t, workingDirectory]);

  const handleCopyPath = async () => {
    await navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEnterEdit = useCallback(async () => {
    const res = await fetch(
      `/api/files/raw?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ""}`
    );
    if (!res.ok) return;
    const text = await res.text();
    setEditContent(text);
    setIsDirty(false);
    setSaveStatus("idle");
    setMode("edit");
  }, [filePath, workingDirectory]);

  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    if (!workingDirectory) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
      return;
    }
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: editContent, baseDir: workingDirectory }),
      });
      if (!res.ok) throw new Error("write failed");
      setIsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [isDirty, workingDirectory, filePath, editContent]);

  useEffect(() => {
    if (mode !== "edit") return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mode, handleSave]);

  // Build breadcrumb segments
  const segments = filePath.split("/").filter(Boolean);
  const displaySegments = segments.slice(-3); // show last 3 segments

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          <span className="sr-only">{t('filePreview.backToTree')}</span>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {displaySegments.length < segments.length && ".../"}{displaySegments.join("/")}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleCopyPath}>
          {copied ? (
            <Check size={14} className="text-status-success-foreground" />
          ) : (
            <Copy size={14} />
          )}
          <span className="sr-only">{t('filePreview.copyPath')}</span>
        </Button>

        {/* 编辑/预览切换 */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={mode === "view" ? handleEnterEdit : () => { setMode("view"); setIsDirty(false); }}
          title={mode === "view" ? t("filePreview.edit") : t("filePreview.viewMode")}
        >
          {mode === "view" ? <PencilSimple size={14} /> : <Eye size={14} />}
        </Button>

        {/* 保存按钮（仅编辑模式显示） */}
        {mode === "edit" && (
          <Button
            variant={isDirty ? "default" : "ghost"}
            size="sm"
            onClick={handleSave}
            disabled={saveStatus === "saving" || !isDirty}
            className="h-6 px-2 text-xs"
          >
            {saveStatus === "saving"
              ? t("filePreview.saving")
              : saveStatus === "saved"
              ? t("filePreview.saved")
              : saveStatus === "error"
              ? t("filePreview.saveError")
              : isDirty
              ? `· ${t("filePreview.save")}`
              : t("filePreview.save")}
          </Button>
        )}
      </div>

      {/* File info */}
      {preview && (
        <div className="flex items-center gap-2 pb-2">
          <Badge variant="secondary" className="text-[10px]">
            {preview.language}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {preview.line_count_exact === false
              ? t('filePreview.linesApprox', { count: preview.line_count })
              : t('filePreview.lines', { count: preview.line_count })}
          </span>
          {mode === "edit" && isDirty && (
            <span className="text-[10px] text-status-warning-foreground">
              {t("filePreview.unsavedChanges")}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {mode === "edit" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeMirrorEditor
            value={editContent}
            onChange={(val) => {
              setEditContent(val);
              setIsDirty(true);
            }}
            language={preview?.language ?? ""}
            isDark={isDark}
            className="h-full"
          />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-4 text-center">
              <p className="text-xs text-destructive">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="mt-2 text-xs"
              >
                {t('filePreview.backToTree')}
              </Button>
            </div>
          ) : preview ? (
            <div className="rounded-md border border-border text-xs">
              <SyntaxHighlighter
                language={preview.language}
                style={hljsStyle}
                showLineNumbers
                customStyle={{
                  margin: 0,
                  padding: "8px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  lineHeight: "1.5",
                }}
                lineNumberStyle={{
                  minWidth: "2.5em",
                  paddingRight: "8px",
                  color: "var(--muted-foreground)",
                  opacity: 0.5,
                  userSelect: "none",
                }}
              >
                {preview.content}
              </SyntaxHighlighter>
            </div>
          ) : null}
        </ScrollArea>
      )}
    </div>
  );
}
