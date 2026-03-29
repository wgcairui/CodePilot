# 生成式 UI 持久化与项目看板

> 技术实现见 [docs/handover/dashboard.md](../handover/dashboard.md)（看板系统）和 [docs/handover/generative-ui.md](../handover/generative-ui.md)（widget 渲染基础设施）

## 灵感来源

受 [Moxt](https://mp.weixin.qq.com/s/PVA2DSGyCw4uxXx0CUWs1Q) 启发。Moxt 定位为 AI-native workspace，核心洞察：

- **AI 应该在原生格式里工作**：md/csv/html/代码，而非 PDF/PPT/传统文档
- **文件系统是 AI 最熟悉的图书馆**：层级目录 > 传统知识库的非结构化检索
- **0 摩擦**：AI 处理信息带宽极大，1% 摩擦在 n 次幂后趋近于 0——必须保障每次通信零损耗
- **Less Content is More Context（对组织而言）**：AI 产出远超人类，需要用 AI 习惯的方式维护内容

Moxt 实践中最具启发性的案例：**直接在 Moxt 中用生成式 UI 替代了 Jira 看板**——不是用 AI 操控旧看板，而是直接实现看板本身。"同样的信息和数据，你想怎么看就怎么看"。

## 我们解决的用户问题

### 生成式 UI 的"一次性浪费"

当前 widget 绑死在聊天消息里。模型花大量 token 生成一个精心设计的图表或流程图，但用户下次需要类似内容时必须重新描述、重新生成。widget 的复用率为零。

### 项目缺乏"视觉摘要"

打开一个项目，看到的是聊天列表——纯文本、线性、需要翻阅。用户无法一眼看到"这个项目现在什么状态"。对助理工作区尤其明显：memory.md 是纯文本，daily notes 分散在文件里，缺少一个整合的视觉入口。

### 可视化结果无法分享

生成式 UI 产出的图表和示意图质量很高，但只能在 CodePilot 内部看到。用户想把 AI 的分析结果发到社交媒体或分享给团队时，没有导出途径。

## 核心设计理念

### 看板 = AI 对项目的持续理解的视觉化

看板不是"保存的 widget 集合"，而是 AI 对项目的理解在视觉维度上的投影。每个卡片背后是一个数据契约——"这个 widget 展示什么数据、数据从哪来"。每次打开或刷新时，AI 读取最新数据重新填入，布局和样式保持不变。

### AI-first，不是 UI-first

传统看板的思路：用户手动创建卡片 → 定义字段 → 拖拽排列 → 手动更新数据。

AI-first 的思路：

1. **AI 主动提议初始看板**：首次打开时，AI 已经读过项目全部文件，直接提议一版看板。助理工作区 → 日程/待办/记忆摘要；代码项目 → 提交活动/TODO 分布/依赖状态。
2. **AI 自动推断数据契约**：用户在聊天里 pin 一个 widget 时，AI 根据上下文自动推断数据来源和刷新方式，用户一键确认。
3. **AI 驱动更新**：daily check-in 后 AI 顺便更新看板数据；对话中状态变化时 AI 建议同步到看板。
4. **AI 建议新卡片**：用户连续多天提到某个话题，AI 主动提议新增对应卡片。

### 对话 ↔ 看板飞轮

对话和看板不是割裂的两个界面，而是同一个 AI 理解的两种呈现：

- **对话 → 看板**：好的 widget 一键固定；对话中提到的状态变化反映到看板
- **看板 → 对话**：点击卡片发起相关话题对话；看板状态注入对话 context，AI 知道项目全貌
- **看板内对话**：看板页面底部有输入框，用户可以对着看板说话——"把商单B标记为已签约"、"给我加一个本月支出统计"

## 数据架构

### 保存什么

保存的是 **widget 代码 + 数据契约 + 数据源定义**：

- **widget 代码**：原始 HTML/JS/CSS（作为"设计参考"，保留布局和样式）
- **数据契约**：自然语言描述，说明这个 widget 展示什么数据、如何从原始数据中提取
- **数据源**：结构化定义，可以是文件路径、MCP tool 调用、CLI 命令、或它们的组合

每次刷新时，系统按数据源获取最新数据，把「原始代码 + 最新数据」喂给模型，模型只更新数据部分，保留布局和样式。

不做模板语法——模型天然理解"保持设计，换新数据"。

### 数据源类型

```typescript
type DataSource =
  | { type: 'file'; paths: string[]; query?: string }
  | { type: 'mcp_tool'; server: string; tool: string; args: Record<string, unknown> }
  | { type: 'cli'; command: string }
  | { type: 'composite'; sources: DataSource[] }
```

### 存储位置

存在项目目录 `.codepilot/dashboard/` 下：

- 跟着项目走，git 可追踪
- AI 在对话中可直接读写
- 每个项目天然隔离
- 符合 Moxt "文件系统是 AI 的图书馆"理念

### 刷新策略

用户可配，提供开关：

- **自动刷新**：每次打开看板时调模型更新所有卡片（不在乎 token 的用户）
- **手动刷新**：提供刷新按钮，用户按需触发（在乎 token 的用户）

附加优化：数据源文件 mtime 没变则跳过刷新，用上次缓存结果。

### UI 承载方式：右侧面板

看板作为右侧面板，和 Git 面板、文件树面板、预览面板同级。理由：

- **项目级归属**：看板是项目维度的，放在右侧面板天然和当前项目绑定，不需要改动左侧 Chat List 的层级结构
- **与聊天共存**：用户可以边聊天边看看板，符合"对话 ↔ 看板飞轮"的交互模型
- **复用现有架构**：ResizeHandle、PanelContext、TopBar toggle 按钮全部现成

面板宽度参数：

| 参数 | 值 |
|------|-----|
| MIN_WIDTH | 320px |
| MAX_WIDTH | 800px |
| DEFAULT_WIDTH | 640px |

参考：预览面板 320-800px 默认 480px，看板默认值更大因为 widget 内容更丰富。640px 渲染图表和表格完全够用，类似 Claude Artifacts / Gemini 的侧边网页渲染宽度。

Widget 直接在面板内用 iframe 渲染，复用聊天中的 WidgetRenderer 组件。不做摘要模式、不做展开模式——桌面端空间充裕，用户拖窄面板导致样式问题是用户自己的选择，我们只保证默认宽度下体验良好。

## 生成式 UI 作为系统级渲染层

看板不只是聊天 widget 的持久化。**生成式 UI 应该成为 CodePilot 所有子系统的通用可视化出口。**

```
                    ┌─────────────┐
                    │   看板       │ ← 持久化展示层
                    │  Dashboard  │
                    └──────┬──────┘
                           │ pin / render / refresh
                    ┌──────┴──────┐
                    │  生成式 UI   │ ← 通用渲染层
                    │  Widget 系统 │
                    └──────┬──────┘
            ┌──────┬───────┼───────┬──────┐
            │      │       │       │      │
         ┌──┴──┐┌──┴──┐┌──┴──┐┌──┴──┐┌──┴──┐
         │ Chat ││ MCP ││ CLI ││Skill││Bridge│
         └─────┘└─────┘└─────┘└─────┘└─────┘
```

### MCP × 生成式 UI

MCP 工具返回的结构化数据可以直接渲染为 widget。用户配的任何 MCP server（Notion/Linear/数据库等）都自动成为看板的潜在数据源。

场景：用户问"看看 Linear 里这周的 bug 统计" → 模型调 MCP tool → 返回 JSON → 渲染为柱状图 widget → 用户 pin 到看板 → 看板每次刷新时重新调 MCP tool。

生态杠杆巨大——社区几百个 MCP server，每一个都可以成为看板数据提供者。

### CLI 工具 × 生成式 UI

CLI 工具的输出天然是结构化数据，适合可视化：

- `git log --stat` → 提交活动时间线
- `docker ps` → 容器状态卡片
- `npm audit` → 依赖安全仪表盘

CLI 数据源的刷新可以不调模型——命令输出格式稳定，首次生成后可以做纯前端解析。

### 桥接 × 生成式 UI

最有想象力的组合。两个方向：

**看板 → IM 推送**：每日早上自动刷新看板 → 生成截图 → 通过桥接推送到 Telegram/飞书。从"打开才能看"变成"推到你面前"。这是"导出图片"的自动化版本。

**IM → 看板更新**：用户在 Telegram 里说"商单B签了" → 桥接收到 → AI 处理 → 更新数据源文件 → 看板状态随之更新。

### Skills × 生成式 UI

Skill 变成 **widget 工厂**：

- `/weekly-report` → 产出周报 widget（含本周完成事项、关键指标、下周计划），可 pin 可导出
- `/codebase-health` → 运行多个 CLI 工具后产出健康度仪表盘 widget

每个 skill 不只输出文字结论，还输出可持久化的视觉组件。

## 多组件联动（远期）

### 看板级共享状态

```typescript
interface DashboardContext {
  selectedDate?: string;
  selectedItem?: { type: string; id: string };
  filters?: Record<string, unknown>;
}
```

每个 widget 声明 publish（我发布什么事件）和 subscribe（我订阅什么状态），通过 DashboardContext 中转，widget 之间不直接通信。

### 联动场景举例

- **助理"我的一周"**：点日程表某天 → 右侧刷新当天详情 → 点详情某事项 → 下方进度卡片聚焦相关条目
- **代码"项目健康度"**：选提交 → 热力图高亮相关文件 → 点文件 → 展开 diff 摘要
- **内容"排期 + 数据"**：选已发布内容 → 显示表现数据；选未发布 → 显示草稿 + 优化建议

### 对话式看板操控

看板底部输入框，用户对着整个看板说话：

- "把商单B的状态更新为已签约" → 商单进度 widget 数据更新
- "这周三的会取消了" → 日程 widget 更新 + 数据源文件同步修改
- "给我加一个本月支出统计的卡片" → 新 widget 生成并添加

模型知道所有 widget 的数据契约和来源，可以精准修改。

## 与 Moxt 的差异化定位

| 维度 | Moxt | CodePilot 看板 |
|------|------|---------------|
| 定位 | 组织级 AI 原生办公室 | 个人级项目 AI 原生控制台 |
| 部署 | 云端 | 本地优先 |
| 协作 | 多 AI 同事 + 多人 | 单人 + 单 AI |
| 上下文深度 | 广但浅（文档为主） | 窄但深（在代码仓库内部，git/文件/运行时全可达） |
| 数据归属 | 云端 | 完全本地，不上传 |
| 优势场景 | 组织知识管理、多人协作 | 深度项目理解、开发者工作流、个人助理 |

我们不是在做"轻量版 Moxt"，而是在做 **"每个项目的 AI 原生控制台"**。

## 推进优先级

| 阶段 | 内容 | 价值 |
|------|------|------|
| P0 | 聊天 → 看板核心链路（pin widget、看板展示、数据刷新） | 最小可用 |
| P0 | AI 自动推断数据契约 | AI-first 体验基础 |
| P1 | AI 主动提议初始看板 | 零配置上手 |
| P1 | MCP 数据源支持 | 生态杠杆，接入外部数据 |
| P1 | 看板 ↔ 对话双向联动 | 飞轮效应 |
| P1 | 导出图片 | 分享传播 |
| P2 | CLI 数据源支持 | 代码项目杀手功能 |
| P2 | 看板 → Bridge 推送 | 被动变主动 |
| P2 | widget 间点击联动 | 体验飞跃 |
| P2 | 对话式看板操控 | 终极交互形态 |
| P3 | Skill → Widget 工厂 | 锦上添花 |
| P3 | check-in 后自动更新看板 | 助理深度集成 |

## 已知的局限和风险

1. **Token 成本**：每次刷新都调模型，看板卡片多时 token 消耗显著。mtime 缓存可缓解但不能消除。
2. **刷新延迟**：模型生成 widget 需要几秒，多个卡片串行刷新体验差。需要并行刷新 + 骨架屏。
3. **数据契约漂移**：数据源文件结构变化后，原有数据契约可能失效。需要错误检测和自动修复机制。
4. **MCP 依赖**：外部 MCP server 的稳定性不可控，看板卡片可能因 MCP 故障显示空白。
5. **第三方 API Provider 限制**：同现有 widget 系统——部分三方 provider 不处理 appendSystemPrompt，widget 功能可能不可用。

## 技术调研：Pretext 文本排版库

> 项目地址：[chenglou/pretext](https://github.com/chenglou/pretext)
> 作者：chenglou（React 核心贡献者、Reason 语言作者）

### 是什么

纯 JS/TS 的多行文本测量与排版库。核心能力：**不触发 DOM reflow 就能精确计算多行文本布局**。

两阶段架构：
1. **`prepare(text, font)`**：一次性分析——文本分段 + Canvas `measureText()` 测量宽度 + 缓存。500 段文本约 19ms。
2. **`layout(prepared, maxWidth, lineHeight)`**：纯算术换行——基于缓存宽度做行折断。500 段文本约 0.09ms。

第二步是纯数学运算，零 DOM 操作，可在 resize/动画/虚拟化场景下高频调用。

语言支持极广：CJK、日文、阿拉伯文、泰文、缅甸文、emoji、混合双向文本，各语言有专门 corpus 测试。渲染目标不绑定 DOM——可渲染到 DOM、Canvas、SVG，计划支持服务端渲染。

### 对看板和生成式 UI 的价值

**1. 高质量图片导出**

导出看板为图片（社交媒体分享）时，如果用 Canvas 渲染而非简单截图，文本排版是最大难题。Pretext 让我们在 Canvas 上精确排列多行文本，不需要 DOM。意味着：比截图更高质量的导出、文本位置/换行/对齐完全可控、未来服务端图片生成（定时推送到 IM）不依赖浏览器。

**2. Widget 高度预计算（解决高度跳动）**

当前最大 UX 痛点之一是 widget 高度跳动——iframe 加载前不知道高度，加载后突然撑开。如果 widget 文本内容已知，Pretext 可以在 iframe 加载前算出预期高度，提前分配空间，彻底消除跳动。

**3. 看板布局引擎**

看板排列多个 widget 卡片，每个卡片标题/描述文本长度不同。Pretext 可以不渲染就预计算所有卡片高度：无闪烁瀑布流布局、拖拽排序精确占位、响应式重排即时高度计算（0.09ms 级别）。

**4. 异形布局 Widget**

`layoutNextLine()` 支持每行不同宽度——文本可环绕图片、沿曲线排列、在不规则形状内流动。对生成式 UI 有价值：文本环绕图表的信息卡片、圆形/多边形内文字排版、瀑布流中的精确文本截断。

**5. Widget 内部文本虚拟化**

看板 widget 可能包含大量文本（一周日程、几十条商单）。如果 widget 内需要文本虚拟化（只渲染可见区域），Pretext 可提前算好所有文本行高，不需要把文本真的渲染到 DOM 里去测量。

### 设计哲学契合

作者在 thoughts.md 中的核心观点："80% of CSS spec could be avoided if userland had better control over text." 主张把能力下放到 userland 而非无限扩展规范。这与我们的生成式 UI 理念一致——不用预设模板，让 AI 自由生成 HTML/SVG/JS，Pretext 为 AI 生成的代码提供强大的文本排版基础设施。

### 集成评估

| 维度 | 情况 |
|------|------|
| 包大小 | 轻量，纯 TS，零运行时依赖 |
| 兼容性 | Chrome/Safari/Firefox 全通过精度测试 |
| 成熟度 | v0.0.2，早期但测试极严格（多语言 corpus + 跨浏览器精度验证） |
| 集成方式 | `npm install @chenglou/pretext`，ESM |
| 风险 | 版本早期，API 可能变动；核心架构已稳定 |

### 引入时机建议

- **P0-P1 不需要引入**：看板核心链路用现有 iframe 渲染够用
- **P2 值得引入**：导出图片（Canvas + Pretext 高质量生成）、看板布局预计算（消除高度跳动）
- **远期关键依赖**：服务端看板截图（Bridge 定时推送）的非 DOM 渲染方案

---

## 实现后复盘

> 以下是 P0-P2 全部实现完成后的回顾，包含实际踩坑、设计取舍、以及对未来方向的重新审视。

### 实现状态

| 阶段 | 内容 | 状态 | 备注 |
|------|------|------|------|
| P0 | 核心 pin → 展示 → 刷新 | ✅ | MCP 统一路径 |
| P0 | AI 自动推断数据契约 | ✅ | 在对话上下文中推断 |
| P1 | MCP 数据源支持 | ✅ | file / mcp_tool / cli 三种 |
| P1 | 看板 ↔ 对话双向联动 | ✅ | 标题点击 + context 注入 |
| P1 | 导出图片 | ✅ | Electron 隔离窗口截图 |
| P1 | AI 主动提议初始看板 | ⏸ 暂缓 | 时机不成熟 |
| P2 | CLI 数据源 | ✅ | 通过 bash tool 审批执行 |
| P2 | widget 间联动 | ✅ | pub/sub via postMessage |
| P2 | 对话式看板操控 | ✅ → 移除 | 输入框多余，聊天统一入口 |
| P2 | 看板 → Bridge 推送 | ⏸ 暂缓 | |

### 最大的教训：不要改 prompt 格式示例

整个开发过程中最严重的回归不是来自代码逻辑，而是来自修改 `WIDGET_SYSTEM_PROMPT` 中的格式示例。

原始格式块：
```
{"title":"snake_case_id","widget_code":"<raw HTML/SVG string>"}
```

我把 title 从 `"snake_case_id"` 改成 `"Short human-readable title in the user's language"` ——一个看似无害的改动——直接导致 GLM-5-Turbo 模型开始输出各种非标准 fence 格式（单反引号、分离的 json 代码块等），widget 全部渲染为 JSON 代码。

**根因**：模型把格式示例当作"应该长这样"的模板来模仿。当模板中的值从短字符串变成长描述性文本，部分模型会把整个格式块理解为"指导说明"而非"严格模板"，从而在格式执行上放松。

**修复**：还原格式示例，把标题指导放到 rules 列表末尾。同时重写了 widget 解析器为 fence-agnostic（用 JSON brace matching 替代固定 regex），作为防御性改进。

**教训**：对模型行为有影响的 prompt 改动，必须像改数据库 schema 一样谨慎——在目标模型上做 A/B 测试，而不是"看起来合理就改"。

### 安全层面学到的

1. **"只加 CSP"不等于安全**。`connect-src 'none'` 阻断 fetch/XHR/WebSocket，但 `img-src *` 允许通过图片请求信道泄漏数据，`will-navigate` 允许通过 top-level 导航泄漏。安全封堵必须覆盖所有出口通道。

2. **auto-approved MCP 工具不能执行 shell 命令**。即使是在对话上下文中，如果工具内部直接 `execSync()`，用户看到的审批界面只有 widgetId，完全不知道自己批准了什么命令。正确做法：MCP 工具返回命令文本，让模型通过 bash tool（有标准审批流程）执行。

3. **导出 iframe 的 `allow-same-origin` 是个陷阱**。看起来"临时的所以安全"，但 widget 脚本在 finalize 阶段执行时就已经拥有了 parent.document 访问权。最终采用 Electron 隔离 BrowserWindow 方案——独立进程、独立 partition、无 preload、导航阻断。

### iframe 是一种"接近正确但永远有边界的"隔离

这次实现中最花时间的部分不是功能逻辑，而是 iframe 的各种行为边界：

- **排序**：React 重排 keyed 元素会 detach+reattach DOM，对普通 div 无感，但 iframe 会重载。最终用 CSS `order` 解决。
- **CDN 脚本**：inline script 和 CDN script 的执行时序不可预测。模型生成的代码经常不按 guidelines 写 onload。receiver script 的 CDN 处理逻辑迭代了 5 个版本才稳定。
- **导出**：sandbox iframe 不能 `contentDocument`，加 `allow-same-origin` 又有安全问题。foreignObject 方案抓不到 canvas 像素。最终转向 Electron native 截图。
- **高度同步**：`body.scrollHeight` 是唯一可靠的高度来源，但固定高度容器 + content-box 会导致内容溢出底部 padding。

每个问题的最终解都不复杂，但找到它们的过程说明：**iframe 作为隔离边界是一种妥协——它提供的不是完美的隔离，而是"在可接受的成本下足够好的隔离"**。

### 打通以后怎么用

看板的核心价值不在于"展示图表"，而在于**让 AI 持续了解项目状态**。几个高价值场景：

**1. 项目健康监控**

让 AI 生成一组监控 widget——git 提交热力图、dependency 更新状态、test coverage 趋势——pin 到看板。每次打开项目，AI 通过 `<active-dashboard>` 知道这些指标，能在对话中主动提醒"你的 test coverage 这周下降了 3%"。

**2. 外部数据源集成**

配了 Linear/Notion MCP server 的用户可以 pin MCP 数据源 widget。"帮我可视化 Linear 里本周的 bug 统计" → 模型调 Linear MCP tool 获取数据 → 生成图表 → pin 到看板。刷新时模型自动调 MCP tool 获取最新数据。

**3. CLI 输出可视化**

`git log --stat` / `docker ps` / `npm audit` 这类命令输出变成持久化的可视化卡片。开发者不需要记命令、不需要手动看终端输出——AI 把它变成一目了然的图表。

**4. 跨 widget 联动分析**

筛选器 widget + 数据列表 widget 组合使用。点击筛选条件，相关数据自动过滤。这不是写死的联动逻辑，而是 AI 在生成 widget 时用 `__widgetPublish` / `widget-filter` API 实现的动态联动。

### 解决问题的方法论

实现过程中总结的几个原则：

1. **先修根因，再加防御**。widget 渲染问题的根因是 prompt 格式示例被改动，但同时也暴露了解析器过于脆弱。两个都修：还原 prompt（修根因）+ fence-agnostic 解析器（加防御）。

2. **安全是最后验证，不是最后添加**。每个涉及代码执行的路径（iframe sandbox、export window、CLI 刷新）都在实现后被审查出安全问题。应该在设计阶段就列出所有出口通道并逐一封堵。

3. **不要维护两条路径**。最初设计了"API 路由 pin + MCP 对话 pin"两条路径。用户正确指出这增加维护成本和出错可能。统一到 MCP 一条路径后，代码量更少、行为更一致。

4. **DOM 操作要考虑 iframe 的特殊性**。对普通 div 有效的操作（React key 重排、setState 触发 re-render、DOM clone for screenshot）在 iframe 上都可能失效或产生副作用。

### 对未来发展的思考

**看板是 AI agent 的"工作台"，不是用户的"仪表盘"。**

传统仪表盘的设计思路是：用户定义指标 → 系统展示数据 → 用户看数据做决策。这是 human-first 的思路。

AI-first 的看板应该是：**AI 在工作中产出的视觉工件的展示空间**。AI 分析了代码就产出 coverage widget，AI 处理了 issue 就更新 issue 状态 widget，AI 做了 code review 就产出 diff 统计 widget。看板不是用户配置出来的——是 AI 工作过程中自然涌现出来的。

这个方向上还有几个关键的未解问题：

1. **AI 什么时候应该主动更新看板？** 对话中提到了相关数据就更新？每次 check-in 后自动更新？还是只在用户明确要求时更新？目前没有自动更新触发机制。

2. **widget 的生命周期管理**。看板卡片会越来越多，但没有"这个 widget 已经过时了"的检测。需要一种机制让 AI 或用户能识别和清理不再有价值的卡片。

3. **多看板 / 看板视图**。一个项目可能有多个关注维度——代码健康、产品指标、团队协作。当前是单一看板，未来可能需要分组或分页。

4. **widget 的可编辑性**。用户看到 widget 上的数据不对，目前只能在对话中说"帮我改一下"。能否直接在 widget 上双击编辑数值？这涉及到 widget 从"只读展示"变成"可交互表单"的架构转变。

5. **widget 作为 AI 的"视觉记忆"**。当 AI 看到看板上有一个"本周计划"widget，它应该能理解这些计划的完成状态，并在后续对话中主动跟进。这需要 `<active-dashboard>` 注入的内容更丰富——不只是标题和数据契约，可能需要包含 widget 的核心数据摘要。

**最终愿景**：打开一个项目，看板上已经有 AI 根据项目特征自动生成的卡片。开始工作后，AI 在对话中产出的分析自然沉淀到看板。一天结束时，看板是 AI 今天帮你做了什么的视觉记录。第二天打开，AI 看着看板说："昨天你要做的三件事还有一件没完成，要现在继续吗？"

这就是"AI 原生项目控制台"的含义——不是人配置给 AI 看的，是 AI 工作给人看的。
