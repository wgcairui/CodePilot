# Bridge 模块

多 IM 远程桥接系统，通过 Telegram（后续可扩展）远程操控 CodePilot 中的 Claude 会话。

## 关键约定

- `bridge-manager.ts` 中 `runAdapterLoop()` 必须在 `state.running = true` 之后调用（async IIFE 的 while 条件在首个 await 前同步求值）
- `telegram-bot.ts`（通知模式）与 bridge adapter 互斥，通过 `globalThis` 上的 `bridgeModeActive` 标志协调，防止 HMR 重置
- Offset 安全水位：`fetchOffset`（API 调用）与 `committedOffset`（持久化）分离，仅 handleMessage 完成后才推进 committed
- 新增 adapter 只需实现 `BaseChannelAdapter` + 调用 `registerAdapterFactory()` 自注册 + `adapters/index.ts` 加 import

## 调度器 Bridge 推送（task-scheduler.ts）

- `getAdapter(channelType)` 从 `bridge-manager.ts` **直接**导出（不是 `getBridgeManager().getAdapter()`）
- ⚠️ WeChat chatId 本身含 `::` — 复合键 `channelType::chatId` 拆分必须用 `indexOf` 取第一个 `::`，不能用 `split('::')[0]`
- Bridge 推送字段存为非规范化列（`bridge_channel_type` + `bridge_chat_id`），不用 FK — 绑定重建后任务配置仍有效

## `runAdapterLoop` 递归模式注意事项

`runAdapterLoop` 在退避重连失败时递归调用自身，每次调用都会用新的 `AbortController` 覆盖 `loopAborts` 中的旧条目。旧 controller 不需要主动 abort（调用方的 IIFE 已经退出），`stop()` 始终操作最新的 controller。
⚠️ 不要在 `runAdapterLoop(adapter)` 递归调用语句**之后**添加任何逻辑——调用栈假设它是最后一条语句。

## 详细架构

见 `docs/handover/bridge-system.md`
