## CodePilot v0.49.0

> Agent Runtime 能力大升级 — 借鉴 Hermes Agent 框架的 6 项核心能力 + 12 项额外改进。Native Runtime 用户将获得更智能的工具调度、更低的 API 成本、跨会话记忆、以及全新的交互式提问和 Skill 建议功能。

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

- **历史会话搜索**：Agent 现在可以搜索所有历史对话的内容。当你说"上次我们讨论 X 的结论是什么"时，它能自动检索并引用之前的对话，不再需要手动翻找和复制
- **Skill 自动保存建议**：当 Agent 完成一个复杂多步工作流（8+ 步骤、3+ 种工具）后，会在对话区底部弹出持久提示条，建议你把这个流程保存为可复用的 Skill。点击"保存为 Skill"按钮可一键启动保存流程
- **结构化提问（AskUserQuestion）**：Agent 现在可以向你提出结构化的多选题，而不只是文字提问。当需要你在多个方案之间做选择时，会弹出带选项按钮的交互卡片，所有问题必须回答完整才能提交
- **辅助模型自动路由**：上下文压缩、摘要等辅助任务现在会自动使用你配置中的小模型（如 Haiku），不再消耗主模型的额度。支持 5 级智能降级，即使主服务商不可用也能自动切换到备用服务商
- **上下文压缩通知**：长对话触发自动压缩时，状态栏会显示"已压缩 N 条消息，节省约 X tokens"的提示，持续 5 秒，让你知道发生了什么

### 优化改进

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

### 基础设施（开发者相关）

- 并行安全调度模块（parallel-safety.ts）：4 层判定算法已就绪，等待 AI SDK 提供 batch 级 hook 后接入
- 渐进式子目录发现模块（subdirectory-hint-tracker.ts）：AGENTS.md/CLAUDE.md 懒加载已就绪，等待 agent-tools.ts 集成
- Token 预算裁剪模块（pruneOldToolResultsByBudget）：可选的增强裁剪策略已就绪
- 新增 ~90 个单元测试，覆盖所有新模块
## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.49.0/CodePilot-0.49.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.49.0/CodePilot-0.49.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.49.0/CodePilot.Setup.0.49.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 可选安装 Claude Code CLI 以获得完整命令行能力
