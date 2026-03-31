# src/components/git — Git 面板模块

## 文件结构

- `GitStatusSection.tsx` — 分支信息、staged/unstaged 文件列表、提交/推送按钮
- `CommitDialog.tsx` — 提交对话框，含 AI 生成提交信息（右上角 Sparkle 按钮）
- `GitPanel.tsx` — 组合 GitStatusSection + 历史 + 分支 + Worktree 分段
- API 路由：`src/app/api/git/` — commit / push / status / log / branches / generate-commit-message
- Git 底层服务：`src/lib/git/service.ts`（`execFile('git', ...)` 封装）

## ⚠️ 关键细节

- `GitChangedFile.staged`：已正确区分暂存区（index）和工作区，由 `git status --porcelain=v2`
  解析，直接用，无需重新计算；同一文件可能同时出现在 staged + unstaged（部分暂存）
- i18n 已有 `git.staged` / `git.unstaged` 键，无需新增
- AI commit message：`POST /api/git/generate-commit-message { cwd }`
  — 自动用最便宜模型（haiku 优先），检测 CLAUDE.md 中文比例决定语言
  — `git diff HEAD` 获取 diff；新仓库无 HEAD 时降级到 `--cached`
