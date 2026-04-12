# Discord 适配器启动失败自动重连

**日期**: 2026-04-12  
**状态**: 待实现

## 问题描述

Discord 适配器在启动时因网络超时（`Connect Timeout Error`）失败后进入"已停止"状态，且永远不会自动重试。Telegram 等其他适配器可以正常运行，但 Discord 不受益于已有的退避重连机制。

## 根本原因

`bridge-manager.ts` 的 `start()` 函数中，只对 `isRunning()` 为 true 的 adapter 调用 `runAdapterLoop()`：

```typescript
// 第 334 行（问题所在）
for (const [, adapter] of state.adapters) {
  if (adapter.isRunning()) {          // ← 启动失败的 adapter 被跳过
    runAdapterLoop(adapter);
  }
}
```

`runAdapterLoop` 末尾已有完善的退避重连逻辑（30s → 60s → 120s cap），但启动失败的 adapter 从未进入该循环，因此退避重连从未触发。

## 解决方案

**方案 B（最小改动 + UI 重连状态）**：

1. 对所有注册的 adapter 无条件调用 `runAdapterLoop()`——failed adapter 的 while 循环因 `isRunning() === false` 立即退出，退避重连逻辑自然触发
2. 在 `AdapterMeta` 加 `reconnectingAt` 字段，让 UI 显示"X秒后重连"

## 改动文件

### 1. `src/lib/bridge/types.ts`

`AdapterStatus` 接口加字段：

```typescript
export interface AdapterStatus {
  channelType: ChannelType;
  running: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
  reconnectingAt: string | null;   // 新增：下次重连时间戳（null = 未在重连）
}
```

### 2. `src/lib/bridge/bridge-manager.ts`

**改动 A**：`AdapterMeta` 加字段：
```typescript
interface AdapterMeta {
  lastMessageAt: string | null;
  lastError: string | null;
  restartAttempts?: number;
  reconnectingAt?: string | null;   // 新增
}
```

**改动 B**：`start()` 中去掉 `isRunning()` 条件：
```typescript
// 改前
for (const [, adapter] of state.adapters) {
  if (adapter.isRunning()) {
    runAdapterLoop(adapter);
  }
}

// 改后
for (const [, adapter] of state.adapters) {
  runAdapterLoop(adapter);
}
```

**改动 C**：`runAdapterLoop` 退避等待前/后维护 `reconnectingAt`：
```typescript
// 退避等待前（已有的退避计算逻辑之后）
meta.reconnectingAt = new Date(Date.now() + delayMs).toISOString();
state.adapterMeta.set(adapter.channelType, meta);

await new Promise(r => setTimeout(r, delayMs));

// 成功重启后清空
meta.reconnectingAt = null;
meta.restartAttempts = 0;
meta.lastError = null;
```

**改动 D**：`getStatus()` 透传 `reconnectingAt`：
```typescript
return {
  channelType: adapter.channelType,
  running: adapter.isRunning(),
  connectedAt: state.startedAt,
  lastMessageAt: meta?.lastMessageAt ?? null,
  error: meta?.lastError ?? null,
  reconnectingAt: meta?.reconnectingAt ?? null,   // 新增
};
```

### 3. `src/components/bridge/BridgeSection.tsx`

适配器状态徽章逻辑：

| 状态 | 样式 | 文本 |
|------|------|------|
| `running=true` | 绿色 | "运行中"（不变） |
| `running=false && reconnectingAt` | 黄色 | "X秒后重连" |
| `running=false && !reconnectingAt` | 灰色 | "已停止"（不变） |

倒计时计算：
```typescript
const secondsUntilRetry = Math.max(
  0,
  Math.round((new Date(adapter.reconnectingAt!).getTime() - Date.now()) / 1000)
);
```

### 4. `src/i18n/en.ts` + `src/i18n/zh.ts`

新增 i18n key：
```typescript
// en.ts
"bridge.adapterReconnecting": "Reconnecting in {seconds}s"

// zh.ts
"bridge.adapterReconnecting": "{seconds}秒后重连"
```

## 约束 & 不变量

- 退避上限保持 120s（`Math.min(30_000 * Math.pow(2, attempt), 120_000)`）
- `validateConfig()` 仍过滤配置无效的 adapter（不重试 config 错误）
- 全部 adapter 启动失败时 `start()` 提前返回的路径不变（方案 A，暂不处理）
- `restartAttempts` 累计逻辑不变，成功后归零

## 测试验证

1. 断网启动应用，启用 Discord → 应看到黄色"30秒后重连"徽章
2. 等待 30s 后恢复网络 → Discord 应自动变为"运行中"
3. 运行 `npm run test` 确保 typecheck + 单元测试通过
