# Remote Host Connect Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 SSH 隧道连接远程 macOS/Linux 主机，在远端运行 claude CLI，本地 CodePilot UI 无感使用，断线时任务继续，重连后自动续流。

**Architecture:** Electron 主进程持有 SSH 连接（ssh2 库）并做端口转发；远程机器运行轻量 `agent.js`（esbuild 单文件打包）管理 claude CLI 进程和输出缓冲区；本地主进程通过 WebSocket 与 agent 通信，Next.js 层通过 IPC 代理调用。

**Tech Stack:** `ssh2`（SSH 连接）、`ws`（agent WebSocket 服务端）、`esbuild`（agent 打包）、Node.js built-in `net`（端口探测）、`electron.safeStorage`（密码加密）

> **安全说明：** `setup-checker.ts` 中通过 SSH protocol exec 向远程执行命令（非本地 `child_process.exec`）。端口号来自 DB 整数字段，命令参数均非用户直接输入，不存在注入风险。

---

## Chunk 1: Remote Agent

### Task 1: Remote Agent 项目结构 + 打包脚本

**Files:**
- Create: `remote-agent/src/index.ts`
- Create: `remote-agent/src/session-manager.ts`
- Create: `remote-agent/src/types.ts`
- Create: `remote-agent/build.ts`
- Create: `remote-agent/package.json`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p /Users/cairui/Code/CodePilot/remote-agent/src
```

- [ ] **Step 2: 创建 `remote-agent/package.json`**

```json
{
  "name": "codepilot-remote-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "npx tsx build.ts"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "tsx": "^4.0.0"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 3: 创建 `remote-agent/src/types.ts`**（Wire Protocol 类型）

```typescript
// Wire Protocol（client → agent）
export type ClientMessage =
  | { type: 'start_session'; sessionId: string; workDir: string; prompt: string }
  | { type: 'resume_session'; sessionId: string; lastEventId: number }
  | { type: 'abort_session'; sessionId: string }
  | { type: 'ping' };

// Wire Protocol（agent → client）
export type AgentMessage =
  | { type: 'event'; sessionId: string; eventId: number; event: unknown }
  | { type: 'buffered_events'; sessionId: string; events: Array<{ eventId: number; event: unknown }> }
  | { type: 'session_complete'; sessionId: string }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'session_not_found'; sessionId: string }
  | { type: 'session_taken'; sessionId: string }
  | { type: 'pong' };

export interface SessionState {
  sessionId: string;
  process: import('node:child_process').ChildProcess;
  buffer: Array<{ eventId: number; event: unknown; timestamp: number }>;
  nextEventId: number;
  clientWs: import('ws').WebSocket | null;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
}
```

- [ ] **Step 4: 创建 `remote-agent/src/session-manager.ts`**

```typescript
import { spawn } from 'node:child_process';
import type { SessionState } from './types.js';

const BUFFER_MAX_BYTES = 50 * 1024 * 1024; // 50MB
const BUFFER_TTL_MS = 5 * 60 * 1000;       // 5min

export class SessionManager {
  readonly sessions = new Map<string, SessionState>();

  start(sessionId: string, workDir: string, prompt: string, claudePath = 'claude'): SessionState {
    const proc = spawn(claudePath, ['--output-format', 'stream-json', '--print', prompt], {
      cwd: workDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state: SessionState = {
      sessionId,
      process: proc,
      buffer: [],
      nextEventId: 0,
      clientWs: null,
      status: 'running',
      startedAt: Date.now(),
    };
    this.sessions.set(sessionId, state);

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          const eventId = state.nextEventId++;
          state.buffer.push({ eventId, event, timestamp: Date.now() });
          this.trimBuffer(state);
          if (state.clientWs) {
            state.clientWs.send(JSON.stringify({ type: 'event', sessionId, eventId, event }));
          }
        } catch { /* 非 JSON 行忽略 */ }
      }
    });

    proc.on('close', (code) => {
      state.status = code === 0 ? 'completed' : 'error';
      if (state.clientWs) {
        const msg = state.status === 'completed'
          ? { type: 'session_complete', sessionId }
          : { type: 'session_error', sessionId, error: `Exit code ${code}` };
        state.clientWs.send(JSON.stringify(msg));
      }
    });

    return state;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  abort(sessionId: string): void {
    this.sessions.get(sessionId)?.process.kill('SIGTERM');
  }

  getBufferedSince(sessionId: string, lastEventId: number): Array<{ eventId: number; event: unknown }> {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    return state.buffer
      .filter(e => e.eventId > lastEventId)
      .map(({ eventId, event }) => ({ eventId, event }));
  }

  private trimBuffer(state: SessionState): void {
    const now = Date.now();
    state.buffer = state.buffer.filter(e => now - e.timestamp < BUFFER_TTL_MS);
    let totalBytes = 0;
    for (let i = state.buffer.length - 1; i >= 0; i--) {
      totalBytes += JSON.stringify(state.buffer[i]).length;
      if (totalBytes > BUFFER_MAX_BYTES) {
        state.buffer = state.buffer.slice(i + 1);
        break;
      }
    }
  }
}
```

- [ ] **Step 5: 创建 `remote-agent/src/index.ts`**

```typescript
// CODEPILOT_AGENT_VERSION=0.1.0
import { WebSocketServer, WebSocket } from 'ws';
import { SessionManager } from './session-manager.js';
import type { ClientMessage } from './types.js';

const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1]) : 39099;

const manager = new SessionManager();
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

console.log(`[codepilot-agent] Listening on 127.0.0.1:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw: Buffer) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'start_session': {
        const existing = manager.get(msg.sessionId);
        if (existing) {
          if (existing.clientWs) {
            ws.send(JSON.stringify({ type: 'session_taken', sessionId: msg.sessionId }));
            return;
          }
          existing.clientWs = ws;
          const buffered = manager.getBufferedSince(msg.sessionId, -1);
          ws.send(JSON.stringify({ type: 'buffered_events', sessionId: msg.sessionId, events: buffered }));
        } else {
          const state = manager.start(msg.sessionId, msg.workDir, msg.prompt);
          state.clientWs = ws;
        }
        break;
      }

      case 'resume_session': {
        const state = manager.get(msg.sessionId);
        if (!state) {
          ws.send(JSON.stringify({ type: 'session_not_found', sessionId: msg.sessionId }));
          return;
        }
        if (state.clientWs && state.clientWs !== ws) {
          ws.send(JSON.stringify({ type: 'session_taken', sessionId: msg.sessionId }));
          return;
        }
        state.clientWs = ws;
        const buffered = manager.getBufferedSince(msg.sessionId, msg.lastEventId);
        ws.send(JSON.stringify({ type: 'buffered_events', sessionId: msg.sessionId, events: buffered }));
        if (state.status !== 'running') {
          const termMsg = state.status === 'completed'
            ? { type: 'session_complete', sessionId: msg.sessionId }
            : { type: 'session_error', sessionId: msg.sessionId, error: 'Process already exited' };
          ws.send(JSON.stringify(termMsg));
        }
        break;
      }

      case 'abort_session':
        manager.abort(msg.sessionId);
        break;
    }
  });

  ws.on('close', () => {
    for (const state of manager.sessions.values()) {
      if (state.clientWs === ws) state.clientWs = null;
    }
  });
});
```

- [ ] **Step 6: 创建 `remote-agent/build.ts`**

```typescript
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;

// esbuild banner 写入版本号（供 SetupChecker 用 head -1 读取）
fs.mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/agent.js',
  banner: {
    js: `// CODEPILOT_AGENT_VERSION=${version}`,
  },
});

console.log(`Built dist/agent.js (v${version})`);
```

- [ ] **Step 7: 安装依赖并构建**

```bash
cd /Users/cairui/Code/CodePilot/remote-agent
npm install
npm run build
```

预期输出：`Built dist/agent.js (v0.1.0)`

- [ ] **Step 8: 手动冒烟测试**

```bash
# 终端 1
node remote-agent/dist/agent.js --port=39099

# 终端 2（需要 node ws 客户端或 wscat）
node -e "
const {WebSocket} = await import('ws');
const ws = new WebSocket('ws://127.0.0.1:39099');
ws.on('open', () => ws.send(JSON.stringify({type:'ping'})));
ws.on('message', d => { console.log(d.toString()); ws.close(); });
"
```

预期：输出 `{"type":"pong"}`

- [ ] **Step 9: 写单元测试 `src/__tests__/unit/remote-agent-buffer.test.ts`**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../../../remote-agent/src/session-manager.js';

describe('SessionManager', () => {
  it('getBufferedSince returns events after lastEventId', () => {
    const sm = new SessionManager();
    const fakeState = {
      sessionId: 'test',
      process: { kill: () => {} } as unknown as import('node:child_process').ChildProcess,
      buffer: [
        { eventId: 0, event: { t: 'a' }, timestamp: Date.now() },
        { eventId: 1, event: { t: 'b' }, timestamp: Date.now() },
        { eventId: 2, event: { t: 'c' }, timestamp: Date.now() },
      ],
      nextEventId: 3,
      clientWs: null,
      status: 'running' as const,
      startedAt: Date.now(),
    };
    sm.sessions.set('test', fakeState);

    const result = sm.getBufferedSince('test', 0);
    assert.equal(result.length, 2);
    assert.equal(result[0].eventId, 1);
  });

  it('getBufferedSince returns empty for unknown session', () => {
    const sm = new SessionManager();
    assert.deepEqual(sm.getBufferedSince('unknown', 0), []);
  });

  it('abort does not throw for unknown session', () => {
    const sm = new SessionManager();
    assert.doesNotThrow(() => sm.abort('unknown'));
  });
});
```

- [ ] **Step 10: 运行测试**

```bash
cd /Users/cairui/Code/CodePilot
npx tsx --test src/__tests__/unit/remote-agent-buffer.test.ts
```

预期：3 tests pass

- [ ] **Step 11: Commit**

```bash
git add remote-agent/ src/__tests__/unit/remote-agent-buffer.test.ts
git commit -m "feat(remote): add codepilot-remote-agent with WebSocket server and session buffer"
```

---

## Chunk 2: SSH Manager & 数据层

### Task 2: 数据库迁移 + RemoteHost 类型

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/types/index.ts`
- Modify: `src/i18n/en.ts` + `src/i18n/zh.ts`

- [ ] **Step 1: 写测试 `src/__tests__/unit/remote-host-db.test.ts`**

```typescript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

const { getDb, createRemoteHost, listRemoteHosts } = await import('../../lib/db.js');

describe('remote_hosts DB', () => {
  it('remote_hosts table exists', () => {
    const db = getDb();
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='remote_hosts'"
    ).get();
    assert.ok(table, 'remote_hosts table should exist');
  });

  it('can create and list remote hosts', () => {
    createRemoteHost({
      name: 'Test Host', host: '192.168.1.100', port: 22,
      username: 'user', authType: 'key', keyPath: '~/.ssh/id_rsa',
      workDir: '/home/user/projects',
    });
    const hosts = listRemoteHosts();
    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].name, 'Test Host');
    assert.equal(hosts[0].status, 'disconnected');
  });

  it('chat_sessions has remote_host_id column', () => {
    const db = getDb();
    const cols = db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[];
    assert.ok(cols.some(c => c.name === 'remote_host_id'), 'remote_host_id column missing');
  });

  after(() => { fs.rmSync(tmpDir, { recursive: true }); });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx tsx --test src/__tests__/unit/remote-host-db.test.ts
```

预期：FAIL（`createRemoteHost` 未定义）

- [ ] **Step 3: 在 `src/lib/db.ts` 的 `initDb()` 末尾添加迁移**

在最后一个 `db.exec("CREATE INDEX ...")` 后追加：

```typescript
// ── remote_hosts ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS remote_hosts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    host        TEXT NOT NULL,
    port        INTEGER NOT NULL DEFAULT 22,
    username    TEXT NOT NULL,
    auth_type   TEXT NOT NULL DEFAULT 'key',
    key_path    TEXT,
    password    TEXT,
    work_dir    TEXT NOT NULL DEFAULT '',
    agent_port  INTEGER NOT NULL DEFAULT 39099,
    status      TEXT NOT NULL DEFAULT 'disconnected',
    last_seen   INTEGER,
    created_at  INTEGER NOT NULL
  );
`);

const sessionCols = db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[];
if (!sessionCols.some(c => c.name === 'remote_host_id')) {
  safeAddColumn(db, 'ALTER TABLE chat_sessions ADD COLUMN remote_host_id TEXT');
}
// 运行时字段：启动时重置所有 status
db.exec("UPDATE remote_hosts SET status = 'disconnected'");
```

- [ ] **Step 4: 在 `src/lib/db.ts` 末尾添加 CRUD helpers**

```typescript
// ── Remote Host helpers ───────────────────────────────────────────

export interface RemoteHostRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'key' | 'password';
  key_path: string | null;
  password: string | null; // safeStorage encrypted base64
  work_dir: string;
  agent_port: number;
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  last_seen: number | null;
  created_at: number;
}

export function createRemoteHost(input: {
  name: string; host: string; port?: number; username: string;
  authType: 'key' | 'password'; keyPath?: string; password?: string; workDir: string;
}): RemoteHostRow {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO remote_hosts (id,name,host,port,username,auth_type,key_path,password,work_dir,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id, input.name, input.host, input.port ?? 22, input.username,
        input.authType, input.keyPath ?? null, input.password ?? null, input.workDir, Date.now());
  return db.prepare('SELECT * FROM remote_hosts WHERE id = ?').get(id) as RemoteHostRow;
}

export function listRemoteHosts(): RemoteHostRow[] {
  return getDb().prepare('SELECT * FROM remote_hosts ORDER BY created_at ASC').all() as RemoteHostRow[];
}

export function getRemoteHost(id: string): RemoteHostRow | null {
  return getDb().prepare('SELECT * FROM remote_hosts WHERE id = ?').get(id) as RemoteHostRow | null;
}

export function updateRemoteHost(id: string, updates: Partial<Pick<RemoteHostRow,
  'name' | 'host' | 'port' | 'username' | 'auth_type' | 'key_path' | 'password' | 'work_dir' | 'agent_port'
>>): void {
  if (Object.keys(updates).length === 0) return;
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE remote_hosts SET ${fields} WHERE id = ?`).run(...Object.values(updates), id);
}

export function deleteRemoteHost(id: string): void {
  getDb().prepare('DELETE FROM remote_hosts WHERE id = ?').run(id);
}

export function setRemoteHostStatus(
  id: string,
  status: RemoteHostRow['status']
): void {
  getDb().prepare('UPDATE remote_hosts SET status = ?, last_seen = ? WHERE id = ?')
    .run(status, Date.now(), id);
}
```

- [ ] **Step 5: 在 `src/types/index.ts` 末尾添加类型**

```typescript
export interface RemoteHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'key' | 'password';
  keyPath?: string;
  workDir: string;
  agentPort: number;
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  lastSeen?: number;
}

export type RemoteConnectionStatus = RemoteHost['status'];
```

- [ ] **Step 6: 在 `src/i18n/zh.ts` 末尾（`}` 前）添加**

```typescript
remote: {
  title: '远程主机',
  addHost: '添加主机',
  connect: '连接',
  disconnect: '断开',
  reconnect: '重连',
  status: {
    disconnected: '未连接',
    connecting: '连接中',
    connected: '已连接',
    reconnecting: '重连中',
    failed: '连接失败',
  },
  form: {
    name: '主机名称', host: '主机地址', port: '端口',
    username: '用户名', authType: '认证方式',
    authKey: 'SSH 密钥', authPassword: '密码',
    keyPath: '密钥路径', password: '密码', workDir: '工作目录',
  },
  setup: {
    checking: '检测远程环境...',
    nodeInstall: '安装 Node.js', claudeInstall: '安装 Claude CLI', agentDeploy: '部署 Agent',
    installManual: '手动安装', installAuto: '自动安装', retry: '重试', copyCommand: '复制命令',
  },
  errors: {
    authFailed: 'SSH 认证失败',
    connectionRefused: '连接被拒绝',
    timeout: '连接超时',
    sessionNotFound: '任务状态丢失，请重新发起',
  },
},
```

- [ ] **Step 7: 在 `src/i18n/en.ts` 添加对应英文**（同结构）

- [ ] **Step 8: 运行测试**

```bash
npx tsx --test src/__tests__/unit/remote-host-db.test.ts
```

预期：3 tests pass

- [ ] **Step 9: Commit**

```bash
git add src/lib/db.ts src/types/index.ts src/i18n/en.ts src/i18n/zh.ts src/__tests__/unit/remote-host-db.test.ts
git commit -m "feat(remote): add remote_hosts table, CRUD helpers, types, and i18n"
```

---

### Task 3: SSH Manager（Electron 主进程）

**Files:**
- Create: `src/lib/remote/ssh-manager.ts`
- Create: `src/lib/remote/types.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

> ⚠ `ssh2` 只能在 Electron 主进程使用，不能在 Next.js API Route 中导入。

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/cairui/Code/CodePilot
npm install ssh2
npm install -D @types/ssh2
```

- [ ] **Step 2: 创建 `src/lib/remote/types.ts`**

```typescript
export interface RemoteHostConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  authType: 'key' | 'password';
  keyPath?: string;
  encryptedPassword?: string; // base64 of electron.safeStorage encrypted buffer
  agentPort: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface ConnectionState {
  hostId: string;
  status: ConnectionStatus;
  localPort: number | null;
  error?: string;
}
```

- [ ] **Step 3: 创建 `src/lib/remote/ssh-manager.ts`**

```typescript
import { Client, type ConnectConfig } from 'ssh2';
import net from 'node:net';
import fs from 'node:fs';
import { safeStorage } from 'electron';
import type { RemoteHostConfig, ConnectionState, ConnectionStatus } from './types.js';

const MAX_RETRY_DELAY_MS = 30_000;
const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000;

async function findFreePort(start = 39100): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>(resolve => {
      const srv = net.createServer();
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
      srv.on('error', () => resolve(false));
    });
    if (free) return port;
  }
  throw new Error('No free port found in range 39100-39199');
}

interface ConnEntry {
  client: Client;
  localPort: number;
  status: ConnectionStatus;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  reconnectStart: number | null;
}

export class SSHManager {
  private connections = new Map<string, ConnEntry>();
  private statusListeners: Array<(state: ConnectionState) => void> = [];

  onStatusChange(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.push(listener);
    return () => { this.statusListeners = this.statusListeners.filter(l => l !== listener); };
  }

  private emit(hostId: string, status: ConnectionStatus, localPort: number | null, error?: string) {
    for (const l of this.statusListeners) l({ hostId, status, localPort, error });
  }

  async connect(config: RemoteHostConfig): Promise<{ localPort: number }> {
    const existing = this.connections.get(config.id);
    if (existing?.status === 'connected') return { localPort: existing.localPort };
    const localPort = await findFreePort();
    this.emit(config.id, 'connecting', null);
    await this.doConnect(config, localPort);
    return { localPort };
  }

  private async doConnect(config: RemoteHostConfig, localPort: number): Promise<void> {
    const client = new Client();
    const connectCfg: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      readyTimeout: 20_000,
    };

    if (config.authType === 'key' && config.keyPath) {
      connectCfg.privateKey = fs.readFileSync(
        config.keyPath.startsWith('~') ? config.keyPath.replace('~', process.env.HOME ?? '') : config.keyPath
      );
    } else if (config.authType === 'password' && config.encryptedPassword) {
      connectCfg.password = safeStorage.decryptString(
        Buffer.from(config.encryptedPassword, 'base64')
      );
    }

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        // 建立反向端口转发：local:localPort → remote:agentPort
        client.forwardIn('127.0.0.1', config.agentPort, (err) => {
          if (err) { client.end(); reject(err); return; }

          const entry: ConnEntry = {
            client, localPort, status: 'connected',
            retryCount: 0, retryTimer: null, reconnectStart: null,
          };
          this.connections.set(config.id, entry);
          this.emit(config.id, 'connected', localPort);
          resolve();
        });

        client.on('tcp connection', (_info, accept) => {
          const channel = accept();
          const sock = net.createConnection({ port: localPort, host: '127.0.0.1' });
          channel.pipe(sock).pipe(channel);
          sock.on('error', () => channel.close());
          channel.on('close', () => sock.destroy());
        });
      });

      client.on('error', (err) => {
        const entry = this.connections.get(config.id);
        if (!entry || entry.status !== 'connected') { reject(err); return; }
        this.scheduleReconnect(config, localPort);
      });

      client.on('end', () => {
        const entry = this.connections.get(config.id);
        if (entry?.status === 'connected') this.scheduleReconnect(config, localPort);
      });

      client.connect(connectCfg);
    });
  }

  private scheduleReconnect(config: RemoteHostConfig, localPort: number): void {
    const entry = this.connections.get(config.id);
    if (!entry) return;
    if (!entry.reconnectStart) entry.reconnectStart = Date.now();
    if (Date.now() - entry.reconnectStart > RECONNECT_TIMEOUT_MS) {
      entry.status = 'failed';
      this.emit(config.id, 'failed', null, 'Reconnect timeout (5min)');
      return;
    }
    entry.status = 'reconnecting';
    this.emit(config.id, 'reconnecting', localPort);
    const delay = Math.min(1000 * 2 ** entry.retryCount, MAX_RETRY_DELAY_MS);
    entry.retryCount++;
    entry.retryTimer = setTimeout(async () => {
      try {
        await this.doConnect(config, localPort);
        const e = this.connections.get(config.id);
        if (e) { e.retryCount = 0; e.reconnectStart = null; }
      } catch {
        this.scheduleReconnect(config, localPort);
      }
    }, delay);
  }

  disconnect(hostId: string): void {
    const entry = this.connections.get(hostId);
    if (!entry) return;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.client.end();
    this.connections.delete(hostId);
    this.emit(hostId, 'disconnected', null);
  }

  getRawClient(hostId: string): Client | null {
    return this.connections.get(hostId)?.client ?? null;
  }

  getLocalPort(hostId: string): number | null {
    return this.connections.get(hostId)?.localPort ?? null;
  }

  getStatus(hostId: string): ConnectionStatus {
    return this.connections.get(hostId)?.status ?? 'disconnected';
  }
}

export const sshManager = new SSHManager();
```

- [ ] **Step 4: 在 `electron/main.ts` 中添加 Remote IPC handlers**

在文件顶部 imports 区域添加（与其他 imports 放在一起，不要放函数内）：

```typescript
import { sshManager } from '../src/lib/remote/ssh-manager';
import { remoteAgentClient } from '../src/lib/remote/agent-client';
import { checkRemoteEnv, buildInstallPlan, deployAgent, startRemoteAgent, isAgentRunning } from '../src/lib/remote/setup-checker';
import type { RemoteHostConfig } from '../src/lib/remote/types';
```

在 `app.whenReady().then(async () => {` 内的 IPC 注册区域（`ipcMain.handle('bridge:is-active', ...)` 之后）添加：

```typescript
// ── Remote Connect ────────────────────────────────────────────────
sshManager.onStatusChange(async (state) => {
  mainWindow?.webContents.send('remote:status-changed', state);
  if (state.status === 'connected' && state.localPort) {
    try { await remoteAgentClient.connect(state.hostId, state.localPort); }
    catch (err) { console.error('[remote] WebSocket connect failed:', err); }
  } else if (state.status === 'disconnected') {
    remoteAgentClient.disconnect(state.hostId);
  }
});

remoteAgentClient.onMessage((hostId, msg) => {
  mainWindow?.webContents.send('remote:agent-message', { hostId, msg });
});

remoteAgentClient.onNeedReconnect((hostId) => {
  console.log(`[remote] Agent WS closed for ${hostId}, awaiting SSH reconnect`);
});

ipcMain.handle('remote:connect', (_e, config: RemoteHostConfig) => sshManager.connect(config));
ipcMain.handle('remote:disconnect', (_e, hostId: string) => sshManager.disconnect(hostId));
ipcMain.handle('remote:get-status', (_e, hostId: string) => ({
  status: sshManager.getStatus(hostId),
  localPort: sshManager.getLocalPort(hostId),
}));
ipcMain.handle('remote:agent-send', (_e, hostId: string, msg: unknown) => {
  remoteAgentClient.send(hostId, msg as ClientMessage);
});

function getLocalAgentPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'remote-agent', 'dist', 'agent.js')
    : path.join(__dirname, '../../remote-agent/dist/agent.js');
}
function getLocalAgentVersion(): string {
  try {
    const first = fs.readFileSync(getLocalAgentPath(), 'utf-8').split('\n')[0];
    return first.match(/CODEPILOT_AGENT_VERSION=(\S+)/)?.[1] ?? '0.0.0';
  } catch { return '0.0.0'; }
}

ipcMain.handle('remote:check-env', async (_e, hostId: string) => {
  const client = sshManager.getRawClient(hostId);
  if (!client) throw new Error('Not connected');
  const result = await checkRemoteEnv(client);
  const plan = buildInstallPlan(result, getLocalAgentVersion());
  return { result, plan };
});
ipcMain.handle('remote:deploy-agent', async (_e, hostId: string) => {
  const client = sshManager.getRawClient(hostId);
  if (!client) throw new Error('Not connected');
  await deployAgent(client, getLocalAgentPath());
});
ipcMain.handle('remote:start-agent', async (_e, hostId: string, port: number) => {
  const client = sshManager.getRawClient(hostId);
  if (!client) throw new Error('Not connected');
  await startRemoteAgent(client, port);
});
ipcMain.handle('remote:is-agent-running', async (_e, hostId: string, port: number) => {
  const client = sshManager.getRawClient(hostId);
  if (!client) throw new Error('Not connected');
  return isAgentRunning(client, port);
});
```

注意：`ClientMessage` 需要从 remote-agent types 导入，在顶部加：
```typescript
import type { ClientMessage } from '../remote-agent/src/types';
```

- [ ] **Step 5: 在 `electron/preload.ts` 暴露 remote API**

在 `terminal: { ... },` 后追加：

```typescript
remote: {
  connect: (config: unknown) => ipcRenderer.invoke('remote:connect', config),
  disconnect: (hostId: string) => ipcRenderer.invoke('remote:disconnect', hostId),
  getStatus: (hostId: string) => ipcRenderer.invoke('remote:get-status', hostId),
  checkEnv: (hostId: string) => ipcRenderer.invoke('remote:check-env', hostId),
  deployAgent: (hostId: string) => ipcRenderer.invoke('remote:deploy-agent', hostId),
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
```

- [ ] **Step 6: 运行 typecheck**

```bash
npm run test
```

预期：typecheck 通过

- [ ] **Step 7: Commit**

```bash
git add src/lib/remote/ electron/main.ts electron/preload.ts
git commit -m "feat(remote): add SSHManager, RemoteAgentClient IPC wiring"
```

---

### Task 4: SetupChecker + RemoteAgentClient

**Files:**
- Create: `src/lib/remote/setup-checker.ts`
- Create: `src/lib/remote/agent-client.ts`

- [ ] **Step 1: 创建 `src/lib/remote/setup-checker.ts`**

```typescript
import type { Client } from 'ssh2';
import fs from 'node:fs';

export interface CheckResult {
  os: 'Darwin' | 'Linux' | 'unknown';
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

async function sshExec(client: Client, cmd: string): Promise<string | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 10_000);
    client.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); resolve(null); return; }
      let out = '';
      stream.on('data', (d: Buffer) => { out += d.toString(); });
      stream.stderr.on('data', () => {});
      stream.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
    });
  });
}

export async function checkRemoteEnv(client: Client): Promise<CheckResult> {
  const [osRaw, nodeRaw, claudeRaw, agentHead] = await Promise.all([
    sshExec(client, 'uname -s'),
    sshExec(client, 'node --version 2>/dev/null'),
    sshExec(client, 'claude --version 2>/dev/null'),
    sshExec(client, 'head -1 ~/.codepilot/agent.js 2>/dev/null || echo ""'),
  ]);
  return {
    os: osRaw === 'Darwin' ? 'Darwin' : osRaw === 'Linux' ? 'Linux' : 'unknown',
    nodeVersion: nodeRaw?.startsWith('v') ? nodeRaw : null,
    claudeVersion: claudeRaw?.includes('claude') ? claudeRaw : null,
    agentVersion: agentHead?.match(/CODEPILOT_AGENT_VERSION=(\S+)/)?.[1] ?? null,
  };
}

export function buildInstallPlan(result: CheckResult, localAgentVersion: string): InstallPlan {
  const nodeCommands: Record<string, string[]> = {
    Darwin: ['brew install node'],
    Linux: [
      '# Debian/Ubuntu:', 'sudo apt-get update && sudo apt-get install -y nodejs npm',
      '# RHEL/Fedora:', 'sudo dnf install -y nodejs npm',
    ],
    unknown: ['curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install --lts'],
  };
  return {
    needsNode: !result.nodeVersion,
    needsClaude: !result.claudeVersion,
    needsAgentDeploy: !result.agentVersion || result.agentVersion !== localAgentVersion,
    nodeCommands: nodeCommands[result.os] ?? nodeCommands.unknown,
    claudeCommands: ['npm install -g @anthropic-ai/claude-code'],
  };
}

export async function deployAgent(client: Client, localAgentPath: string): Promise<void> {
  const content = fs.readFileSync(localAgentPath);
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      const remote = `${process.env.HOME ?? '/root'}/.codepilot/agent.js`;
      client.exec('mkdir -p ~/.codepilot', (e2) => {
        if (e2) { reject(e2); return; }
        const ws = sftp.createWriteStream(remote);
        ws.on('close', resolve);
        ws.on('error', reject);
        ws.end(content);
      });
    });
  });
}

export async function startRemoteAgent(client: Client, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    client.exec(
      `nohup node ~/.codepilot/agent.js --port=${port} >> ~/.codepilot/agent.log 2>&1 &`,
      (err, stream) => {
        if (err) { reject(err); return; }
        stream.on('close', resolve);
      }
    );
  });
}

export async function isAgentRunning(client: Client, port: number): Promise<boolean> {
  const result = await sshExec(client, `nc -z 127.0.0.1 ${port} 2>/dev/null && echo ok || echo no`);
  return result?.trim() === 'ok';
}
```

- [ ] **Step 2: 安装 ws 并创建 `src/lib/remote/agent-client.ts`**

```bash
npm install ws && npm install -D @types/ws
```

```typescript
// src/lib/remote/agent-client.ts
import WebSocket from 'ws';
import type { AgentMessage, ClientMessage } from '../../../remote-agent/src/types.js';

type MessageListener = (hostId: string, msg: AgentMessage) => void;

interface WsEntry {
  ws: WebSocket;
  localPort: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongPending: boolean;
}

export class RemoteAgentClient {
  private connections = new Map<string, WsEntry>();
  private messageListeners: MessageListener[] = [];
  private needReconnectCb: ((hostId: string) => void) | null = null;

  onMessage(l: MessageListener): () => void {
    this.messageListeners.push(l);
    return () => { this.messageListeners = this.messageListeners.filter(x => x !== l); };
  }

  onNeedReconnect(cb: (hostId: string) => void): void {
    this.needReconnectCb = cb;
  }

  async connect(hostId: string, localPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${localPort}`);
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 10_000);

      ws.on('open', () => {
        clearTimeout(timer);
        const entry: WsEntry = { ws, localPort, pingTimer: null, pongPending: false };
        this.connections.set(hostId, entry);
        this.startHeartbeat(hostId);
        resolve();
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as AgentMessage;
          if (msg.type === 'pong') {
            const e = this.connections.get(hostId);
            if (e) e.pongPending = false;
            return;
          }
          for (const l of this.messageListeners) l(hostId, msg);
        } catch { /* ignore */ }
      });

      ws.on('close', () => {
        const e = this.connections.get(hostId);
        if (e?.pingTimer) clearInterval(e.pingTimer);
        this.connections.delete(hostId);
        this.needReconnectCb?.(hostId);
      });

      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  send(hostId: string, msg: ClientMessage): void {
    const e = this.connections.get(hostId);
    if (e?.ws.readyState === WebSocket.OPEN) e.ws.send(JSON.stringify(msg));
  }

  disconnect(hostId: string): void {
    const e = this.connections.get(hostId);
    if (!e) return;
    if (e.pingTimer) clearInterval(e.pingTimer);
    e.ws.close();
    this.connections.delete(hostId);
  }

  isConnected(hostId: string): boolean {
    return this.connections.get(hostId)?.ws.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(hostId: string): void {
    const e = this.connections.get(hostId);
    if (!e) return;
    e.pingTimer = setInterval(() => {
      if (e.pongPending) { e.ws.terminate(); return; }
      e.pongPending = true;
      this.send(hostId, { type: 'ping' });
    }, 30_000);
  }
}

export const remoteAgentClient = new RemoteAgentClient();
```

- [ ] **Step 3: 运行 typecheck**

```bash
npm run test
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/remote/setup-checker.ts src/lib/remote/agent-client.ts
git commit -m "feat(remote): add SetupChecker and RemoteAgentClient"
```

---

## Chunk 3: Remote Host API + UI

### Task 5: REST API Routes

**Files:**
- Create: `src/app/api/remote/hosts/route.ts`
- Create: `src/app/api/remote/hosts/[id]/route.ts`

- [ ] **Step 1: 创建 `src/app/api/remote/hosts/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { listRemoteHosts, createRemoteHost } from '@/lib/db';

export async function GET() {
  const hosts = listRemoteHosts().map(({ password: _p, ...h }) => h);
  return NextResponse.json(hosts);
}

export async function POST(req: Request) {
  const { name, host, port, username, authType, keyPath, workDir } = await req.json();
  if (!name || !host || !username || !workDir) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  const created = createRemoteHost({ name, host, port, username, authType, keyPath, workDir });
  const { password: _p, ...safe } = created;
  return NextResponse.json(safe, { status: 201 });
}
```

- [ ] **Step 2: 创建 `src/app/api/remote/hosts/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getRemoteHost, updateRemoteHost, deleteRemoteHost } from '@/lib/db';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const host = getRemoteHost(id);
  if (!host) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { password: _p, ...safe } = host;
  return NextResponse.json(safe);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { password: _p, id: _id, created_at: _ca, ...updates } = await req.json();
  updateRemoteHost(id, updates);
  const { password: _p2, ...safe } = getRemoteHost(id)!;
  return NextResponse.json(safe);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteRemoteHost(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/remote/
git commit -m "feat(remote): add remote hosts CRUD API routes"
```

---

### Task 6: UI 组件

**Files:**
- Create: `src/components/remote/AddHostDialog.tsx`
- Create: `src/components/remote/RemoteHostList.tsx`
- Create: `src/components/remote/ConnectionStatus.tsx`
- Create: `src/components/remote/SetupGuide.tsx`

> 实现前先 Read Settings 页和 TopBar 文件，确认插入点。
>
> **颜色规则**：状态颜色用语义 token（`text-status-success`、`text-status-warning`、`text-destructive`），不用 `text-green-500` 等原始颜色。

- [ ] **Step 1: Read Settings 页找插入点**

```bash
grep -rn "Remote\|remote" src/app/settings/ | head -10
grep -n "export default\|return (" src/app/settings/page.tsx | head -10
```

- [ ] **Step 2: 创建 `src/components/remote/AddHostDialog.tsx`**

参考 Settings 中已有的 Dialog 组件样式。字段：name、host、port（默认22）、username、authType（key/password 单选）、keyPath（key时显示）、password（password时显示）、workDir。

提交时调用 `POST /api/remote/hosts`，若 authType=password 需要通过 `window.electronAPI.remote` 在主进程加密后单独存储。

- [ ] **Step 3: 创建 `src/components/remote/SetupGuide.tsx`**

接收 `checkResult` 和 `installPlan` props，分步展示：
- ✓ SSH 连接成功
- 各检测项（node/claude/agent）状态
- 若需安装：命令块 + 复制按钮 + "自动安装" / "手动完成后重试"

- [ ] **Step 4: 创建 `src/components/remote/RemoteHostList.tsx`**

列出 remote hosts，每行显示：名称、host、状态点、连接/断开按钮。

连接流程（点击"连接"）：
1. `window.electronAPI.remote.connect(hostConfig)` 
2. 等待 `onStatusChanged` → 'connected'
3. `checkEnv` → 若有缺失 → 展示 `SetupGuide`
4. `deployAgent`（若需要）→ `startAgent` → `isAgentRunning`（重试等待）
5. 就绪 ✓

- [ ] **Step 5: 创建 `src/components/remote/ConnectionStatus.tsx`**

```tsx
// 无连接时 hidden；有连接时显示 host name + 状态指示
// connected: text-status-success 圆点
// reconnecting: text-status-warning 圆点 + "重连中"
// failed: text-destructive 圆点，可点击触发 electronAPI.remote.connect(...)
```

- [ ] **Step 6: 将 RemoteHostList 集成进 Settings 页**

Read Settings 页后找合适位置（参考其他 Settings section 的排版）插入 `<RemoteHostList />`。

- [ ] **Step 7: 将 ConnectionStatus 集成进 TopBar**

```bash
grep -n "TopBar\|UnifiedTopBar" src/components/layout/ -r | head -10
```

Read TopBar 文件，找顶栏右侧区域，插入 `<ConnectionStatus />`。

- [ ] **Step 8: CDP 验证**

```bash
npm run dev
# 用 chrome-devtools MCP：
# 1. 打开 http://localhost:3000/settings
# 2. 截图确认 Remote Hosts 区域存在
# 3. 点击"添加主机"，截图确认 Dialog 弹出
# 4. 确认顶栏无 console 报错
```

- [ ] **Step 9: Commit**

```bash
git add src/components/remote/ src/app/settings/
git commit -m "feat(remote): add Remote Host UI components and Settings integration"
```

---

## 最终验收清单

```bash
# 1. 全量测试
npm run test

# 2. 颜色检查
npm run lint:colors

# 3. 功能验证（需要 dev server + 本机 SSH）
npm run dev
# □ Settings → Remote Hosts → 添加本机 SSH 配置 → 连接成功
# □ 顶栏显示 🟢 主机名
# □ 发起 claude 任务 → 手动断 SSH → 任务继续（agent.log 增长）
# □ SSH 重连 → 输出续流
# □ npm run lint 无报错
```
