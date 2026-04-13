// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
  },
  shell: {
    openPath: (folderPath: string) => ipcRenderer.invoke('shell:open-path', folderPath),
  },
  dialog: {
    openFolder: (options?: { defaultPath?: string; title?: string }) =>
      ipcRenderer.invoke('dialog:open-folder', options),
  },
  install: {
    checkPrerequisites: () => ipcRenderer.invoke('install:check-prerequisites'),
    start: () => ipcRenderer.invoke('install:start'),
    cancel: () => ipcRenderer.invoke('install:cancel'),
    getLogs: () => ipcRenderer.invoke('install:get-logs'),
    installGit: () => ipcRenderer.invoke('install:git'),
    onProgress: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('install:progress', listener);
      return () => { ipcRenderer.removeListener('install:progress', listener); };
    },
  },
  bridge: {
    isActive: () => ipcRenderer.invoke('bridge:is-active'),
  },
  proxy: {
    resolve: (url: string) => ipcRenderer.invoke('proxy:resolve', url),
  },
  widget: {
    exportPng: (html: string, width: number, isDark: boolean) =>
      ipcRenderer.invoke('widget:export-png', { html, width, isDark }),
  },
  terminal: {
    create: (opts: { id: string; cwd: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:create', opts),
    write: (id: string, data: string) =>
      ipcRenderer.send('terminal:write', { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    kill: (id: string) =>
      ipcRenderer.invoke('terminal:kill', id),
    onData: (callback: (data: { id: string; data: string }) => void) => {
      const listener = (_event: unknown, data: { id: string; data: string }) => callback(data);
      ipcRenderer.on('terminal:data', listener);
      return () => { ipcRenderer.removeListener('terminal:data', listener); };
    },
    onExit: (callback: (data: { id: string; code: number }) => void) => {
      const listener = (_event: unknown, data: { id: string; code: number }) => callback(data);
      ipcRenderer.on('terminal:exit', listener);
      return () => { ipcRenderer.removeListener('terminal:exit', listener); };
    },
    onNewTab: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('terminal:new-tab', handler);
      return () => ipcRenderer.removeListener('terminal:new-tab', handler);
    },
  },
  remote: {
    connect: (hostId: string) => ipcRenderer.invoke('remote:connect', hostId),
    disconnect: (hostId: string) => ipcRenderer.invoke('remote:disconnect', hostId),
    getStatus: (hostId: string) => ipcRenderer.invoke('remote:get-status', hostId),
    checkEnv: (hostId: string) => ipcRenderer.invoke('remote:check-env', hostId),
    deployAgent: (hostId: string) => ipcRenderer.invoke('remote:deploy-agent', hostId),
    autoInstallDeps: (hostId: string) => ipcRenderer.invoke('remote:auto-install-deps', hostId),
    startAgent: (hostId: string, port: number) => ipcRenderer.invoke('remote:start-agent', hostId, port),
    isAgentRunning: (hostId: string, port: number) => ipcRenderer.invoke('remote:is-agent-running', hostId, port),
    agentSend: (hostId: string, msg: unknown) => ipcRenderer.invoke('remote:agent-send', hostId, msg),
    onStatusChanged: (cb: (state: unknown) => void) => {
      const l = (_e: unknown, d: unknown) => cb(d);
      ipcRenderer.on('remote:status-changed', l);
      return () => ipcRenderer.removeListener('remote:status-changed', l);
    },
    onAgentMessage: (cb: (data: { hostId: string; msg: unknown }) => void) => {
      const l = (_e: unknown, d: unknown) => cb(d as { hostId: string; msg: unknown });
      ipcRenderer.on('remote:agent-message', l);
      return () => ipcRenderer.removeListener('remote:agent-message', l);
    },
  },
  log: {
    list: () => ipcRenderer.invoke('log:list'),
    read: (fileName: string) => ipcRenderer.invoke('log:read', fileName),
    export: (fileName: string) => ipcRenderer.invoke('log:export', fileName),
  },
  notification: {
    show: (options: { title: string; body: string; onClick?: unknown }) =>
      ipcRenderer.invoke('notification:show', options),
    onClick: (callback: (action: { type: string; payload: string }) => void) => {
      const listener = (_event: unknown, action: { type: string; payload: string }) => callback(action);
      ipcRenderer.on('notification:click', listener);
      return () => { ipcRenderer.removeListener('notification:click', listener); };
    },
  },
});
