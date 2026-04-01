# Remote Hosts 产品思考

> 技术实现见 [`docs/handover/remote-hosts.md`](../handover/remote-hosts.md)

## 解决了什么用户问题

**核心痛点：用户的计算资源在云端，但 AI 工具在本地。**

典型场景：
- 开发者在 MacBook 上工作，但项目跑在 Linux 服务器或云主机上（大型 monorepo、GPU 机器、内网代码库）
- 公司安全策略要求代码不能离开特定服务器，但又想用 AI 辅助编码
- 本地机器性能不足，claude CLI 的大量文件索引操作需要在高性能机器上完成

没有 Remote Host 功能前，用户只能 SSH 登录远端手动操作终端，失去了 CodePilot 的 GUI、对话历史、多会话管理等所有优势。

---

## 为什么这样设计

### SSH 隧道而非中继服务器

**方案 A（选择）：** SSH 隧道 + 本地 WebSocket 代理  
**方案 B（放弃）：** 中继服务器（用户需要一个始终在线的第三方）  
**方案 C（放弃）：** 直接 WebSocket 暴露到公网（安全风险）

选择 SSH 隧道的原因：
1. **零基础设施**：用户已有 SSH 访问，无需额外服务
2. **安全模型清晰**：复用 SSH 的认证和加密，agent 只绑定 127.0.0.1
3. **符合现有习惯**：开发者对 SSH 端口转发非常熟悉

### 独立 Agent 而非 claude CLI 直接 WebSocket

claude CLI 是为 TTY 设计的，没有原生 WebSocket 接口。在远端运行一个轻量 Node.js agent（单文件，由 esbuild 打包）作为 WebSocket 服务器，代理 claude 子进程，是最小侵入的方案。

agent 单文件部署（SFTP 上传）避免了在远端执行 npm install 的依赖问题。

### 断线重连设计

网络不稳定（VPN、公司 WiFi）是远程开发的常见问题。Ring buffer + eventId 重放机制让用户在短暂断线后能看到完整的 AI 响应，而不是一片空白。50MB 上限是基于"一个正常 AI 会话不太可能超过这个量"的经验估算。

### 连接流程的 7 步 UX

首次连接需要：SSH 握手 → 环境检测 → 可能的安装引导 → agent 部署 → agent 启动 → 隧道建立 → WS 连接。这个流程比本地启动复杂得多，所以设计了 `SetupGuide` 明确展示每一步，而不是一个"连接中..."的 spinner 让用户不知道发生了什么。

---

## 设计参考

- **VS Code Remote - SSH**：业界标准参考，用户对"远程开发 = SSH 隧道"的认知模式主要来自 VS Code
- **Cursor Remote**：同类工具，但依赖中继服务器，有隐私顾虑
- **JetBrains Gateway**：功能全面但重量级，适合超大型项目；CodePilot 的场景更轻量

CodePilot 的差异化：聚焦 AI 对话体验的连续性（断线重连、历史回放），而不是完整的远程开发 IDE。

---

## 已知局限

1. **Windows 远端不支持**：`nohup`、`nc -z` 等 Unix 命令不可用；如有需求需要单独适配
2. **仅支持密码 + SSH Key 两种认证**：不支持 SSH Agent Forwarding、Kerberos 等企业场景
3. **单一 agent 进程**：多用户/多会话并发连接到同一 agent 时可能有竞争（当前设计假设单用户）
4. **端口范围固定（39100–39199）**：如果用户有其他服务占用该范围，会连接失败；尚无自定义配置入口
5. **agent 日志无 UI 查看方式**：日志写到 `~/.codepilot/agent.log`，目前只能 SSH 手动查看

---

## 未来方向

- **多 agent 实例**：支持同时连接多台主机，会话路由到对应 agent
- **agent 自动更新**：版本检测已有，但自动更新流程还需要完善（目前需用户手动触发重新部署）
- **连接配置导入/导出**：方便团队共享远端主机配置（去除密码后的模板）
- **Windows 远端支持**：需要 PowerShell 替代 Unix 命令
