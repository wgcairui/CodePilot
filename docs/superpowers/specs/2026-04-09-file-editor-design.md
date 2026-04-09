# 文件编辑器设计方案

**日期：** 2026-04-09  
**状态：** 已确认

## 概述

在现有文件浏览器的 `FilePreview` 组件中添加内联编辑能力。用户可在只读预览（现有行为）和基于 CodeMirror 6 的编辑模式之间切换。

## 目标

- 轻量：使用 CodeMirror 6，按语言懒加载扩展包
- 非破坏性：保留现有只读视图，通过按钮切换
- 支持按钮点击和 ⌘S 快捷键保存
- 复用现有安全模型（`isPathSafe` + `isRootPath`）

## 架构

```
FilePreview.tsx（扩展）
  ├── mode: 'view' | 'edit'
  ├── 视图模式：SyntaxHighlighter（不变）
  └── 编辑模式：CodeMirrorEditor（新增，懒加载）

src/components/project/CodeMirrorEditor.tsx（新增）
  └── @uiw/react-codemirror 封装，按文件类型加载语言扩展

src/app/api/files/write/route.ts（新增）
  └── POST { path, content, baseDir } → fs.writeFile + 安全校验

src/app/api/files/raw/route.ts（修改）
  └── 移除内联 isPathSafe，改从 @/lib/files 导入 isPathSafe + isRootPath
  └── 新增 baseDir 查询参数，与 preview 路由保持一致的双分支安全模型

src/types/index.ts（修改）
  └── 新增 FileWriteRequest 接口
```

## 组件变更

### `FilePreview.tsx`

- 新增 `mode: 'view' | 'edit'` 状态
- 新增 `isDirty: boolean` 状态（内容与已保存版本不同则为 true）
- 头部右侧新增编辑/预览切换按钮
- 编辑模式头部新增：
  - `·` 脏状态指示点（`isDirty` 为 true 时显示）
  - 保存按钮（有未保存更改时高亮）
- 进入编辑模式时：通过 `/api/files/raw?path=...&baseDir=...` 获取完整文件内容
  - 当前 `/api/files/preview` 最多读取 200 行；raw 端点返回完整内容
  - 必须传 `baseDir`（raw 路由安全模型要求）
- ⌘S 处理：
  - 使用 `useEffect`，依赖项为 `[mode, handleSave]`
  - 在 effect 条件中判断：仅当 `mode === 'edit'` 时挂载监听器
  - 模式：`useEffect(() => { if (mode !== 'edit') return; const handler = ...; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, [mode, handleSave])`
  - 处理函数内调用 `e.preventDefault()`，阻止浏览器原生保存对话框
- 保存时：`POST /api/files/write`，body 为 `{ path, content, baseDir }`，成功后重置 `isDirty`

### `CodeMirrorEditor.tsx`（新增）

- 用 `dynamic(() => import(...), { ssr: false })` 懒加载，避免 SSR 阶段 DOM 错误
- 使用 `@uiw/react-codemirror` 作为 React 封装层
- 主题：从 `useTheme().resolvedTheme === 'dark'` 派生 `isDark`，将其作为 prop 传入 `CodeMirrorEditor`。编辑器内使用 `isDark ? oneDark : undefined` 作为 theme 扩展（`oneDark` 从 `@codemirror/theme-one-dark` 导入）
  - 注意：`useFilePreviewCodeTheme()` 返回的是 `HljsStyle` 对象（`Record<string, CSSProperties>`），与 CodeMirror `theme` prop 不兼容，**不能**直接传入
- 按文件扩展名加载语言扩展：

| 扩展名 | 包 |
|--------|-----|
| ts, tsx, js, jsx | `@codemirror/lang-javascript` |
| py | `@codemirror/lang-python` |
| json | `@codemirror/lang-json` |
| md, mdx | `@codemirror/lang-markdown` |
| css, scss | `@codemirror/lang-css` |
| html, htm | `@codemirror/lang-html` |
| rs | `@codemirror/lang-rust` |
| go | `@codemirror/lang-go` |
| java | `@codemirror/lang-java` |
| 其他 | 不加载语言扩展 |

- Props：`value`、`onChange`、`language`、`isDark`、`className`

### `src/app/api/files/raw/route.ts`（修改）

1. 移除文件内的内联 `isPathSafe` 定义（第 10–13 行）
2. 从 `@/lib/files` 导入 `isPathSafe` 和 `isRootPath`（与 `preview/route.ts` 保持一致）
3. 新增 `baseDir` 查询参数，实现双分支安全模型：
   - 提供了 `baseDir`：执行 `isRootPath(baseDir)` 检查 → `isPathSafe(baseDir, path)`
   - 未提供 `baseDir`：回退到 `isPathSafe(homeDir, path)`

此修改使 `FilePreview` 能在 `homeDir` 以外的项目中加载完整文件内容（Windows 不同盘符场景同样适用）。

### `src/app/api/files/write/route.ts`（新增）

- 方法：`POST`
- Body：`{ path: string, content: string, baseDir: string }`，`baseDir` **必填**
- `baseDir` 缺失或为空时：返回 `400 Bad Request`
- 安全校验：`isRootPath(baseDir)` → `isPathSafe(baseDir, path)`（写操作必须限定在项目范围内）
- 内容大小限制：`content.length` 超过 10 MB 时返回 `413`
  - 说明：raw 路由通过流式传输支持 >10 MB 的文件，因此用户可以打开大文件但无法保存。这是已接受的限制——侧边面板编辑器不适用于超大文件场景。
- 成功时返回：`{ success: true }`
- 不做备份/版本化——Git 是安全网

### `src/types/index.ts`（修改）

新增：

```ts
export interface FileWriteRequest {
  path: string;
  content: string;
  baseDir: string;
}
```

## i18n 键（新增）

在 `src/i18n/en.ts` 和 `src/i18n/zh.ts` 中添加：

```
filePreview.edit            — "Edit" / "编辑"
filePreview.viewMode        — "View" / "预览"
filePreview.save            — "Save" / "保存"
filePreview.saving          — "Saving…" / "保存中…"
filePreview.saved           — "Saved" / "已保存"
filePreview.unsavedChanges  — "Unsaved changes" / "有未保存的更改"
filePreview.saveError       — "Failed to save" / "保存失败"
```

## 需安装的依赖

```
@uiw/react-codemirror
@codemirror/lang-javascript
@codemirror/lang-python
@codemirror/lang-json
@codemirror/lang-markdown
@codemirror/lang-css
@codemirror/lang-html
@codemirror/lang-rust
@codemirror/lang-go
@codemirror/lang-java
@codemirror/theme-one-dark
```

## 范围外（本次不做）

- 多文件同时编辑
- 跨会话 undo 历史持久化
- Diff 视图
- 在编辑器内创建/删除文件
