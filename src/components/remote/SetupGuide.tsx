"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Copy } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";

export interface CheckResult {
  os: "Darwin" | "Linux" | "unknown";
  nodeVersion: string | null;
  claudeVersion: string | null;
  agentVersion: string | null;
}

export interface InstallPlan {
  needsNode: boolean;
  needsClaude: boolean;
  needsAgentDeploy: boolean;
  nodeCommands: string[];
  claudeCommands: string[];
}

interface SetupGuideProps {
  checkResult: CheckResult;
  installPlan: InstallPlan;
  onAutoInstall?: () => void;
  onRetry?: () => void;
}

interface CommandBlockProps {
  commands: string[];
}

function CommandBlock({ commands }: CommandBlockProps) {
  const handleCopy = useCallback(
    (cmd: string) => {
      navigator.clipboard.writeText(cmd).catch(() => {});
      showToast({ type: "success", message: "Copied to clipboard" });
    },
    []
  );

  return (
    <div className="space-y-1">
      {commands.map((cmd, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5"
        >
          <code className="flex-1 text-xs font-mono break-all">{cmd}</code>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => handleCopy(cmd)}
            title="Copy"
          >
            <Copy size={12} />
          </Button>
        </div>
      ))}
    </div>
  );
}

interface StatusRowProps {
  label: string;
  value: string | null;
  ok: boolean;
}

function StatusRow({ label, value, ok }: StatusRowProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle size={16} className="text-status-success shrink-0" />
      ) : (
        <XCircle size={16} className="text-destructive shrink-0" />
      )}
      <span className="text-muted-foreground">{label}:</span>
      <span className={ok ? "text-foreground" : "text-destructive"}>
        {value ?? "Not found"}
      </span>
    </div>
  );
}

export function SetupGuide({
  checkResult,
  installPlan,
  onAutoInstall,
  onRetry,
}: SetupGuideProps) {
  const { t } = useTranslation();

  const allOk =
    !installPlan.needsNode &&
    !installPlan.needsClaude &&
    !installPlan.needsAgentDeploy;

  return (
    <div className="space-y-4 text-sm">
      {/* Detection results */}
      <div className="rounded-lg border border-border/50 p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Remote Environment
        </p>
        <StatusRow
          label="OS"
          value={checkResult.os === "unknown" ? "Unknown" : checkResult.os}
          ok={checkResult.os !== "unknown"}
        />
        <StatusRow
          label="Node.js"
          value={checkResult.nodeVersion}
          ok={!!checkResult.nodeVersion}
        />
        <StatusRow
          label="Claude CLI"
          value={checkResult.claudeVersion}
          ok={!!checkResult.claudeVersion}
        />
        <StatusRow
          label="Agent"
          value={checkResult.agentVersion}
          ok={!!checkResult.agentVersion}
        />
      </div>

      {allOk ? (
        <div className="flex items-center gap-2 rounded-lg bg-status-success/10 px-3 py-2">
          <CheckCircle size={16} className="text-status-success shrink-0" />
          <p className="text-status-success font-medium">
            Remote environment is ready
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {installPlan.needsNode && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">
                {t("remoteHost.setup.nodeInstall")}
              </p>
              <CommandBlock commands={installPlan.nodeCommands} />
            </div>
          )}

          {installPlan.needsClaude && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">
                {t("remoteHost.setup.claudeInstall")}
              </p>
              <CommandBlock commands={installPlan.claudeCommands} />
            </div>
          )}

          {installPlan.needsAgentDeploy && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {t("remoteHost.setup.agentDeploy")} — will be deployed automatically
              </p>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        {!allOk && onAutoInstall && (
          <Button size="sm" onClick={onAutoInstall}>
            {t("remoteHost.setup.installAuto")}
          </Button>
        )}
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("remoteHost.setup.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}
