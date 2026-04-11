## CodePilot v0.48.1

> v0.48.0 发布后的紧急修复，解决 Runtime 选择、看板渲染、数据库约束等问题。

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
- Runtime 选择现在精确匹配请求使用的服务商凭据，不再被无关服务商干扰
- 显式选择 Claude Code 引擎时始终尊重用户选择，不再因凭据检查误判
- 服务商过期引用（如删除服务商后的残留绑定）现在正确回退到可用服务商

### 修复问题

- 修复了文件回退（Rewind）可能丢失会话前未提交修改的问题
- 修复了中断对话在 Claude Code 引擎下不生效的问题
- 修复了带附件消息在多轮对话中丢失的问题
- 修复了 OpenAI OAuth 登录成功页在 token 交换失败时仍显示成功的问题
- 修复了 OAuth callback 服务器监听所有网卡的安全问题，改为仅监听 localhost
- 修复了只配置第三方服务商（如智谱、Kimi）时，自动模式错误选择 Claude Code 引擎导致无法使用的问题
- 修复了 Native 引擎下大量请求被误判为"空响应"的问题
- 修复了看板面板中 Widget 样式丢失、内容被裁切的问题
- 修复了删除会话时可能出现的数据库外键约束错误
- 修复了 OpenAI Codex API 连接超时没有明确提示的问题，现在会建议配置代理
- 修复了更新通知弹窗在每次启动时重复弹出的问题

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.48.1/CodePilot-0.48.1-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.48.1/CodePilot-0.48.1-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.48.1/CodePilot.Setup.0.48.1.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 可选安装 Claude Code CLI 以获得完整命令行能力
