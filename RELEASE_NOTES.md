## CodePilot v0.50.2

> 飞书一键创建机器人 + SubAgent UI 可视化 + 消息队列模式 + 桥接稳定性大修 + 稳定性与凭据隔离专项修复 — 推荐所有用户升级。

### 继承自 v0.48.x 的功能

- 双 Agent 引擎可选：AI SDK 引擎（开箱即用，支持多服务商）和 Claude Code 引擎（通过 CLI 驱动，完整命令行能力），可在设置中自由切换
- OpenAI 授权登录：ChatGPT Plus/Pro 用户可在服务商设置中通过 OAuth 登录，直接使用 GPT-5.4、GPT-5.4-Mini、GPT-5.3-Codex 等模型
- 输入框下方新增 Agent 引擎状态标记，显示当前实际使用的引擎，hover 可查看详情并跳转设置
- 首次打开自动检测系统语言，中文系统自动切换为中文界面

### 修复问题（v0.48.x 延续）

- **第三方服务商设为默认后无法使用**：设置阿里云百炼、智谱、OpenRouter 等第三方服务商为默认后，新对话首条消息报 "No provider credentials available" 或进程崩溃的问题。根因是 UI 上的"当前选中"标记被错误地当作"启用/禁用"过滤，导致用户明确设置的默认服务商被忽略
- **编辑第三方服务商后测试连接失败**：之前前端会把编辑对话框里显示的遮罩密钥（`***xxx`）原样发送给服务器做测试，导致一律 401。现在未改动时后端自动从数据库读取真实密钥
- **重命名对话点了没反应**：macOS / Windows 上点击左侧会话列表三点菜单 → 重命名对话后，输入框无法打开的问题（Electron 禁用了 window.prompt）
- **诊断页面的误导性警告**：Claude Code 诊断日志中出现的 "Provider is inactive, re-resolving" 警告实际上是代码逻辑 bug，会让用户误以为配置有问题。已清除
- **切换认证方式后测试使用旧凭证**：服务商编辑对话框切换 API Key / Auth Token 时的状态迁移不一致，可能导致测试连接使用错误凭证

### 新增功能

- **飞书一键创建机器人**：设置 → 飞书设置 → "创建并绑定飞书应用"，浏览器自动打开飞书授权页面，确认后 Bot 能力、权限、事件订阅和长连接模式全部自动配置，无需再手动进飞书开放平台后台
- **SubAgent 执行过程可视化**：Agent 调用子代理（explore / general）时，工具面板会显示闪电图标和子代理的嵌套工具调用进度（带 spinner / 完成 / 失败状态指示）
- **输入框草稿持久化**：在一个聊天中打了字还没发送，切换到别的聊天再切回来，输入内容仍然保留（按会话分别保存）
- **消息队列模式**：AI 正在响应时继续输入并回车，消息会显示在输入框上方的队列卡片里，AI 回复完成后自动发送。支持取消队列中的消息，参考 Codex 设计
- **飞书 AskUserQuestion 交互卡片**：Agent 在飞书桥接中使用 AskUserQuestion 时，现在会渲染为带选项按钮的交互卡片（之前直接被拒绝），点击选项即可继续对话
- **飞书资源消息支持**：飞书桥接现在可以接收图片、文件、音频、视频消息，自动下载并附加到对话上下文（带重试和 20MB 大小限制）

### 修复问题

- **cc-switch 切换 provider 后请求被默默改路由**（#461/#478/#476/#457/#470/#474）：显式选择 Kimi/GLM/OpenRouter 等第三方 provider 时，`~/.claude/settings.json` 里 cc-switch 写入的 `ANTHROPIC_*` 环境变量不再覆盖你选的 provider 凭据；env group（无显式 provider）则继续完整尊重 cc-switch 配置。每个请求建临时 shadow HOME 做隔离，不影响任何原有文件
- **OpenAI OAuth 登录 "Token exchange failed: 403 - [object Object]"**（#464）：macOS/Windows 用户在边缘节点 propagation 延迟时登录失败。现加 3 次指数退避重试（1s/2s/4s），对 403、408、429、5xx、网络级失败（ECONNRESET/ETIMEDOUT/ECONNREFUSED/ENOTFOUND）自动重试；错误消息不再出现 `[object Object]`
- **升级后 localStorage 配置全丢（主题 / 默认模型 / 工作目录记忆）**（#465/#466/#477）：Electron 每次启动 renderer origin 变化导致 localStorage 整体作废。改用 47823-47830 稳定端口范围，并修复"探测后释放再绑定"的 TOCTOU race（两实例同时启动不再相互踢掉）
- **v0.49.0+ 长对话卡死 "AI_MissingToolResultsError"**：v0.49.0 Hermes 升级把上下文窗口的近期轮次数从 16 降到 6，导致工具密集对话中 `tool_use` 块还在窗口内、配对的 `tool_result` 被截断，Vercel AI SDK 抛错卡死。恢复为 16 轮，截断标记改为 `[Pruned <toolName> result: ...]` 让模型仍能配对
- **第三方 provider 发消息报 "streamClaudeSdk is not a function"**：Next.js 16 + Turbopack 的 CJS↔ESM interop 问题，影响 chat 主路径。把 5 处内部 lazy `require()` 改为静态 ES import 修复
- **内置 Memory / Widget / Notify 等 MCP 被反复弹权限确认**：cc-switch 桥接工作上线后被误触发。7 个 CodePilot 内置 MCP 现通过 `allowedTools` 自动批准（用户自装的 MCP 仍按原权限模式走）
- **Windows 报 "Claude Code executable not found"**：247 events/14d 的 Sentry 顶部错误。SDK cli.js 之前没被复制到 standalone bundle，现加入 `serverExternalPackages` 让 SDK 随 `extraResources` 完整保留
- **切换会话后计时器归零**（#480/#484）：`ElapsedTimer` 之前 mount 时用 `Date.now()` 当起点，session 切换 remount 归零。改为从 stream-session-manager 透传起点时间，remount 后基于真实起点恢复
- **选 slash 命令清空已输入文本**（#479/#486）：弹窗选命令时触发位前后的用户已输入内容会被清掉。现在保留文本，光标定位到末尾
- **Skills 弹窗误触发 / 不能多选 / badge 占地方**：输入框里带单斜杠路径（`src/app`、`foo/bar`、`~/bin`）不再误触发弹窗；点击斜杠按钮时如前面是非空白字符会自动补空格，`hello` → `hello /` 正常弹出 Skills 选择器；支持同时选多个 Skills（按 command 去重），发送时合并为一条 prompt；badge 显示只保留命令名，去掉占地方的描述文字
- **findClaudeBinary 首次启动误报**：WSL2 / 跨境 VPN 用户 timeout 3s 改 5s；两遍策略先找存在路径再做 `--version` 校验，校验超时但文件存在仍返回该路径
- **OpenAI OAuth 误重试浪费时间**：token exchange 的真实 auth 错误（400/401/404/422）不再参与重试

### 优化改进

- 队列中的消息以卡片形式悬浮在输入框上方（参考 Codex），可随时取消，不再混在聊天流里造成"两条用户消息一条没回复"的视觉错觉
- Streaming 中输入时按钮图标智能切换：空输入 → 终止图标，有内容 → 发送图标（只对纯文本有效；slash 命令 / badge / Image Agent 保持终止图标避免误导）
- 飞书快速创建支持已有应用场景：点击"已有飞书应用？点击手动配置"可展开原有的 App ID / App Secret 手动录入表单
- 飞书多 question / multi-select 的 AskUserQuestion 会被明确拒绝并附带清晰原因，不再静默截断成半截答案
- 飞书 bot identity 启动失败后会每 60s 后台重试，不再永久 fail-open（#384 的边界情况）
- 辅助模型路由现在正确识别当前会话的服务商，不再错误使用全局默认服务商的凭证进行压缩
- Bridge/IM 场景下 AskUserQuestion 会被明确拒绝并提示模型改用文字提问，而不是静默返回空答案
- 权限系统新增"总是需要交互"工具类别，AskUserQuestion 和 ExitPlanMode 即使在信任模式下也会弹出 UI
- permission-registry 的超时计时器添加了 unref()，不再阻止应用优雅退出
- 上下文压缩器 shouldAutoCompact 标记为 @deprecated，指向真正在用的 needsCompression
- 会话重命名改用应用内对话框，支持 Enter 提交、Esc 取消、打开时自动全选原标题方便直接替换
- 测试连接按钮状态对齐完整的密钥生命周期：无密钥禁用、保留原密钥可测、标记清除后禁用（避免测试旧密钥却保存新状态的误导性成功）
- 服务商编辑对话框的 API Key 输入框在编辑态显示"已保存，留空则沿用原密钥"提示，不再泄露遮罩字符串
- 首次设置引导优化：Claude Code CLI 标记为"可选"，新用户无需安装 CLI 即可开始使用
- 内置工具全量注册：通知、素材管理、仪表盘、记忆搜索、CLI 工具管理等 29 个工具始终可用，不再依赖关键词触发
- 内置工具（codepilot_* 系列）跳过权限审批，减少不必要的确认弹窗
- 系统提示词全面升级：参考 Claude Code 和 OpenCode 的提示词体系，提升代码生成质量
- MCP 工具完整支持：外部 MCP 服务器的工具在 AI SDK 引擎下也能正常使用
- 错误监控扩展：新增 Native 引擎专属错误类别和 Sentry 上报，便于问题定位
- Runtime 选择现在精确匹配请求使用的服务商凭据，不再被无关服务商干扰
- 显式选择 Claude Code 引擎时始终尊重用户选择，不再因凭据检查误判
- 服务商过期引用（如删除服务商后的残留绑定）现在正确回退到可用服务商
- Sentry 服务端 `ignoreErrors` 补齐 `prompt() is not supported`（Electron 未实现）和 `ResizeObserver loop` 两条规则，与 client 端同步（368 events/14d 噪声清理）
- 内置 MCP 启动失败错误提示更清晰

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.50.2/CodePilot-0.50.2-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.50.2/CodePilot-0.50.2-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.50.2/CodePilot.Setup.0.50.2.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 推荐安装 Claude Code CLI 以获得完整功能
