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

## sdkProxyOnly Providers（MiniMax / Kimi / GLM 等）

⚠️ `provider-resolver.ts` `buildResolution()` 中对这类 provider 有以下特殊处理：
- `settingSources` 为 `['user']`（**所有 DB-backed provider 统一**）— cc-switch 环境变量泄漏通过 per-request shadow HOME（`sdk-subprocess-env.ts` + `claude-home-shadow.ts`）在文件系统层隔离：shadow HOME 中的 `settings.json` 会删除 `ANTHROPIC_*` 键，保留其余配置（skills/hooks/MCP）
  - **v0.50.2 变更**：不再依赖 `settingSources` 排除来防止凭据泄漏（旧方案：sdkProxyOnly = `['project','local']`，副作用是禁用 `~/.claude/` 下的 skills/hooks）
  - shadow HOME 方案更完整：`'user'` 留在 settingSources，用户的 skills/hooks/MCP 对所有 provider 均可用
- catalog `defaultEnvOverrides` 在运行时合并为 base（DB 值优先）— 确保 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 等始终生效（不依赖 DB 是否保存）
- `claude-client.ts` 中跳过 `thinking` 参数和默认 `effort: 'medium'` — 这类 provider 的代理协议不支持

## Bridge 子模块

见 `bridge/CLAUDE.md`

## stream-session-manager.ts（⚠️ 仅客户端）

⚠️ 该模块是 **Electron 渲染进程**的客户端单例，只能从 hooks/组件中调用。
从 Next.js API Route 导入会访问空的 `globalThis` Map（无报错但无效）。
- 流 GC、活跃流读取必须在前端组件中直接调用
- 需要服务端数据（DB 大小、session 数）时，通过 API Route 获取后传回前端

## 定时任务日志（task_run_logs）

`task_run_logs` 在任务**启动时**立即写入 `status: 'running'`，执行中每秒更新 partial result，完成时 update 同一行为 `success`/`error`。
- `insertTaskRunLog()` 返回 log `id`（`string`），配合 `updateTaskRunLog(id, updates)` 实现"启动写 log、完成时更新"的模式
- 前端轮询策略：1s interval，检测到 running→terminal 状态变化时停止，超时上限 120s
- `task_run_logs.status` 无 CHECK 约束，写 `'running'` 合法（schema 只有 NOT NULL）

## db.ts 新增 helper 的注意事项

⚠️ `DB_PATH` 是私有常量，不能直接导出。
需要操作 DB 文件路径时，封装成 helper 函数暴露（如 `getDbSizeMb()`）。
