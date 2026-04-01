"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { RemoteHost } from "@/types";

interface AddHostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  editHost?: RemoteHost | null;
}

type AuthType = "key" | "password";

export function AddHostDialog({
  open,
  onOpenChange,
  onComplete,
  editHost,
}: AddHostDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<AuthType>("key");
  const [keyPath, setKeyPath] = useState("");
  const [password, setPassword] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      if (editHost) {
        setName(editHost.name);
        setHost(editHost.host);
        setPort(String(editHost.port));
        setUsername(editHost.username);
        setAuthType(editHost.authType);
        setKeyPath(editHost.keyPath ?? "");
        setPassword("");
        setWorkDir(editHost.workDir);
      } else {
        setName("");
        setHost("");
        setPort("22");
        setUsername("");
        setAuthType("key");
        setKeyPath("");
        setPassword("");
        setWorkDir("~");
      }
      setSubmitting(false);
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [open, editHost]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !host.trim() || !username.trim() || !workDir.trim()) {
      setError("Name, host, username and work directory are required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        authType,
        workDir: workDir.trim(),
      };
      if (authType === "key" && keyPath.trim()) {
        body.keyPath = keyPath.trim();
      }
      if (authType === "password" && password) {
        body.password = password;
      }

      const url = editHost
        ? `/api/remote/hosts/${editHost.id}`
        : "/api/remote/hosts";
      const method = editHost ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      onComplete();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save host");
    } finally {
      setSubmitting(false);
    }
  }, [
    name, host, port, username, authType, keyPath, password, workDir,
    editHost, onComplete, onOpenChange,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const isEditing = !!editHost;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Remote Host" : t("remoteHost.addHost")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the SSH connection settings for this host."
              : "Configure SSH connection settings for a remote host."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="rh-name">{t("remoteHost.form.name")}</Label>
            <Input
              id="rh-name"
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="My Remote Server"
            />
          </div>

          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="rh-host">{t("remoteHost.form.host")}</Label>
              <Input
                id="rh-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rh-port">{t("remoteHost.form.port")}</Label>
              <Input
                id="rh-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                onKeyDown={handleKeyDown}
                type="number"
                min={1}
                max={65535}
              />
            </div>
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <Label htmlFor="rh-username">{t("remoteHost.form.username")}</Label>
            <Input
              id="rh-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ubuntu"
            />
          </div>

          {/* Auth Type */}
          <div className="space-y-1.5">
            <Label>{t("remoteHost.form.authType")}</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="authType"
                  value="key"
                  checked={authType === "key"}
                  onChange={() => setAuthType("key")}
                  className="accent-primary"
                />
                {t("remoteHost.form.authKey")}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="authType"
                  value="password"
                  checked={authType === "password"}
                  onChange={() => setAuthType("password")}
                  className="accent-primary"
                />
                {t("remoteHost.form.authPassword")}
              </label>
            </div>
          </div>

          {/* Key path or password */}
          {authType === "key" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rh-keypath">{t("remoteHost.form.keyPath")}</Label>
              <Input
                id="rh-keypath"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="~/.ssh/id_rsa (leave blank for default)"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rh-password">{t("remoteHost.form.password")}</Label>
              <Input
                id="rh-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="••••••••"
              />
            </div>
          )}

          {/* Work Directory */}
          <div className="space-y-1.5">
            <Label htmlFor="rh-workdir">{t("remoteHost.form.workDir")}</Label>
            <Input
              id="rh-workdir"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="~"
            />
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <SpinnerGap size={14} className="animate-spin" />}
            {isEditing ? "Save Changes" : t("remoteHost.addHost")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
