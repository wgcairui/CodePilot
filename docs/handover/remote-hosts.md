<!-- Source: Detailed reference extracted from Remote Host SSH tunnel feature implementation — architecture, data flow, DB schema, API routes, key design decisions -->

# Remote Hosts 技术交接文档

> 产品思考见 [`docs/insights/remote-hosts.md`](../insights/remote-hosts.md)

## 功能概述

通过 SSH 隧道连接远程 macOS/Linux 主机，在远端运行 claude CLI，本地 UI 无缝接入。用户感知上与本地会话体验一致。

---

## 目录结构

```
remote-agent/                  # 独立 Node.js 项目，打包为单文件
├── src/
│   ├── index.ts               # WebSocketServer 入口，第一行: // CODEPILOT_AGENT_VERSION=0.1.0
│   ├── session-manager.ts     # Ring buffer + claude 进程管理
│   └── types.ts               # Wire Protocol 类型（ClientMessage / AgentMessage）
├── build.ts                   # esbuild 打包脚本（banner 注入版本号）
└── package.json               # type: "module"，ws + esbuild + tsx

src/lib/remote/                # Electron main process 专用
├── types.ts                   # RemoteHostConfig / ConnectionStatus / ConnectionState
├── ssh-manager.ts             # SSHManager：SSH 隧道 + 动态端口 + 重连状态机
├── setup-checker.ts           # SetupChecker：环境探测 / 安装计划 / agent 部署
└── agent-client.ts            # RemoteAgentClient：WS 客户端 + 心跳 + 消息路由

src/app/api/remote/
├── hosts/route.ts             # GET /api/remote/hosts, POST /api/remote/hosts
└── hosts/[id]/route.ts        # GET/PUT/DELETE /api/remote/hosts/:id

src/components/remote/
├── AddHostDialog.tsx           # 新增/编辑主机表单（Modal）
├── SetupGuide.tsx              # 远端环境检测 + 安装引导（Step 流程）
├── RemoteHostList.tsx          # 主机列表 + 7步连接流程
└── ConnectionStatus.tsx        # TopBar 微组件，显示当前连接状态

src/components/settings/SettingsLayout.tsx  # 已集成 <RemoteHostList />
src/components/layout/UnifiedTopBar.tsx     # 已集成 <RemoteConnectionStatus />
```

---

## 数据流

```
用户点击 Connect
  → RemoteHostList.tsx (UI)
  → window.electronAPI.remote.connect(hostId)
  → Electron IPC: "remote:connect"
  → sshManager.connect(config)
      → findFreePort(39100)           # net.createServer 探测
      → ssh2 Client.connect()
      → local TCP server + forwardOut → remote agent port
  → sshManager.onStatusChange → push renderer event "remote:status-changed"
  → remoteAgentClient.connect("ws://127.0.0.1:{localPort}")
      → 30s ping/pong heartbeat
      → ws.on('message') → IPC push "remote:agent-message"
  → UI 订阅 onStatusChanged / onAgentMessage 更新状态
```

### Agent 启动流程（首次）

```
SetupGuide.tsx 触发
  → remote:check-env  → checkRemoteEnv()   # 并行 SSH exec: uname/node/claude/head -1 agent
  → remote:deploy-agent → deployAgent()
      → SSH exec: echo $HOME               # ⚠️ 获取远端 HOME，不能用本地 process.env.HOME
      → SFTP upload: {remoteHome}/.codepilot/agent.js
  → remote:start-agent → startRemoteAgent()
      → nohup node agent.js {port} > agent.log 2>&1 &
  → remote:is-agent-running → nc -z 127.0.0.1 {port}
```

---

## DB Schema

```sql
-- remote_hosts 表（src/lib/db.ts initDb()）
CREATE TABLE IF NOT EXISTS remote_hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'key',   -- 'key' | 'password'
  key_path TEXT,
  encrypted_password TEXT,                  -- electron.safeStorage 加密
  work_dir TEXT NOT NULL DEFAULT '~',
  agent_port INTEGER NOT NULL DEFAULT 39200,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_seen INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- chat_sessions 表新增列
ALTER TABLE chat_sessions ADD COLUMN remote_host_id TEXT REFERENCES remote_hosts(id);
```

### DB 函数（src/lib/db.ts）

| 函数 | 说明 |
|------|------|
| `createRemoteHost(data)` | 创建主机记录，返回 RemoteHostRow |
| `listRemoteHosts()` | 列出全部主机 |
| `getRemoteHost(id)` | 按 id 获取 |
| `updateRemoteHost(id, data)` | 更新字段 |
| `deleteRemoteHost(id)` | 删除 |
| `setRemoteHostStatus(id, status)` | 更新连接状态 |

---

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/remote/hosts` | 列出主机，响应不含 `password` 字段 |
| POST | `/api/remote/hosts` | 创建主机，响应不含 `password` 字段 |
| GET | `/api/remote/hosts/:id` | 获取单个主机 |
| PUT | `/api/remote/hosts/:id` | 更新主机 |
| DELETE | `/api/remote/hosts/:id` | 删除主机 |

> ⚠️ `password` 字段在所有 API 响应中被剥离，仅在 Electron IPC 层通过 `safeStorage` 处理。

---

## IPC Handlers（electron/main.ts）

| 事件 | 说明 |
|------|------|
| `remote:connect` | 建立 SSH 隧道 + 连接 WS agent |
| `remote:disconnect` | 断开连接 |
| `remote:get-status` | 返回当前连接状态 |
| `remote:agent-send` | 向 agent 发送 ClientMessage |
| `remote:check-env` | 探测远端 node/claude/agent 版本 |
| `remote:deploy-agent` | 上传 agent.js 到远端 |
| `remote:start-agent` | nohup 启动 agent 进程 |
| `remote:is-agent-running` | nc -z 检查 agent 是否在监听 |

Renderer 事件（push from main）：
- `remote:status-changed` — `{ hostId, status, localPort?, error? }`
- `remote:agent-message` — `{ hostId, message: AgentMessage }`

---

## Wire Protocol

```typescript
// ClientMessage (Electron → Agent)
| { type: 'start_session'; sessionId: string; workDir: string; prompt: string; model?: string }
| { type: 'resume_session'; sessionId: string; afterEventId?: string }
| { type: 'abort_session'; sessionId: string }
| { type: 'ping' }

// AgentMessage (Agent → Electron)
| { type: 'buffered_events'; sessionId: string; events: SessionEvent[] }
| { type: 'event'; sessionId: string; event: SessionEvent }
| { type: 'session_complete'; sessionId: string }
| { type: 'session_error'; sessionId: string; error: string }
| { type: 'session_not_found'; sessionId: string }
| { type: 'session_taken'; sessionId: string }
| { type: 'pong' }
```

---

## 关键设计决策

### SSH 隧道 vs 直连
SSH 隧道（`ssh2` + `forwardOut`）在 Electron main process 实现，避免在 renderer/Next.js 端处理网络级凭据。agent WebSocket 仅绑定 `127.0.0.1`，不对外暴露。

### Ring Buffer（50MB + 5min TTL）
agent 内维护每个 session 的事件缓冲，支持断线重连后按 `afterEventId` 回放。上限 50MB 防止长会话内存溢出。

### 重连指数退避
`1000 * 2^retryCount`（retryCount < 4），上限 30s：`1→2→4→8→30s`。达到上限后状态置为 `failed`，需用户手动重连。

### 密码加密
SSH 密码通过 `electron.safeStorage.encryptString()` 加密后存 SQLite，API 层永远不返回明文。

### 版本检测
agent 第一行为 `// CODEPILOT_AGENT_VERSION=x.y.z`，通过 `head -1 ~/.codepilot/agent.js` 读取，判断是否需要重新部署。

---

## ⚠️ 已知注意事项

- **`process.env.HOME` 是本地路径**：deployAgent 必须先 SSH exec `echo $HOME` 获取远端 HOME
- **i18n 前缀是 `remoteHost.*`**：Bridge 功能已占用 `remote.title`，不能用 `remote.*`
- **agent 需 nohup 后台运行**：不能在 foregrounded SSH exec 中启动，否则 SSH session 关闭时 agent 也会退出
- **本地端口范围 39100–39199**：如果该范围被占满，`findFreePort` 会抛出错误
- **`proc.stderr` 必须 drain**：不 drain stderr 会导致 claude 进程阻塞（OS pipe buffer 打满）
