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
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.45.0/CodePilot-0.45.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.45.0/CodePilot-Setup-0.45.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
