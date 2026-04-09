# File Editor Design

**Date:** 2026-04-09  
**Status:** Approved

## Overview

Add inline editing capability to the existing file browser's `FilePreview` component. Users can toggle between read-only view (current behavior) and edit mode powered by CodeMirror 6.

## Goals

- Lightweight: use CodeMirror 6 with per-language lazy loading
- Non-destructive: preserve existing read-only view, toggled via button
- Save via button click and ⌘S keyboard shortcut
- Reuse existing security model (`isPathSafe` + `isRootPath`)

## Architecture

```
FilePreview.tsx (extended)
  ├── mode: 'view' | 'edit'
  ├── view mode: SyntaxHighlighter (unchanged)
  └── edit mode: CodeMirrorEditor (new, lazy-loaded)

src/components/project/CodeMirrorEditor.tsx (new)
  └── @uiw/react-codemirror wrapper, language extensions loaded per file type

src/app/api/files/write/route.ts (new)
  └── POST { path, content, baseDir } → fs.writeFile with safety checks

src/app/api/files/raw/route.ts (modified)
  └── Remove inline isPathSafe; import isPathSafe + isRootPath from @/lib/files
  └── Add baseDir query param + same two-branch security as preview route

src/types/index.ts (modified)
  └── Add FileWriteRequest interface
```

## Component Changes

### `FilePreview.tsx`

- Add `mode: 'view' | 'edit'` state
- Add `isDirty: boolean` state (content differs from saved version)
- Header row: add Edit/View toggle button (right side)
- Edit mode header additions:
  - `·` dot indicator when `isDirty`
  - Save button (highlighted when dirty)
- On entering edit mode: fetch full file content via `/api/files/raw?path=...&baseDir=...`
  - The current `/api/files/preview` truncates at 200 lines — raw endpoint returns the full file
  - `baseDir` must be passed (required by the updated raw route security model)
- ⌘S handler:
  - Use `useEffect` with `[mode, handleSave]` as dependencies
  - Guard in effect condition: only attach listener when `mode === 'edit'`
  - Pattern: `useEffect(() => { if (mode !== 'edit') return; const handler = ...; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, [mode, handleSave])`
  - Inside handler: call `e.preventDefault()` to suppress browser native save dialog
- On save: `POST /api/files/write` with `{ path, content, baseDir }`, reset `isDirty` on success

### `CodeMirrorEditor.tsx` (new)

- Wrapped with `dynamic(() => import(...), { ssr: false })` to avoid SSR DOM errors
- Uses `@uiw/react-codemirror` as the React wrapper
- Theme: derive `isDark` from `useTheme().resolvedTheme === 'dark'`. Pass `isDark` as a prop to `CodeMirrorEditor`. Inside the editor, use `isDark ? oneDark : undefined` (where `oneDark` is imported from `@codemirror/theme-one-dark`) as the `theme` extension.
  - Note: `useFilePreviewCodeTheme()` returns an `HljsStyle` object (`Record<string, CSSProperties>`) which is incompatible with CodeMirror's `theme` prop (expects a CodeMirror `Extension`). Do NOT pass it directly.
- Language extensions loaded per file extension:

| Extension | Package |
|-----------|---------|
| ts, tsx, js, jsx | `@codemirror/lang-javascript` |
| py | `@codemirror/lang-python` |
| json | `@codemirror/lang-json` |
| md, mdx | `@codemirror/lang-markdown` |
| css, scss | `@codemirror/lang-css` |
| html, htm | `@codemirror/lang-html` |
| rs | `@codemirror/lang-rust` |
| go | `@codemirror/lang-go` |
| java | `@codemirror/lang-java` |
| other | no language extension |

- Props: `value`, `onChange`, `language`, `isDark`, `className`

### `src/app/api/files/raw/route.ts` (modified)

1. Remove the inline `isPathSafe` definition (lines 10–13)
2. Import `isPathSafe` and `isRootPath` from `@/lib/files` (matching `preview/route.ts` pattern)
3. Add `baseDir` query parameter with the same two-branch security model:
   - If `baseDir` is provided: `isRootPath(baseDir)` check → `isPathSafe(baseDir, path)`
   - If `baseDir` is absent: fall back to `isPathSafe(homeDir, path)`

This is required so `FilePreview` can load full file content for editing in projects outside `homeDir`.

### `src/app/api/files/write/route.ts` (new)

- Method: `POST`
- Body: `{ path: string, content: string, baseDir: string }` — `baseDir` is **required**
- If `baseDir` is absent or empty: return `400 Bad Request`
- Security: `isRootPath(baseDir)` check → `isPathSafe(baseDir, path)` (write is always scoped)
- Content size limit: reject with `413` if `content.length` exceeds 10 MB
  - Note: the raw route serves files larger than 10 MB via streaming, so a user could open a >10 MB file in the editor but be unable to save it. This is an accepted limitation — editing files >10 MB is an uncommon case for a side-panel editor.
- On success: `{ success: true }`
- No backup/versioning — Git is the safety net

### `src/types/index.ts` (modified)

Add:

```ts
export interface FileWriteRequest {
  path: string;
  content: string;
  baseDir: string;
}
```

## i18n Keys (new)

Add to `src/i18n/en.ts` and `src/i18n/zh.ts`:

```
filePreview.edit            — "Edit" / "编辑"
filePreview.viewMode        — "View" / "预览"
filePreview.save            — "Save" / "保存"
filePreview.saving          — "Saving…" / "保存中…"
filePreview.saved           — "Saved" / "已保存"
filePreview.unsavedChanges  — "Unsaved changes" / "有未保存的更改"
filePreview.saveError       — "Failed to save" / "保存失败"
```

## Dependencies to Install

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

## Out of Scope

- Multi-file simultaneous editing
- Cross-session undo history
- Diff view
- File creation / deletion from the editor
