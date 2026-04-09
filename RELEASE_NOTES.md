## CodePilot v0.48.0

> 全新 Agent 引擎架构：无需安装 Claude Code CLI 即可完整使用，同时支持 OpenAI 授权登录。

### 新增功能

- 双 Agent 引擎可选：AI SDK 引擎（开箱即用，支持多服务商）和 Claude Code 引擎（通过 CLI 驱动，完整命令行能力），可在设置中自由切换
- OpenAI 授权登录：ChatGPT Plus/Pro 用户可在服务商设置中通过 OAuth 登录，直接使用 GPT-5.4、GPT-5.4-Mini、GPT-5.3-Codex 等模型
- 输入框下方新增 Agent 引擎状态标记，显示当前实际使用的引擎，hover 可查看详情并跳转设置
- 首次打开自动检测系统语言，中文系统自动切换为中文界面

### 优化改进

- 首次设置引导优化：Claude Code CLI 标记为"可选"，新用户无需安装 CLI 即可开始使用
- 内置工具全量注册：通知、素材管理、仪表盘、记忆搜索、CLI 工具管理等 29 个工具始终可用，不再依赖关键词触发
- 内置工具（codepilot_* 系列）跳过权限审批，减少不必要的确认弹窗
- 系统提示词全面升级：参考 Claude Code 和 OpenCode 的提示词体系，提升代码生成质量
- MCP 工具完整支持：外部 MCP 服务器的工具在 AI SDK 引擎下也能正常使用
- 错误监控扩展：新增 Native 引擎专属错误类别和 Sentry 上报，便于问题定位

### 修复问题

- 修复了文件回退（Rewind）可能丢失会话前未提交修改的问题
- 修复了中断对话在 Claude Code 引擎下不生效的问题
- 修复了带附件消息在多轮对话中丢失的问题
- 修复了 OpenAI OAuth 登录成功页在 token 交换失败时仍显示成功的问题
- 修复了 OAuth callback 服务器监听所有网卡的安全问题，改为仅监听 localhost

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.48.0/CodePilot-0.48.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.48.0/CodePilot-0.48.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.48.0/CodePilot.Setup.0.48.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能

---

## CodePilot v0.45.0

> 内存优化专项：全面治理客户端内存占用，涵盖缓存淘汰、流式加载、懒加载、消息窗口化等多项改进。同时包含上下文管理系统和 CLI 升级能力。

### 新增功能

- 新增上下文管理系统：自动测量 token 用量、智能压缩长对话、改进的上下文回退策略
- 新增 CLI 版本检测和一键升级功能，在设置页直接管理 Claude Code CLI
- 新增系统代理自动透传，VPN/代理用户无需手动配置即可正常使用

### 优化改进

- 代码高亮缓存（Shiki）加入 LRU 淘汰策略，不再随代码块种类无限增长
- 侧边面板（文件预览、Git、文件树、看板、助理）改为按需加载，未打开时不占用内存
- Markdown 渲染引擎及插件改为懒加载，仅在实际需要渲染时才加载
- 终端输出加入 500KB 硬上限，长时间运行的命令不再无限累积内存
- 聊天消息列表加入 300 条滑动窗口，超出部分自动卸载、上翻时按需重新加载
- 文件预览改为流式读取，不再将整个大文件加载到内存中
- 大文件（>10MB）的图片、视频、音频预览改为流式传输
- 图片上传后立即释放 base64 数据，仅在发送给 AI 时按需从磁盘读取
- 图片引用缓存加入容量上限（50 条）和自动淘汰
- 流式会话管理器中的定时器全部纳入统一追踪，会话结束时确保清理
- 工具输出预览窗口从 5000 字符缩减至 2000 字符

### 修复问题

- 修复多张图片引用时保留策略错误的问题，现在正确保留最新的图片
- 修复上下文压缩后 token 预算计算不准确的问题
- 修复压缩器模型回退和服务商解析的问题

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.45.0/CodePilot-0.45.0-arm64.dmg)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 可选安装 Claude Code CLI 以获得完整命令行能力
