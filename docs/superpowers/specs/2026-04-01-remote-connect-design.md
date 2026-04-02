# Remote Host Connect — 设计规格

> 创建时间：2026-04-01
> 状态：待实现

## 背景与目标

用户本地机器性能有限，希望将 claude CLI 的实际计算和文件操作迁移到一台性能更好的远程 macOS 主机上，同时保持本地 CodePilot UI 的完整体验。

目标：
- 在 CodePilot 中配置远程主机，通过 SSH 连接后直接在远端工作
- 连接稳定，网络抖动时任务不中断，重连后自动续流
- 远程机器零额外依赖（只需 Node.js + claude CLI）
- 支持 macOS 和 Linux 作为远程主机

## 整体架构

```
本地 CodePilot（Electron + Next.js）
│
├── SSHManager（Electron 主进程，ssh2 库）
│   ├── SSH 连接（支持 key / password 认证）
│   ├── 端口转发 local:{动态空闲端口} → remote:39099
│   └── 自动重连（指数退避 1→2→4→8→30s）
│
├── RemoteAgentClient（Electron 主进程通过 IPC 驱动）
│   └── WebSocket → localhost:{本地隧道端口}
│       （Next.js API Route 通过 IPC 代理调用，不直连）
│
└── 本地 SQLite（remote_hosts 表 + sessions.remote_host_id）

远程 macOS 主机
└── ~/.codepilot/agent.js（esbuild 打包单文件，SFTP 自动部署）
    ├── WebSocket 服务（只监听 127.0.0.1:39099）
    ├── 管理 claude CLI 子进程
    └── 环形输出缓冲区（最大 50MB 或最近 5min，供重连续播）
```

**架构说明：**
- `RemoteAgentClient` 运行在 **Electron 主进程**，通过 IPC 与 Next.js API Route 通信。Next.js 服务端不直接建立 WebSocket，避免 Node.js 多进程端口访问复杂性。
- 本地端口**动态分配**（os.availablePort），存储在内存中，每次启动重新分配，避免多 remote host 端口冲突。

## 连接建立流程

1. 用户填写 Remote Host 配置（host / port / username / 认证 / 工作目录）
2. `SSHManager.connect()` 建立 SSH 连接
3. `SetupChecker` 通过 SSH exec 逐项检测：
   - `node --version` — 缺失则引导安装
   - `claude --version` — 缺失则引导安装
   - `~/.codepilot/agent.js` — 不存在或版本旧则 SFTP 部署
4. SSH exec 启动 agent：`node ~/.codepilot/agent.js --port 39099`
5. 分配本地空闲端口，建立端口转发
6. RemoteAgentClient（主进程）建立 WebSocket 连接，发送 `ping` 确认 agent 就绪
7. 连接就绪，新建会话时可选择该 remote host

## 引导安装

**OS 检测**：SetupChecker 通过 SSH exec `uname -s` 检测远程 OS（`Darwin` = macOS，`Linux` = Linux）。

检测到缺失时，UI 展示检测结果 + 两种路径：
- **手动引导（默认）**：根据 OS 显示对应命令，供用户在远程机器执行，完成后点"重试"
- **自动安装**：SSH exec 运行安装命令；若包管理器不在 PATH 中，自动降级回手动引导并提示原因

**macOS（Homebrew）：**
```bash
brew install node
npm install -g @anthropic-ai/claude-code
```

**Linux（按优先级探测可用包管理器）：**
```bash
# 优先 apt（Debian/Ubuntu）
sudo apt-get update && sudo apt-get install -y nodejs npm

# 其次 yum/dnf（RHEL/CentOS/Fedora）
sudo dnf install -y nodejs npm   # 或 yum

# 均不可用 → 降级为手动引导，建议用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts

# Claude CLI（两种 OS 相同）
npm install -g @anthropic-ai/claude-code
```

⚠ 自动安装假设：`sudo` 可用且无需密码（或用户有相应权限）；非交互 SSH shell 的 PATH 中可找到包管理器。不满足时降级为手动引导。

## 断线重连 & 任务持续

**远程 agent 行为：**
- claude CLI 进程持续运行，不因 SSH 断线中断
- 输出写入环形缓冲区（每条带递增 eventId，最大 50MB 总量上限防止 OOM）
- 缓冲区计时从最后一个事件的时间戳算起，超过 5min 的旧事件被丢弃
- 客户端重连时发送 `lastEventId`，agent 回放缓冲区后切回实时流
- 若 agent 进程重启（缓冲区丢失），返回 `session_not_found`，客户端提示用户重新发起任务

**本地重连状态机：**
```
CONNECTED → (SSH 断开) → RECONNECTING → (成功) → CONNECTED
                                ↓ 超过 5min
                           FAILED（提示用户手动重连）
                                ↓ 用户点击"重连"
                           RECONNECTING（可手动触发）
```

**UI 状态指示（顶栏）：**
- 🟢 正常连接
- 🟡 重连中（任务不中断）
- 🔴 连接失败（点击可手动重试）

## 数据模型

```sql
-- 新增表
CREATE TABLE remote_hosts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  host        TEXT NOT NULL,
  port        INTEGER DEFAULT 22,
  username    TEXT NOT NULL,
  auth_type   TEXT NOT NULL,   -- 'key' | 'password'
  key_path    TEXT,
  -- password 使用 Electron safeStorage.encryptString() 加密后存储
  -- 读取时用 safeStorage.decryptString() 解密，DB 中为加密 buffer 的 base64
  password    TEXT,
  work_dir    TEXT NOT NULL,
  agent_port  INTEGER DEFAULT 39099,
  -- ⚠ status 是运行时缓存字段，程序启动时一律重置为 'disconnected'
  status      TEXT DEFAULT 'disconnected',
  last_seen   INTEGER,
  created_at  INTEGER
);

-- 修改 chat_sessions
ALTER TABLE chat_sessions ADD COLUMN remote_host_id TEXT;
```

**密码安全存储**：使用 `electron.safeStorage`（macOS 上底层为 Keychain），与现有 `api_key` 明文存储方式不同，SSH 密码因可直接访问远程机器，必须加密。

## 新增/修改文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `remote-agent/src/index.ts` | 新建 | 远程 agent 主入口（WebSocket 服务）|
| `remote-agent/src/session-manager.ts` | 新建 | claude CLI 进程管理 + 环形缓冲区 |
| `remote-agent/build.ts` | 新建 | esbuild 打包脚本，输出 `remote-agent/dist/agent.js` |
| `src/lib/remote/ssh-manager.ts` | 新建 | SSH 连接 + 动态端口分配 + 端口转发 + 重连状态机 |
| `src/lib/remote/agent-client.ts` | 新建 | WebSocket 客户端（主进程中运行，对接 remote agent）|
| `src/lib/remote/setup-checker.ts` | 新建 | 环境检测 + 引导安装逻辑 |
| `src/app/api/remote/hosts/route.ts` | 新建 | Remote host CRUD API |
| `src/components/remote/RemoteHostList.tsx` | 新建 | 远程主机列表 |
| `src/components/remote/AddHostDialog.tsx` | 新建 | 添加/编辑 remote host 对话框 |
| `src/components/remote/ConnectionStatus.tsx` | 新建 | 顶栏连接状态指示器 |
| `src/components/remote/SetupGuide.tsx` | 新建 | 环境检测 + 安装引导 UI |
| `src/lib/claude-client.ts` | 修改 | spawn 时判断是否走 remote agent（通过 IPC）|
| `electron/main.ts` | 修改 | IPC 处理 SSH 操作 + agent WebSocket 代理 |
| `electron/preload.ts` | 修改 | 暴露 remote connect IPC API |
| `src/lib/db.ts` | 修改 | remote_hosts 表 + sessions 字段迁移；启动时重置 status |
| `src/types/index.ts` | 修改 | RemoteHost、RemoteConnectionStatus 类型 |
| `src/i18n/en.ts` + `zh.ts` | 修改 | remote connect 相关 i18n 字符串 |

## 新增依赖

- `ssh2` — SSH 连接 + 端口转发（Electron 主进程）
- `ws` — WebSocket 服务端（remote agent）
- `esbuild` — remote agent 打包（devDependency）

## Remote Agent Wire Protocol

```
// 发起会话
Client → Agent: { type: 'start_session', sessionId, workDir, options }

// 续接会话（重连时）
Client → Agent: { type: 'resume_session', sessionId, lastEventId }

// Agent 回放缓冲区（重连成功后）
Agent → Client: { type: 'buffered_events', sessionId, events: SDKEvent[] }

// 实时事件
Agent → Client: { type: 'event', sessionId, eventId: number, event: SDKEvent }

// 任务正常结束
Agent → Client: { type: 'session_complete', sessionId, result }

// 任务异常退出
Agent → Client: { type: 'session_error', sessionId, error: string }

// 续接失败（agent 重启，缓冲区丢失）
Agent → Client: { type: 'session_not_found', sessionId }
// 客户端收到后：提示用户"任务状态丢失，需重新发起"

// 中止
Client → Agent: { type: 'abort_session', sessionId }

// 心跳
Client → Agent: { type: 'ping' }
Agent → Client: { type: 'pong' }
```

**连接复用**：1 台远程主机对应 1 条 SSH 连接 + 1 条 WebSocket 隧道，所有 session（项目）共享该连接。SSH 断线时该主机上所有运行中的 session 均暂停缓冲等待重连，任务不中断，重连后全部自动续流。

**多客户端并发**：同一 sessionId 同时只允许一个客户端连接（后连接者收到 `session_taken` 错误）。

## Remote Agent 打包与部署

- `remote-agent/` 下独立维护，用 esbuild 打包为单文件 `dist/agent.js`（无需 node_modules）
- 打包产物内嵌版本号；`SetupChecker` 检查远程 agent 版本，旧版本自动通过 SFTP 覆盖升级
- 启动命令：`node ~/.codepilot/agent.js --port 39099`

## 验证方式

**功能验证：**
- 新增 remote host → 连接成功（SSH key + password 各一遍）
- 错误 key 路径 → 显示明确错误提示
- 本地端口被占用 → 自动选下一个端口，连接不失败
- 缺少 Node.js/claude CLI → 手动引导流程正常；自动安装路径（brew 存在时）正常
- 发起耗时任务 → 手动断开 SSH → 确认任务持续运行
- 重连后 → 确认输出从断点续流（lastEventId 正确）
- Agent 重启后续接 → 收到 session_not_found，UI 提示用户
- 两个 remote host 同时连接 → 端口不冲突，各自正常工作
- 关闭 CodePilot 重开 → status 重置为 disconnected，可重新连接

**CDP 验证（UI）：**
- 顶栏状态指示器（🟢/🟡/🔴）显示正确
- 断线时显示重连中，不影响已有 UI 操作
- FAILED 状态下点击可手动触发重连
- 新建会话可选 remote host
- 会话列表能区分本地/远程会话
