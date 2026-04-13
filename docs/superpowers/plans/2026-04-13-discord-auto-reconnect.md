# Discord 适配器启动失败自动重连 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Discord 适配器在启动时失败（如 Connect Timeout）后不会自动重试的问题，并在 UI 上展示倒计时重连状态。

**Architecture:** 在 `bridge-manager.ts` 的 `start()` 中去掉 `isRunning()` 的条件守卫，使失败的 adapter 也进入 `runAdapterLoop()`——后者已有退避重连逻辑（30s→60s→120s cap）。同时在 `AdapterMeta` 加 `reconnectingAt` 时间戳字段，透传给前端 UI 展示倒计时徽章。

**Tech Stack:** TypeScript, React, Node.js `node:test`, discord.js (动态导入), i18next

---

## Chunk 1: 类型层改动

> 先改类型，让 TypeScript 知道 `reconnectingAt` 字段存在。后续改动均依赖这两个类型。

### Task 1: 更新 `src/lib/bridge/types.ts`

**Files:**
- Modify: `src/lib/bridge/types.ts`

- [ ] **Step 1: 在 `AdapterStatus` 接口末尾加字段**

打开 `src/lib/bridge/types.ts`，找到 `AdapterStatus` 接口（约第 119 行）：

```typescript
/** Status of a single channel adapter */
export interface AdapterStatus {
  channelType: ChannelType;
  running: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
  reconnectingAt: string | null;   // 新增：下次重连时间戳（null = 未在重连）
}
```

- [ ] **Step 2: 验证 typecheck 通过（此时 bridge-manager.ts 的 getStatus() 还没加字段，会报错，属预期行为）**

```bash
npx tsc --noEmit 2>&1 | grep "reconnectingAt" | head -20
```

预期输出：看到 `bridge-manager.ts` 中 `getStatus()` 返回值缺少 `reconnectingAt` 字段的类型错误——说明 TypeScript 已感知到新字段（后续 Task 3 修复）。

---

### Task 2: 更新 `src/hooks/useBridgeStatus.ts`

**Files:**
- Modify: `src/hooks/useBridgeStatus.ts`

- [ ] **Step 1: 在本地 `AdapterStatus` 接口加字段**

该文件有自己内联的 `AdapterStatus`（未从 `types.ts` 导入），找到约第 3 行的定义：

```typescript
interface AdapterStatus {
  channelType: string;
  running: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
  reconnectingAt: string | null;  // 新增
}
```

- [ ] **Step 2: 验证 typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "useBridgeStatus" | head -5
```

预期输出：无 `useBridgeStatus.ts` 相关错误。

---

## Chunk 2: 后端核心修复

> 这是解决 bug 的核心改动。所有修改都在 `bridge-manager.ts` 一个文件内。

### Task 3: 修改 `src/lib/bridge/bridge-manager.ts`

**Files:**
- Modify: `src/lib/bridge/bridge-manager.ts`

**改动 A — `AdapterMeta` 加字段**

- [ ] **Step 1: 找到 `AdapterMeta` 接口（约第 197–202 行），加 `reconnectingAt` 字段**

```typescript
interface AdapterMeta {
  lastMessageAt: string | null;
  lastError: string | null;
  /** Tracks consecutive restart attempts for exponential backoff. Reset to 0 on success. */
  restartAttempts?: number;
  /** ISO timestamp of next reconnect attempt. null = not currently reconnecting. */
  reconnectingAt?: string | null;
}
```

**改动 B — `start()` 去掉 `isRunning()` 守卫**

- [ ] **Step 2: 找到 `start()` 末尾启动消费循环的代码（约第 333 行），去掉条件**

将：
```typescript
  for (const [, adapter] of state.adapters) {
    if (adapter.isRunning()) {
      runAdapterLoop(adapter);
    }
  }
```

改为：
```typescript
  // Start consumer loops for all registered adapters.
  // Adapters that failed initial start have isRunning()=false; their while-loop
  // exits immediately and the backoff-restart logic at the bottom kicks in.
  for (const [, adapter] of state.adapters) {
    runAdapterLoop(adapter);
  }
```

**改动 C — `runAdapterLoop` 退避等待前/后维护 `reconnectingAt`**

- [ ] **Step 3: 找到 `runAdapterLoop` 中的退避重连块（约第 494 行）**

定位这段现有代码：
```typescript
    if (state.running && !abort.signal.aborted && !adapter.isRunning()) {
      const meta = state.adapterMeta.get(adapter.channelType) || { lastMessageAt: null, lastError: null };
      const attempt = meta.restartAttempts ?? 0;
      const delayMs = Math.min(30_000 * Math.pow(2, attempt), 120_000);
      meta.restartAttempts = attempt + 1;
      state.adapterMeta.set(adapter.channelType, meta);
      console.warn(`[bridge-manager] ${adapter.channelType} adapter stopped unexpectedly — restarting in ${delayMs / 1000}s (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delayMs));
      if (state.running && !abort.signal.aborted) {
        try {
          await adapter.start();
          meta.restartAttempts = 0;
          meta.lastError = null;
          state.adapterMeta.set(adapter.channelType, meta);
          console.log(`[bridge-manager] ${adapter.channelType} adapter restarted successfully`);
          runAdapterLoop(adapter);
        } catch (restartErr) {
          const errMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
          console.error(`[bridge-manager] ${adapter.channelType} adapter restart failed:`, errMsg);
          meta.lastError = errMsg;
          state.adapterMeta.set(adapter.channelType, meta);
          // Schedule another attempt by re-running the loop (isRunning() still false)
          runAdapterLoop(adapter);
        }
      }
    }
```

将其替换为（新增 `reconnectingAt` 的写入和清除，注意注释标注的三个分支）：
```typescript
    if (state.running && !abort.signal.aborted && !adapter.isRunning()) {
      const meta = state.adapterMeta.get(adapter.channelType) || { lastMessageAt: null, lastError: null };
      const attempt = meta.restartAttempts ?? 0;
      const delayMs = Math.min(30_000 * Math.pow(2, attempt), 120_000);
      meta.restartAttempts = attempt + 1;
      // ① 每次退避等待前设置 reconnectingAt（含初始失败和递归重试路径）
      meta.reconnectingAt = new Date(Date.now() + delayMs).toISOString();
      state.adapterMeta.set(adapter.channelType, meta);
      console.warn(`[bridge-manager] ${adapter.channelType} adapter stopped unexpectedly — restarting in ${delayMs / 1000}s (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delayMs));
      if (state.running && !abort.signal.aborted) {
        try {
          await adapter.start();
          // ② 成功分支：清空 reconnectingAt，restartAttempts 归零
          meta.reconnectingAt = null;
          meta.restartAttempts = 0;
          meta.lastError = null;
          state.adapterMeta.set(adapter.channelType, meta);
          console.log(`[bridge-manager] ${adapter.channelType} adapter restarted successfully`);
          runAdapterLoop(adapter);
        } catch (restartErr) {
          const errMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
          console.error(`[bridge-manager] ${adapter.channelType} adapter restart failed:`, errMsg);
          // ③ 失败分支：不重置 restartAttempts，不清 reconnectingAt
          //    递归调用 runAdapterLoop 时会在下次退避等待前重新写入 reconnectingAt
          meta.lastError = errMsg;
          state.adapterMeta.set(adapter.channelType, meta);
          runAdapterLoop(adapter);
        }
      }
    }
```

**改动 D — `getStatus()` 透传 `reconnectingAt`**

- [ ] **Step 4: 找到 `getStatus()` 中的 adapter 映射（约第 421 行），加字段**

将：
```typescript
      return {
        channelType: adapter.channelType,
        running: adapter.isRunning(),
        connectedAt: state.startedAt,
        lastMessageAt: meta?.lastMessageAt ?? null,
        error: meta?.lastError ?? null,
      };
```

改为：
```typescript
      return {
        channelType: adapter.channelType,
        running: adapter.isRunning(),
        connectedAt: state.startedAt,
        lastMessageAt: meta?.lastMessageAt ?? null,
        error: meta?.lastError ?? null,
        reconnectingAt: meta?.reconnectingAt ?? null,
      };
```

- [ ] **Step 5: 验证 typecheck 此时应全部通过**

```bash
npx tsc --noEmit 2>&1 | grep -E "reconnectingAt|error TS" | head -20
```

预期输出：无 `reconnectingAt` 相关错误。如有其他 TS 错误，确认是否为此次改动引入。

- [ ] **Step 6: 跑单元测试**

```bash
npm run test
```

预期输出：所有测试通过（typecheck + unit tests）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/bridge/types.ts src/hooks/useBridgeStatus.ts src/lib/bridge/bridge-manager.ts
git commit -m "fix: trigger backoff-restart loop for adapters that fail initial start

Previously runAdapterLoop() was only called for adapters where isRunning()
was true at startup. Adapters failing start() (e.g. Discord Connect Timeout)
were registered but never got a retry loop. Now all registered adapters enter
the loop; those not running immediately hit the existing backoff-restart code
(30s → 60s → 120s cap).

Also adds reconnectingAt timestamp to AdapterMeta/AdapterStatus so the UI can
show countdown state. Threaded through getStatus() for frontend consumption."
```

---

## Chunk 3: i18n + UI

> 最后加 i18n key，更新前端 badge 显示重连倒计时。

### Task 4: 添加 i18n key

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

- [ ] **Step 1: 在 `src/i18n/en.ts` 中找到 `bridge.adapterStopped` 附近，在其后添加新 key**

```typescript
"bridge.adapterReconnecting": "Reconnecting in {seconds}s",
```

- [ ] **Step 2: 在 `src/i18n/zh.ts` 中同样位置添加**

```typescript
"bridge.adapterReconnecting": "{seconds}秒后重连",
```

---

### Task 5: 更新 `src/components/bridge/BridgeSection.tsx`

**Files:**
- Modify: `src/components/bridge/BridgeSection.tsx`

- [ ] **Step 1: 确认文件顶部已导入 `useState` 和 `useEffect`**

在文件开头的 React import 中确认（通常已有，无需新增）。

- [ ] **Step 2: 在组件函数体内添加 tick 计时器**

找到文件约第 96 行的已有 `useEffect`（`fetchSettings`/`fetchModels` effect），在其**之后**插入：

```typescript
  // Drives per-second countdown re-render for reconnecting adapters.
  // Only active when at least one adapter is in reconnecting state.
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasReconnecting = bridgeStatus?.adapters.some(a => a.reconnectingAt);
    if (!hasReconnecting) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [bridgeStatus]);
```

- [ ] **Step 3: 更新 adapter 状态徽章渲染逻辑**

找到约第 399 行的徽章 div（判断 `adapter.running`），替换为：

```tsx
                  {/* adapter status badge */}
                  {(() => {
                    if (adapter.running) {
                      return (
                        <div className="rounded px-2 py-0.5 text-xs bg-status-success-muted text-status-success-foreground">
                          {t("bridge.adapterRunning")}
                        </div>
                      );
                    }
                    if (adapter.reconnectingAt) {
                      const secondsLeft = Math.max(
                        0,
                        Math.round((new Date(adapter.reconnectingAt).getTime() - Date.now()) / 1000),
                      );
                      return (
                        <div className="rounded px-2 py-0.5 text-xs bg-status-warning-muted text-status-warning-foreground">
                          {t("bridge.adapterReconnecting", { seconds: String(secondsLeft) })}
                        </div>
                      );
                    }
                    return (
                      <div className="rounded px-2 py-0.5 text-xs bg-muted text-muted-foreground">
                        {t("bridge.adapterStopped")}
                      </div>
                    );
                  })()}
```

> **注意颜色 token**：`bg-status-warning-muted` 和 `text-status-warning-foreground` 必须是项目已有的语义 token，勿使用原始 Tailwind 颜色（如 `bg-yellow-100`）。如项目中无 warning token，用 `bg-muted text-muted-foreground` 替代。运行 `npm run lint:colors` 验证。

- [ ] **Step 4: 验证 typecheck + lint**

```bash
npm run test
npm run lint:colors
```

预期：全部通过，无 raw color 警告。

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh.ts src/components/bridge/BridgeSection.tsx
git commit -m "feat: show reconnecting countdown badge for stopped bridge adapters

When a bridge adapter (e.g. Discord) is in backoff-retry state, the status
badge now shows 'Xs后重连' with a live countdown instead of a static '已停止'.
A 1s local setInterval drives re-renders only while a reconnecting adapter
exists, otherwise the timer is inactive."
```

---

## 验证清单

- [ ] `npm run test` 全部通过
- [ ] `npm run lint:colors` 无 raw color 警告
- [ ] 开发环境启动 `npm run dev`，进入远程桥接 → 适配器状态卡片：正常运行时显示绿色"运行中"，无配置时显示灰色"已停止"
- [ ] （可选手动验证）临时在 discord-adapter.ts 的 `start()` 开头加 `throw new Error('test timeout')` → 重启应用后 Discord 应显示黄色倒计时，30s 后再次尝试

---

## 参考

- Spec: `docs/superpowers/specs/2026-04-12-discord-auto-reconnect-design.md`
- 颜色规则: `CLAUDE.md` → ⚠️ 颜色命名约束
- Bridge 架构: `src/lib/bridge/CLAUDE.md`
