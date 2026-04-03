# Terminal xterm.js + 多 Tab 升级设计

**日期：** 2026-04-03  
**状态：** 已批准  
**范围：** 前端重构 + Electron preload/main 小改

---

## 问题背景

当前 `TerminalInstance` 使用 `ansi-to-react` + `<input>` 模拟终端，存在以下根本性缺陷：

- 交互程序（vim、htop、less、git interactive rebase）无法使用
- 箭头键历史导航不生效
- Tab 补全不工作
- Ctrl+C / Ctrl+D 等快捷键无效
- 只支持单一终端实例，无法多开

代码注释本身已预告："xterm.js integration can be added later for full terminal emulation."

---

## 设计目标

用 xterm.js 替换现有渲染层，并增加多 Tab 管理，达到类 VS Code 终端的完整体验。

**不在此次范围：** 分屏、Tab 持久化（重启后恢复）。

---

## 架构

### 关键前提

Electron IPC 层（`electronAPI.terminal`）**已经是多 ID 设计**：

```ts
api.create({ id, cwd, cols, rows })
api.write(id, data)
api.resize(id, cols, rows)
api.kill(id)
```

每个 Tab 只需传不同的 `id`，`electron/main.ts` PTY 逻辑无需修改。

### 组件层级

```
TerminalDrawer
  ResizeHandle                                      (h-1 = 0.25rem)
  Header: [TERMINAL label] [reset-height] [close]  (h-8 = 2rem)
  TerminalTabBar: [tab1 ×] [tab2 ×] [+]            (h-[30px] ≈ 1.875rem) ← NEW
  TerminalContent: h-[calc(100%-4.125rem-0.25rem)]
    TerminalInstance (tab1, display:block)           ← REWRITE with xterm.js
    TerminalInstance (tab2, display:none)            ← 隐藏但保持挂载
```

> ⚠️ `TerminalDrawer` 现有高度 calc 为 `h-[calc(100%-2.25rem-0.25rem)]`，加入 TabBar（30px ≈ 1.875rem）后需更新为 `h-[calc(100%-4.125rem-0.25rem)]`。

### 数据结构

```ts
interface TerminalTab {
  id: string;      // "tab-1706001234"
  title: string;   // "bash" / "node" / auto-updated via OSC 2
  ptyId: string;   // 传给 electronAPI.terminal 的唯一标识
}
```

---

## 文件改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/hooks/useTerminalTabs.ts` | 新建 | 多 tab 状态管理，**完全替代** `useTerminal` |
| `src/components/terminal/TerminalTabBar.tsx` | 新建 | Tab 列表 + `+` 按钮组件 |
| `src/components/terminal/TerminalInstance.tsx` | 重写 | xterm.js 替换 ansi-to-react |
| `src/components/terminal/TerminalDrawer.tsx` | 小改 | 插入 TabBar，更新高度 calc |
| `electron/preload.ts` | 小改 | 暴露 `terminal:new-tab` / `terminal:close-tab` IPC push 通道 |
| `electron/main.ts` | 小改 | 注册 ⌘T 全局快捷键；⌘W 改为 renderer 侧处理 |
| `package.json` | 改 | 新增三个 xterm 依赖，移除 ansi-to-react |

---

## 依赖变更

```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
npm uninstall ansi-to-react
```

| 包 | 用途 |
|---|---|
| `@xterm/xterm` | 核心终端模拟器 |
| `@xterm/addon-fit` | 自动 resize 到容器尺寸 |
| `@xterm/addon-web-links` | 终端输出中的 URL 可点击 |

---

## 行为规范

### Tab 外观与颜色

- **活跃 tab**：前景色用 `text-foreground`，状态点用 `bg-status-success`（语义 token，非 `text-green-400`）
- **非活跃 tab**：`text-muted-foreground`，状态点用 `bg-muted`
- Tab 栏容器背景：`bg-muted/30`，与现有 Header 风格一致
- **xterm.js 终端画布**颜色通过 xterm.js `theme` 选项配置（`background: '#1a1a1a'` 等），不走 Tailwind

### Tab 操作

| 操作 | 行为 |
|---|---|
| 点击 `+` | 新建 tab，自动检测 shell 名称（zsh/bash），设为 active |
| 点击 tab `×` | kill PTY；若是最后一个 tab → `setTerminalOpen(false)`，Drawer 收起 |
| 切换 tab | `display:none` 隐藏非活跃实例，保留 xterm.js 实例状态 |
| ⌘T | Electron 全局快捷键 → `mainWindow.webContents.send('terminal:new-tab')`（Drawer 未开时先打开） |
| ⌘W | **renderer 侧**：在每个 `TerminalInstance` 的 xterm.js 实例上通过 `terminal.attachCustomKeyEventHandler` 拦截，返回 `false` 阻止 xterm.js 默认处理并触发 `closeTab`；避免与 macOS Close Window 冲突 |
| 双击 tab 名称 | 内联重命名 |

### 键盘快捷键实现方式

- **⌘T**：`globalShortcut`（`main.ts`） → IPC push → renderer。焦点丢失时 unregister，焦点恢复时 re-register。
- **⌘W**：**不用 `globalShortcut`**，改为在每个 `TerminalInstance` 初始化 xterm.js 时调用 `terminal.attachCustomKeyEventHandler`，检测到 `metaKey + w` 时返回 `false`（阻止 xterm.js 默认处理）并调用 `closeTab`。这是唯一能在 canvas 持有焦点时可靠拦截键盘事件的方式；`div onKeyDown` 因 xterm.js 的事件隔离而无效。

### IPC Push 通道（preload.ts 新增）

```ts
// preload.ts contextBridge 暴露：
onNewTab: (cb: () => void) => ipcRenderer.on('terminal:new-tab', cb),
onCloseTab: (cb: () => void) => ipcRenderer.on('terminal:close-tab', cb),
```

### useTerminalTabs hook 职责

`useTerminalTabs` **完全替代** `useTerminal`，不再并存。`TerminalDrawer` 直接调用 `useTerminalTabs`。

- 维护 `tabs: TerminalTab[]` 和 `activeTabId: string | null`
- `createTab()` — 生成新 ptyId，直接调用 `electronAPI.terminal.create()`，更新状态
- `closeTab(id)` — kill PTY，从数组移除；若为最后一个调用 `setTerminalOpen(false)`
- `setActiveTab(id)` — 更新 activeTabId
- `updateTabTitle(id, title)` — 供 TerminalInstance 在收到 OSC 2 时回调
- **`onData` / `onExit` 订阅**：在 `createTab()` 时为该 ptyId 单独注册，避免多 tab 间串流

### TerminalInstance 实现要点

- 每个 Tab 拥有独立的 `Terminal`（xterm.js）实例 + `FitAddon` + `WebLinksAddon`
- **`fit()` 必须且仅在 tab active（`display:block`）时调用**；`display:none` 时 `offsetWidth/Height` 为 0，会将 PTY resize 为 0 列，破坏 shell 会话
- `ResizeObserver` 监听容器尺寸变化 → 仅当该 tab 为 active 时触发 `fit()` + `api.resize()`
- Tab 重新激活时调用 `fit()` 同步尺寸（因隐藏期间 Drawer 可能被 resize）
- **OSC 2 解析**：使用 `terminal.parser.registerOscHandler(2, handler)` 注册，handler 调用 `updateTabTitle(id, title)`，不做 regex 原始流解析

---

## 不在范围内

- **分屏**：后续迭代，需引入布局引擎
- **Tab 持久化**：重启后不恢复终端会话
- **搜索**（Ctrl+F）：可后续加 `@xterm/addon-search`

---

## 验证方式

1. `npm run test` 通过（typecheck + 单元测试）
2. `npm run lint:colors` 通过（无原始 Tailwind 颜色）
3. 启动应用，打开终端 Drawer
4. 验证 vim / htop / less 可正常使用
5. 验证箭头键历史、Tab 补全、Ctrl+C 生效
6. 新建多个 Tab，切换时内容保留（包括滚动位置）
7. 关闭最后一个 Tab，Drawer 收起
8. ⌘T 全局快捷键新建 tab，⌘W 在终端 focused 时关闭 tab
9. resize Drawer 高度时，xterm.js 自动适配列宽
10. 用 CDP 截图确认 Tab 栏颜色符合语义 token
