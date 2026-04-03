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
- `settingSources` 为 `['project', 'local']`（**不含 `'user'`**）— 防止 `~/.claude/settings.json` 的 `env` 节覆盖 provider 凭据
  - SDK 加载 settings.json 的 `env` 节会**叠加覆盖** process.env（不是反过来），因此 process.env 保护无效
  - ⚠️ 不能将 `'user'` 加入 sdkProxyOnly providers 的 settingSources，否则用户的 `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` 会覆盖 MiniMax/Kimi 凭据，导致 "Invalid API Key" 错误
  - 副作用：`~/.claude/` 下的 skills/hooks 对这类 provider 不可用（结构性限制，SDK API 无法区分 env 和 plugins）
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

⚠️ `task_run_logs` 仅在任务**完成后**写入 — 触发 "立即执行" 后日志不会立即出现，需轮询（建议 3s interval，最长 60s）

## db.ts 新增 helper 的注意事项

⚠️ `DB_PATH` 是私有常量，不能直接导出。
需要操作 DB 文件路径时，封装成 helper 函数暴露（如 `getDbSizeMb()`）。
