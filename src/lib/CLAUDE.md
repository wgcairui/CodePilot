# src/lib — 核心业务逻辑

## Dashboard Widget 生成链路

⚠️ Pin 操作**不直接写文件** — 点击 Pin 按钮 → 发消息给 AI → AI 调用 MCP tool `codepilot_dashboard_pin` → 写文件系统。
原因：让 AI 从对话上下文推断 `dataContract` 和 `dataSource`（刷新所需元数据）。

关键文件：
- `claude-client.ts` — 关键词门控：prompt 含 dashboard/看板/图表等词时才注册对应 MCP Server（延迟加载）
- `dashboard-mcp.ts` — 5 个 MCP 工具：pin / list / refresh / update / remove
- `dashboard-store.ts` — 读写 `{workDir}/.codepilot/dashboard/dashboard.json`（每个项目独立）
- `widget-guidelines.ts` — Widget 设计规范 system prompt，关键词门控注入
- `widget-sanitizer.ts` — DOMPurify 白名单过滤 AI 生成 HTML

⚠️ 三套 MCP Server 各自独立关键词门控：`codepilot-widget`（图表生成）、`codepilot-dashboard`（看板管理）、`codepilot-media`（媒体生成）

## 非流式 AI 调用

`generateTextFromProvider({ providerId, model, system, prompt, maxTokens })` in `text-generator.ts` — 返回完整字符串，适合 commit message / 摘要等短文本生成。
- 获取默认 provider：`resolveProvider()`（无参数）
- 选最便宜模型：`resolved.roleModels.haiku || resolved.roleModels.small || 'claude-haiku-4-5-20251001'`
- 非 Anthropic provider 无 haiku 对应物，直接用 `resolved.model`

## 新增 provider 类型时需同步四处（⚠️ 容易漏）

- `provider-catalog.ts` — 后端 vendor preset 注册（`VENDOR_PRESETS`、`Protocol` 类型）
- `src/components/settings/provider-presets.tsx` — 前端 `QUICK_PRESETS` 注册
- `src/components/settings/ProviderManager.tsx` — 如需特殊 UI（模型选择器、quota 等）
- `src/__tests__/unit/provider-resolver.test.ts` — 更新协议断言

## Bridge 子模块

见 `bridge/CLAUDE.md`
