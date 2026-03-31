# src/components/git — Git 面板模块

## 文件结构

- `GitStatusSection.tsx` — 分支信息、staged/unstaged 文件列表、提交/推送按钮
- `CommitDialog.tsx` — 提交对话框，含 AI 生成提交信息（右上角 Sparkle 按钮）
- `GitPanel.tsx` — 组合 GitStatusSection + 历史 + 分支 + Worktree 分段
- API 路由：`src/app/api/git/` — commit / push / status / log / branches / stage / unstage / discard / generate-commit-message
- Git 底层服务：`src/lib/git/service.ts`（`execFile('git', ...)` 封装）

## ⚠️ 关键细节

- `GitChangedFile.staged`：已正确区分暂存区（index）和工作区，由 `git status --porcelain=v2`
  解析，直接用，无需重新计算；同一文件可能同时出现在 staged + unstaged（部分暂存）
- i18n 已有 `git.staged` / `git.unstaged` 键，无需新增
- staged 区块标题用了 `text-green-600 dark:text-green-400`（原始颜色）——已加 `// lint-allow-raw-color`；unstaged 区块用 `text-muted-foreground` 无需豁免
- LSP 报 props 类型错误时先跑 `npx tsc --noEmit`——IDE 缓存经常滞后，实际编译才权威
- AI commit message：`POST /api/git/generate-commit-message { cwd }`
  — 自动用最便宜模型（haiku 优先），检测 CLAUDE.md 中文比例决定语言
  — `git diff HEAD` 获取 diff；新仓库无 HEAD 时降级到 `--cached`
- Phosphor 图标（Plus/Minus/Trash 等）全量报 `deprecated` TS 警告——是库层面预存问题，不影响编译，忽略即可
- `FileChangeItem` loading 模式：loading=true 时用 spinner 替换整个按钮区；`callApi` 的 `if (loading) return` 是并发锁唯一来源，ActionButton 不需要 `disabled={loading}`
- `service.ts` 的 `commit()` **不自动 stage**：只提交已暂存文件；`git diff --cached --quiet` 返回 0 = 无暂存则抛 "Nothing to commit"
