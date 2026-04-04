# layout — 应用布局系统

## Panel 状态管理

所有面板状态（open/close、workingDirectory、sessionId 等）通过 `PanelContext`（`src/hooks/usePanel.ts`）共享。

新增面板开关需同步三处：
1. `src/hooks/usePanel.ts` — 接口声明 + Context
2. `src/components/layout/AppShell.tsx` — Provider 的 state
3. `src/components/layout/UnifiedTopBar.tsx` — 顶栏按钮

⚠️ 面板组件内部用 `if (!xxxOpen) return null` 而非条件渲染，目的是保持 hook 挂载（避免 PTY / 网络连接状态丢失）。

## AppShell 结构

```
UnifiedTopBar
UpdateBanner
flex-row:
  NavRail
  flex-col:
    <main>（聊天主区域）
    TerminalDrawer（底部终端，不在 PanelZone 中）
  PanelZone（右侧：FileTree / Git / Preview / Dashboard）
```

## 终端（TerminalDrawer）

- 挂载于 `<main>` 下方，独立于 PanelZone
- 仅 Electron 有完整 PTY 功能；浏览器降级显示提示文字
- 多 Tab 状态由 `src/hooks/useTerminalTabs.ts` 管理；`TerminalInstance` 用 xterm.js 渲染
- ⚠️ `fitAddon.fit()` 只能在 tab active（`display:block`）时调用——`display:none` 下 offsetWidth=0，会将 PTY resize 为 0 列破坏 shell 会话
- ⚠️ `onExit`/`onData` 的 `payload.id` 是 **ptyId**（格式 `pty-xxx`），不是 tab.id（`tab-xxx`）

## DashboardPanel 分组架构

Widget 按 `pinnedFrom.sessionId` 分组，每组标题展示会话名（`GET /api/chat/sessions/{id}` → `{ session.title }`）。

⚠️ 每组需独立计算视觉排序：
- DOM 顺序：组内 widget 按 ID 字母排序（保持稳定，防止 iframe 销毁）
- 视觉顺序：用组内 `createdAt` 降序生成的局部 `groupOrderMap`，赋给 CSS `order`
- 不能复用全局 orderMap（全局索引跨组，导致组内排序错误）

组间按最新 `createdAt` 降序排列；默认只展开最新一组（`groupsInitializedRef` 防止重复初始化）。
