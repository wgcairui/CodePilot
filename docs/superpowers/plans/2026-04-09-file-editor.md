# 文件编辑器实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 为文件浏览器的 FilePreview 组件添加基于 CodeMirror 6 的内联编辑能力，支持视图/编辑模式切换、按钮保存和 ⌘S 快捷键保存。

**架构：** 在现有 `FilePreview.tsx` 中新增 `mode` 状态实现视图/编辑切换；编辑模式懒加载 `CodeMirrorEditor` 组件；新增 `POST /api/files/write` 端点写入文件；修改 `GET /api/files/raw` 添加 `baseDir` 安全校验。

**技术栈：** CodeMirror 6 / @uiw/react-codemirror、Next.js API Routes、Node.js `fs/promises`、`node:test` 单元测试

**设计文档：** `docs/superpowers/specs/2026-04-09-file-editor-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/types/index.ts` | 修改 | 新增 `FileWriteRequest` 接口 |
| `src/i18n/en.ts` | 修改 | 新增编辑器相关 i18n 键 |
| `src/i18n/zh.ts` | 修改 | 新增编辑器相关 i18n 键（中文） |
| `src/app/api/files/raw/route.ts` | 修改 | 移除内联 `isPathSafe`，新增 `baseDir` 双分支安全模型 |
| `src/app/api/files/write/route.ts` | 新建 | 文件写入端点（POST），含安全校验和大小限制 |
| `src/components/project/CodeMirrorEditor.tsx` | 新建 | CodeMirror 6 React 封装，按语言懒加载扩展 |
| `src/components/project/FilePreview.tsx` | 修改 | 新增 view/edit 模式切换、脏状态、保存逻辑 |
| `src/__tests__/unit/file-write-api.test.ts` | 新建 | write 路由安全校验单元测试 |
| `src/__tests__/unit/file-raw-baseDir.test.ts` | 新建 | raw 路由 baseDir 参数单元测试 |

---

## Chunk 1: 基础（依赖 + 类型 + i18n）

### Task 1: 安装 npm 依赖

**Files:**
- Modify: `package.json`（通过 npm install 自动更新）

- [ ] **Step 1: 安装 CodeMirror 及语言包**

```bash
npm install @uiw/react-codemirror @codemirror/lang-javascript @codemirror/lang-python @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-css @codemirror/lang-html @codemirror/lang-rust @codemirror/lang-go @codemirror/lang-java @codemirror/theme-one-dark
```

期望输出：`added N packages`，无 peer dependency 错误。

- [ ] **Step 2: 验证安装**

```bash
node -e "require('@uiw/react-codemirror'); console.log('OK')"
```

期望输出：`OK`

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: install CodeMirror 6 and language extensions"
```

---

### Task 2: 新增类型定义

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 在 `src/types/index.ts` 中 `FilePreview` 接口附近新增**

在 `FilePreview` 接口（第 49 行）后面添加：

```ts
export interface FileWriteRequest {
  path: string;
  content: string;
  baseDir: string;
}
```

- [ ] **Step 2: 验证 TypeScript 无报错**

```bash
npm run test
```

期望：通过，无 typecheck 错误。

- [ ] **Step 3: 提交**

```bash
git add src/types/index.ts
git commit -m "feat: add FileWriteRequest type"
```

---

### Task 3: 新增 i18n 键

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

- [ ] **Step 1: 在 `src/i18n/en.ts` 的 `filePreview` 键组（第 209 行附近）末尾添加**

```ts
  'filePreview.edit': 'Edit',
  'filePreview.viewMode': 'View',
  'filePreview.save': 'Save',
  'filePreview.saving': 'Saving…',
  'filePreview.saved': 'Saved',
  'filePreview.unsavedChanges': 'Unsaved changes',
  'filePreview.saveError': 'Failed to save',
```

- [ ] **Step 2: 在 `src/i18n/zh.ts` 的 `filePreview` 键组（第 206 行附近）末尾添加**

```ts
  'filePreview.edit': '编辑',
  'filePreview.viewMode': '预览',
  'filePreview.save': '保存',
  'filePreview.saving': '保存中…',
  'filePreview.saved': '已保存',
  'filePreview.unsavedChanges': '有未保存的更改',
  'filePreview.saveError': '保存失败',
```

- [ ] **Step 3: 验证 typecheck 通过**

```bash
npm run test
```

期望：通过。TypeScript 会自动将新键纳入 `TranslationKey` 类型。

- [ ] **Step 4: 提交**

```bash
git add src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: add file editor i18n keys (en + zh)"
```

---

## Chunk 2: API 路由

### Task 4: 修改 raw 路由（添加 baseDir 支持）

**Files:**
- Modify: `src/app/api/files/raw/route.ts`
- Create: `src/__tests__/unit/file-raw-baseDir.test.ts`

- [ ] **Step 1: 先写失败测试**

新建 `src/__tests__/unit/file-raw-baseDir.test.ts`：

```ts
/**
 * 验证 /api/files/raw 的 baseDir 安全模型与 /api/files/preview 一致。
 * 这些测试直接测 isPathSafe / isRootPath 逻辑，而非通过 HTTP。
 *
 * Run: npx tsx src/__tests__/unit/file-raw-baseDir.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import { isPathSafe, isRootPath } from '../../lib/files';

describe('raw 路由 baseDir 安全校验逻辑', () => {
  const homeDir = os.homedir();

  it('baseDir 是根路径时 isRootPath 应返回 true', () => {
    assert.equal(isRootPath('/'), true);
    if (process.platform === 'win32') {
      assert.equal(isRootPath('C:\\'), true);
    }
  });

  it('正常项目目录不是根路径', () => {
    assert.equal(isRootPath(path.join(homeDir, 'projects', 'myapp')), false);
  });

  it('baseDir 提供时：项目内文件应通过校验', () => {
    const baseDir = path.join(homeDir, 'projects', 'myapp');
    const filePath = path.join(baseDir, 'src', 'index.ts');
    assert.equal(isPathSafe(baseDir, filePath), true);
  });

  it('baseDir 提供时：项目外文件应被拒绝', () => {
    const baseDir = path.join(homeDir, 'projects', 'myapp');
    assert.equal(isPathSafe(baseDir, '/etc/passwd'), false);
    assert.equal(isPathSafe(baseDir, path.join(homeDir, 'other-project', 'secret.ts')), false);
  });

  it('未提供 baseDir 时：homeDir 回退——home 内文件应通过', () => {
    const filePath = path.join(homeDir, 'projects', 'myapp', 'index.ts');
    assert.equal(isPathSafe(homeDir, filePath), true);
  });

  it('未提供 baseDir 时：homeDir 回退——home 外文件应被拒绝', () => {
    assert.equal(isPathSafe(homeDir, '/etc/passwd'), false);
  });
});
```

- [ ] **Step 2: 运行测试确认通过（这些测试 `isPathSafe`/`isRootPath` 已存在）**

```bash
npx tsx src/__tests__/unit/file-raw-baseDir.test.ts
```

期望：全部通过（这些函数已实现，测试仅验证逻辑是否符合预期）。

- [ ] **Step 3: 修改 `src/app/api/files/raw/route.ts`**

**删除**文件头部的内联 `isPathSafe`（第 10–13 行）：

```ts
// 删除这段：
function isPathSafe(base: string, target: string): boolean {
  const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(normalizedBase);
}
```

**在 import 区（第 1–6 行附近）新增**：

```ts
import { isPathSafe, isRootPath } from '@/lib/files';
```

**⚠️ 先删除文件第 105–111 行的旧 homeDir 校验**（否则新 baseDir 分支会被旧检查覆盖，跨盘符路径仍被拒绝）：

```ts
// 删除以下 7 行（raw/route.ts 第 105–111 行）：
  // Only allow reading files within the user's home directory
  if (!isPathSafe(homeDir, resolved)) {
    return new Response(JSON.stringify({ error: 'File is outside the allowed scope' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
```

**然后在同位置插入 baseDir 双分支安全校验**：

```ts
const baseDir = request.nextUrl.searchParams.get('baseDir');
if (baseDir) {
  const resolvedBase = path.resolve(baseDir);
  if (isRootPath(resolvedBase)) {
    return new Response(JSON.stringify({ error: 'Cannot use filesystem root as base directory' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!isPathSafe(resolvedBase, resolved)) {
    return new Response(JSON.stringify({ error: 'File is outside the project scope' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
} else {
  if (!isPathSafe(homeDir, resolved)) {
    return new Response(JSON.stringify({ error: 'File is outside the allowed scope' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 4: 验证 typecheck + 单元测试**

```bash
npm run test
```

期望：通过。

- [ ] **Step 5: 提交**

```bash
git add src/app/api/files/raw/route.ts src/__tests__/unit/file-raw-baseDir.test.ts
git commit -m "feat: add baseDir security to /api/files/raw route"
```

---

### Task 5: 新建文件写入路由

**Files:**
- Create: `src/app/api/files/write/route.ts`
- Create: `src/__tests__/unit/file-write-api.test.ts`

- [ ] **Step 1: 先写失败测试**

新建 `src/__tests__/unit/file-write-api.test.ts`：

```ts
/**
 * 验证文件写入路由的安全校验逻辑。
 * 直接测试 isPathSafe / isRootPath，不通过 HTTP。
 *
 * Run: npx tsx src/__tests__/unit/file-write-api.test.ts
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { isPathSafe, isRootPath } from '../../lib/files';

const homeDir = os.homedir();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-write-test-'));
const projectDir = path.join(tmpDir, 'myproject');
fs.mkdirSync(projectDir, { recursive: true });

describe('write 路由安全校验', () => {
  it('baseDir 是根路径时应拒绝', () => {
    assert.equal(isRootPath('/'), true);
  });

  it('项目内路径应通过校验', () => {
    const filePath = path.join(projectDir, 'output.ts');
    assert.equal(isPathSafe(projectDir, filePath), true);
  });

  it('项目外路径应被拒绝', () => {
    assert.equal(isPathSafe(projectDir, '/etc/passwd'), false);
    assert.equal(isPathSafe(projectDir, path.join(homeDir, 'other', 'file.ts')), false);
  });

  it('路径遍历攻击应被拒绝', () => {
    const traversal = path.resolve(projectDir, '..', 'secret.txt');
    assert.equal(isPathSafe(projectDir, traversal), false);
  });

  it('10MB 大小限制：超出应返回错误', () => {
    const MAX = 10 * 1024 * 1024;
    // 使用 Buffer.byteLength 与路由实现保持一致（多字节 UTF-8 场景下 .length !== byteLength）
    const overLimit = Buffer.alloc(MAX + 1, 0x41).toString('utf8'); // 10MB+1 字节 ASCII
    assert.equal(Buffer.byteLength(overLimit, 'utf8') > MAX, true);
  });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认全部通过**

```bash
npx tsx src/__tests__/unit/file-write-api.test.ts
```

期望：全部通过。

- [ ] **Step 3: 新建 `src/app/api/files/write/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isPathSafe, isRootPath } from '@/lib/files';
import type { ErrorResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  let body: { path?: string; content?: string; baseDir?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { path: filePath, content, baseDir } = body;

  if (!filePath || typeof filePath !== 'string') {
    return NextResponse.json<ErrorResponse>({ error: 'Missing or invalid path' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json<ErrorResponse>({ error: 'Missing or invalid content' }, { status: 400 });
  }
  if (!baseDir || typeof baseDir !== 'string') {
    return NextResponse.json<ErrorResponse>(
      { error: 'baseDir is required for write operations' },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Content exceeds 10 MB limit' },
      { status: 413 }
    );
  }

  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory' },
      { status: 403 }
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'File is outside the project scope' },
      { status: 403 }
    );
  }

  try {
    await fs.writeFile(resolvedPath, content, 'utf8');
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to write file' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: 运行完整测试**

```bash
npm run test
```

期望：通过。

- [ ] **Step 5: 提交**

```bash
git add src/app/api/files/write/route.ts src/__tests__/unit/file-write-api.test.ts
git commit -m "feat: add POST /api/files/write endpoint with security validation"
```

---

## Chunk 3: CodeMirrorEditor 组件

### Task 6: 新建 CodeMirrorEditor 组件

**Files:**
- Create: `src/components/project/CodeMirrorEditor.tsx`

> 注意：此组件通过 `dynamic` 懒加载，不能写单元测试（依赖 DOM）。通过 Task 8 的 CDP 验证。

- [ ] **Step 1: 新建 `src/components/project/CodeMirrorEditor.tsx`**

```tsx
"use client";

// ⚠️ 所有 import 必须在文件顶部，不得放在函数/接口定义之后
import { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

// language 值来自 getFileLanguage()，是显示名称（如 "typescript"、"python"），不是文件扩展名
async function getLanguageExtension(language: string): Promise<Extension | null> {
  switch (language) {
    // "javascript" 涵盖 .js/.jsx；"typescript" 涵盖 .ts/.tsx
    case "javascript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true });
    }
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true, jsx: true });
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "css":
    case "scss": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "go": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    default:
      return null;
  }
}

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  isDark: boolean;
  className?: string;
}

export function CodeMirrorEditor({
  value,
  onChange,
  language,
  isDark,
  className,
}: CodeMirrorEditorProps) {
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    getLanguageExtension(language).then((ext) => {
      setExtensions(ext ? [ext] : []);
    });
  }, [language]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={isDark ? oneDark : undefined}
      height="100%"   // 必须：驱动 .cm-editor { height: 100% }，className 仅作用于外层 wrapper
      className={className}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
      }}
      style={{ fontSize: "11px" }}
    />
  );
}
```

- [ ] **Step 2: 验证 typecheck**

```bash
npm run test
```

期望：通过，无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/components/project/CodeMirrorEditor.tsx
git commit -m "feat: add CodeMirrorEditor component with lazy language loading"
```

---

## Chunk 4: FilePreview 编辑模式

### Task 7: 扩展 FilePreview 支持编辑模式

**Files:**
- Modify: `src/components/project/FilePreview.tsx`

- [ ] **Step 1: 在文件顶部新增 dynamic import**

在现有 `import` 区末尾添加（`FilePreview.tsx` 第 22 行附近）：

```tsx
import dynamic from "next/dynamic";

const CodeMirrorEditor = dynamic(
  () => import("./CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor })),
  { ssr: false }
);
```

- [ ] **Step 2: 在组件内新增状态和逻辑**

在 `FilePreview` 函数体内，`preview` 状态之后添加：

```tsx
const [mode, setMode] = useState<"view" | "edit">("view");
const [editContent, setEditContent] = useState<string>("");
const [isDirty, setIsDirty] = useState(false);
const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
// ⚠️ useTheme 已在 useFilePreviewCodeTheme 内调用，这里直接解构同一 hook 结果，不要重复实例化
// 正确做法：在现有 hljsStyle 行下方直接提取 resolvedTheme
const { resolvedTheme } = useTheme(); // useFilePreviewCodeTheme 内部也调用 useTheme，但 React 保证同组件多次调用返回相同值，可行但有重复
const isDark = resolvedTheme === "dark";
```

> 备注：更简洁的做法是让 `useFilePreviewCodeTheme` 同时返回 `isDark`，但为最小化改动，直接在组件层调用 `useTheme()` 是可行的（React 保证同一渲染中多次调用同一 hook 返回相同值）。

- [ ] **Step 3: 新增进入编辑模式的函数**

```tsx
const handleEnterEdit = useCallback(async () => {
  // 获取完整文件内容（preview 只有前 200 行）
  const res = await fetch(
    `/api/files/raw?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ""}`
  );
  if (!res.ok) return;
  const text = await res.text();
  setEditContent(text);
  setIsDirty(false);
  setSaveStatus("idle");
  setMode("edit");
}, [filePath, workingDirectory]);
```

- [ ] **Step 4: 新增保存函数**

```tsx
const handleSave = useCallback(async () => {
  if (!isDirty) return;
  // workingDirectory 不存在时给出错误反馈而非静默无响应
  if (!workingDirectory) {
    setSaveStatus("error");
    setTimeout(() => setSaveStatus("idle"), 3000);
    return;
  }
  setSaveStatus("saving");
  try {
    const res = await fetch("/api/files/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content: editContent, baseDir: workingDirectory }),
    });
    if (!res.ok) throw new Error("write failed");
    setIsDirty(false);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  } catch {
    setSaveStatus("error");
    setTimeout(() => setSaveStatus("idle"), 3000);
  }
}, [isDirty, workingDirectory, filePath, editContent]);
```

- [ ] **Step 5: 新增 ⌘S 快捷键监听**

```tsx
useEffect(() => {
  if (mode !== "edit") return;
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [mode, handleSave]);
```

- [ ] **Step 6: 修改头部 — 新增切换按钮和保存按钮**

找到现有头部区域（`FilePreview.tsx` 第 75 行附近的 `<div className="flex items-center gap-2 pb-2">`），在复制按钮之后、`</div>` 之前添加：

```tsx
{/* 编辑/预览切换 */}
<Button
  variant="ghost"
  size="icon-sm"
  onClick={mode === "view" ? handleEnterEdit : () => { setMode("view"); setIsDirty(false); }}
  title={mode === "view" ? t("filePreview.edit") : t("filePreview.viewMode")}
>
  {mode === "view" ? <PencilSimple size={14} /> : <Eye size={14} />}
</Button>

{/* 保存按钮（编辑模式时显示） */}
{mode === "edit" && (
  <Button
    variant={isDirty ? "default" : "ghost"}
    size="sm"
    onClick={handleSave}
    disabled={saveStatus === "saving" || !isDirty}
    className="h-6 px-2 text-xs"
  >
    {saveStatus === "saving"
      ? t("filePreview.saving")
      : saveStatus === "saved"
      ? t("filePreview.saved")
      : saveStatus === "error"
      ? t("filePreview.saveError")
      : isDirty
      ? `· ${t("filePreview.save")}`
      : t("filePreview.save")}
  </Button>
)}
```

- [ ] **Step 7: 在文件名下方（file info 区域）新增脏状态提示**

在 `{preview && (` 区域的 Badge 之后添加（仅编辑模式显示）：

```tsx
{mode === "edit" && isDirty && (
  <span className="text-[10px] text-status-warning-foreground">
    {t("filePreview.unsavedChanges")}
  </span>
)}
```

- [ ] **Step 8: 替换内容区——编辑模式渲染 CodeMirrorEditor**

现有结构为 `<ScrollArea className="flex-1">` 包裹内容区。CodeMirror 有自己的内部滚动，**不能**放入 ScrollArea，否则双层滚动导致高度坍缩。

改为：将 `<ScrollArea>` 和编辑器条件渲染拆分——编辑模式直接占满 flex 容器，预览模式保留 ScrollArea：

```tsx
{/* 编辑模式：CodeMirror 直接占满 flex-1，不需要 ScrollArea */}
{mode === "edit" ? (
  <div className="flex-1 min-h-0 overflow-hidden">
    <CodeMirrorEditor
      value={editContent}
      onChange={(val) => {
        setEditContent(val);
        setIsDirty(true);
      }}
      language={preview?.language ?? ""}
      isDark={isDark}
      className="h-full"
    />
  </div>
) : (
  /* 预览模式：保留原有 ScrollArea */
  <ScrollArea className="flex-1">
    {loading ? (
      /* 原有 loading/error/preview 渲染逻辑，保持不变 */
    ) : error ? (
      /* 原有错误渲染 */
    ) : preview ? (
      <div className="rounded-md border border-border text-xs">
        <SyntaxHighlighter ...>
          {preview.content}
        </SyntaxHighlighter>
      </div>
    ) : null}
  </ScrollArea>
)}
```

> 注：上方 loading/error 分支保持原文件内容不变，不需要重写。

- [ ] **Step 9: 新增所需图标导入**

在文件顶部图标导入行（第 4 行）中新增 `PencilSimple` 和 `Eye`：

```tsx
import { ArrowLeft, Copy, Check, SpinnerGap, PencilSimple, Eye } from "@/components/ui/icon";
```

同时在 `useTheme` 已有导入处确认已导入（`FilePreview.tsx` 第 8 行已有 `useTheme`）。

新增 `useCallback` 导入（在 `useState, useEffect` 导入行补充）：

```tsx
import { useState, useEffect, useCallback } from "react";
```

- [ ] **Step 10: 验证 typecheck**

```bash
npm run test
```

期望：通过。

- [ ] **Step 11: 提交**

```bash
git add src/components/project/FilePreview.tsx
git commit -m "feat: add edit mode to FilePreview with CodeMirror 6 and save support"
```

---

## Chunk 5: CDP 验证

### Task 8: 启动应用并通过 CDP 验证功能

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

等待 `ready` 输出。

- [ ] **Step 2: 通过 CDP 打开文件浏览器页面**

使用 chrome-devtools MCP 导航到 `http://localhost:3000`，打开含文件浏览器的面板（项目视图）。

- [ ] **Step 3: 截图验证视图模式正常**

确认文件预览头部出现编辑按钮（PencilSimple 图标），SyntaxHighlighter 正常渲染。

- [ ] **Step 4: 点击编辑按钮，截图验证编辑模式**

确认：
- CodeMirror 编辑器渲染（有行号）
- 头部切换按钮变为 Eye 图标
- 未修改时保存按钮为 ghost 样式

- [ ] **Step 5: 修改内容，截图验证脏状态**

确认：
- 保存按钮高亮（`default` variant）
- 文件名下方显示"有未保存的更改"提示

- [ ] **Step 6: 点击保存按钮，截图验证保存成功**

确认：
- 按钮短暂显示"已保存"
- 脏状态提示消失
- console 无报错

- [ ] **Step 7: 测试 ⌘S 快捷键**

再次修改内容 → 按 ⌘S → 截图确认保存成功，浏览器未弹出原生保存对话框。

- [ ] **Step 8: 切换回预览模式**

点击 Eye 按钮 → 截图确认回到 SyntaxHighlighter 只读视图。

- [ ] **Step 9: 提交最终结果**

```bash
git add .
git commit -m "feat: file inline editor with CodeMirror 6 — view/edit toggle + ⌘S save"
```

---

## 验证清单

完成全部 Task 后确认：

- [ ] `npm run test` 通过（typecheck + 单元测试）
- [ ] `npm run lint` 无新增 lint 错误
- [ ] CDP 截图确认视图/编辑切换、脏状态、保存流程正常
- [ ] console 无报错
- [ ] i18n 键 en/zh 均已添加
- [ ] `FileWriteRequest` 类型已添加到 `src/types/index.ts`
