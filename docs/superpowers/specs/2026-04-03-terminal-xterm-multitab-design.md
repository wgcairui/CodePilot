# Terminal xterm.js + 多 Tab 升级设计

**日期：** 2026-04-03  
**状态：** 已批准  
**范围：** 前端重构，Electron IPC 层无需修改

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

每个 Tab 只需传不同的 `id`，后端零改动。

### 组件层级

```
TerminalDrawer
  ResizeHandle
  Header: [TERMINAL label] [reset-height] [close Drawer]
  TerminalTabBar: [tab1 ×] [tab2 ×] [+]          ← NEW
  TerminalContent:
    TerminalInstance (tab1, display:block)         ← REWRITE
    TerminalInstance (tab2, display:none)          ← 隐藏但保持挂载
```

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
| `src/hooks/useTerminalTabs.ts` | 新建 | 多 tab 状态管理 |
| `src/components/terminal/TerminalTabBar.tsx` | 新建 | Tab 列表 + `+` 按钮组件 |
| `src/components/terminal/TerminalInstance.tsx` | 重写 | xterm.js 替换 ansi-to-react |
| `src/components/terminal/TerminalDrawer.tsx` | 小改 | 插入 TabBar，调整布局 |
| `electron/main.ts` | 小改 | 注册 ⌘T / ⌘W 全局快捷键 |
| `package.json` | 改 | 新增三个 xterm 依赖 |

---

## 依赖变更

```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

移除：`ansi-to-react`（不再使用）

| 包 | 用途 |
|---|---|
| `@xterm/xterm` | 核心终端模拟器 |
| `@xterm/addon-fit` | 自动 resize 到容器尺寸 |
| `@xterm/addon-web-links` | 终端输出中的 URL 可点击 |

---

## 行为规范

### Tab 外观

- **活跃 tab**：亮色文字 + 绿色状态点
- **非活跃 tab**：灰色文字 + 灰色状态点
- **双击 tab 名称**：内联重命名
- **OSC 2 转义序列**：自动更新 tab 名（vim 打开文件、运行 npm script 时生效）

### Tab 操作

| 操作 | 行为 |
|---|---|
| 点击 `+` | 新建 tab，自动检测 shell 名称（zsh/bash），设为 active |
| 点击 tab `×` | kill PTY；若是最后一个 tab → `setTerminalOpen(false)`，Drawer 收起 |
| 切换 tab | `display:none` 隐藏非活跃实例，保留 xterm.js 状态 |
| ⌘T | Electron 全局快捷键：新建 tab（Drawer 未开时先打开） |
| ⌘W | Electron 全局快捷键：关闭当前 tab |

### TerminalInstance 实现要点

- 每个 Tab 拥有独立的 `Terminal`（xterm.js）实例
- `FitAddon.fit()` 在容器 resize 和 Tab 激活时调用
- `ResizeObserver` 监听容器尺寸变化，触发 `fit()` 和 `api.resize()`
- Tab 隐藏时用 `display:none`（保持 DOM 挂载，xterm.js 实例不销毁）
- Tab 重新激活时调用 `fit()` 同步尺寸

### useTerminalTabs hook 职责

- 维护 `tabs: TerminalTab[]` 和 `activeTabId: string | null`
- `createTab()` — 生成新 ptyId，更新状态，返回新 tab
- `closeTab(id)` — kill PTY，从数组移除；若为最后一个调用 `setTerminalOpen(false)`
- `setActiveTab(id)` — 更新 activeTabId
- `updateTabTitle(id, title)` — 供 TerminalInstance 在收到 OSC 2 时回调

### Electron 全局快捷键（main.ts）

```ts
globalShortcut.register('CommandOrControl+T', () => {
  // 通知 renderer 新建 tab（通过 IPC）
})
globalShortcut.register('CommandOrControl+W', () => {
  // 通知 renderer 关闭当前 tab
})
```

快捷键在 app 失去焦点时应 unregister，获得焦点时重新 register，避免与系统冲突。

---

## 不在范围内

- **分屏**：后续迭代，需引入布局引擎
- **Tab 持久化**：重启后不恢复终端会话
- **搜索**（Ctrl+F）：可后续加 `@xterm/addon-search`

---

## 验证方式

1. `npm run test` 通过（typecheck + 单元测试）
2. 启动应用，打开终端 Drawer
3. 验证 vim / htop / less 可正常使用
4. 验证箭头键历史、Tab 补全、Ctrl+C 生效
5. 新建多个 Tab，切换时内容保留
6. 关闭最后一个 Tab，Drawer 收起
7. ⌘T / ⌘W 全局快捷键生效
