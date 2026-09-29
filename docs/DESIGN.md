# NoteFlow 整体设计完善方案

> 版本 v1.3 设计评审 · 2026-09-28 · 依据：v0.3.0 代码全量盘点（行号级证据见附录 C）
> 性质：**设计文档，不修改任何代码**。所有建议均为待实施方案。

## 0. 设计目标与「克制」三原则

NoteFlow 的定位：**单机单人、纯文件系统、与 AI 深度协作的 Markdown 笔记应用**。它不是 Notion、不是 Obsidian 全家桶，核心差异点是「AI 直接读写你的笔记库 + 写保护审批」。

本方案遵循三条克制原则，每条建议都要过这三关：

1. **复用优先**：quickforge 闭包里已有的能力（API、组件、渲染管线）优先接线，不重造。本次盘点发现至少 **7 套已就位但未接线的能力**（见 §4.9），这是最高性价比的改进来源。
2. **不引依赖优先**：能用 50 行自研解决的不引包；每个新依赖必须回答「删掉它损失什么」。
3. **不加功能优先**：默认不做；只有与「写笔记 × AI 协作」主线强相关、且缺失会造成明显体验断层的功能才进路线图。

功能完整 ≠ 功能多。专业感来自：**每个已有功能做完整（无半成品），高频路径零摩擦（键盘可达），破坏性操作可逆（回收站/审批/草稿）**。

配套图示：[docs/gap-map.svg](./gap-map.svg)（三栏架构 + 功能域完成度差距地图）。

---

## 1. 现状技术栈评估

### 1.1 技术栈清单（package.json 实测）

| 层 | 技术 | 版本 | 评价 |
|---|---|---|---|
| 框架 | React + react-dom | 19.2 | ✅ 稳定，无升级必要 |
| 语言/构建 | TypeScript / Vite | ~6.0 / ^8.0 | ✅ 可用；TS 6 较新，注意 baseUrl 已废弃（已踩过坑） |
| 样式 | Tailwind CSS + typography | 4.2 | ✅ 语义 token 已全量落地（bg-background 等），无 zinc 残留（除 1 个死文件，见 §4.10） |
| 底座 | @shawnstack/quickforge | ^2.2.0 | ⚠️ 双刃剑：public-api 提供文件/模型/SSE 全套；前端源码快照需手动同步 |
| Agent 表面 | pi-agent-core + pi-ai | 0.80.3 | ✅ 与 quickforge 版本锁定一致即可 |
| 渲染 | react-markdown + remark-gfm / rehype-* | 10.x | ✅ |
| 富内容 | katex / mermaid / highlight(自研52色) | — | ✅ 依赖已装，但中栏阅读模式只用了部分（KaTeX 未接，见 §4.3） |
| 文档预览 | pdfjs-dist / docx-preview / xlsx / jszip | 5.4.394 等 | ⚠️ 依赖在、预览管线在（artifact-preview-utils.ts:65-68 三分流 browser/reader/document），**中栏未接线** |
| UI 基础 | lucide-react / cva / clsx / tailwind-merge | — | ✅ 标准 quickforge 组合 |
| 测试 | — | 无 | ❌ 无测试框架、无 test script |

### 1.2 架构健康度

**做得对的（保持，不动）**：

- **零数据库**：笔记 = 文件系统 `notes/` 目录，数据主权清晰，随时可被任何编辑器打开。这是克制架构的根基。
- **专属 QuickForge 实例**（server.mjs:61-95，端口 5178、独立数据目录 `~/.noteflow`、`reuseExisting:false`）：与桌面版完全隔离，生产 `--serve-static` 反代含 SSE 不缓冲不超时的处理。
- **聊天渲染快照复用**：surface 全家 + CSS 抽取，避免重造 15000 行；适配层 surface-agent.ts 把 HTTP/SSE 包成 Agent 表面，边界干净。
- **写保护 + 外部变更检测**（NoteEditor.tsx:182-210 + ChatPanel.tsx:173-188）：人与 AI 并发写同一文件的冲突治理，这是本项目最专业的设计，应继续强化（见建议 A7 diff 预览）。

**风险与债（按影响排序）**：

1. **快照漂移**：`src/components/chat/surface/` 是复制时点的 quickforge 源码，无版本标记，升级靠人肉 diff。→ 建议补一份 `SNAPSHOT.md` 记录来源版本与同步清单（P1，纯文档）。
2. **状态散点**：无状态库（此规模不必加），但 localStorage key 散落（`noteflow.draft:<path>`、`noteflow.agent.sessionId`、偏好若干），无统一版本迁移机制；draft key 只增不清。→ 收敛到统一 settings 单 key + 草稿过期清理（P1）。
3. **textarea 编辑器天花板**：无语法高亮/行号/查找替换。克制取舍见 §5 B1（先零依赖增强，CodeMirror 6 仅作 P2 评估）。
4. **无任何测试**：纯函数（countWords、artifact-preview-utils、workspace-tree-state）值得 vitest 覆盖（P2，克制规模）。

### 1.3 增量技术决策表（本方案全部依赖取舍）

| 决策点 | 方案 | 结论 |
|---|---|---|
| 编辑器 | A. textarea 零依赖增强 / B. CodeMirror 6 / C. Monaco | **A（P1）→ 视反馈决定是否 B（P2）**。C 明确否决——项目当初换 CodeBlock 就是为省掉 monaco，不回头 |
| 状态管理 | Zustand / Jotai / 不加 | **不加**。组件规模未到，收敛 localStorage 即可 |
| 全文搜索 | lunr / flexsearch / 服务端 grep | **服务端 grep_files**（现状），前端只补交互。理由：笔记库即目录，grep 天然全量、零索引维护 |
| 双链/标签 | 图数据库 / d3 图谱 / grep + 前缀约定 | **后者**：`[[wikilink]]` 正则解析 + backlinks 用 grep_files 反查，零新依赖（P1） |
| 版本历史 | 自建快照 / git | **git**：闭包 workspace-api.ts:218-323 已有 status/diff/log 全套 API，只需 UI 接线（P1，默认关闭） |
| 文档预览 | 自研解析器 / 接线现成管线 | **接线**：pdfjs/docx-preview/xlsx 依赖已装，artifactPreviewMode 三分流已实现（P0 修复项） |
| 测试 | 无 / vitest 最小集 | **vitest 仅纯函数**（P2），不为 UI 写快照测试 |

---

## 2. UI / 交互审计（逐栏）

### 2.1 全局骨架

| 项 | 现状 | 评价 |
|---|---|---|
| 顶栏 | Logo / 项目徽章 / ⌘P 搜索 / 左右栏折叠 / 设置齿轮（App.tsx:155-201） | ✅ 简洁克制 |
| 三栏拖拽 | 左 180-440px、右 300-620px（App.tsx:62-87） | ✅；❌ **宽度/折叠态不持久化**，刷新丢失 |
| 键盘 | ⌘P/⌘N/Esc/⌘S（App.tsx:95-110、NoteEditor.tsx:160-171） | ❌ 缺 ⌘,（设置）、⌘E（模式切换）、⌘B/⌘I（格式）等（详见 §4.8） |
| 反馈 | Toast（自研，最多 3 条）+ 破坏性确认（quickforge confirm，destructive 禁 Enter 防误触——好评） | ✅；Toast 无手动关闭按钮（小瑕疵） |
| 容错 | 全局 ErrorBoundary + 启动失败兜底页 | ✅ |
| 主题/语言 | 无暗色切换、无语言切换（i18n.ts 中英词条全量已备但无 UI 入口） | ❌ 见 §4.7 |

### 2.2 左栏（文件树）

现有：新建笔记/文件夹（行内输入，Enter/Esc/blur 语义正确）、懒加载分页、目录状态机重试、图片缩略图、手动刷新、外部信号刷新。

缺失（详见 §4.1）：

- **选中行无高亮**——`WorkspaceFileTree.tsx:81` 为 `isSelected ? '' : ''`（复制快照时丢失，本次会话 read_file 复核确认）。用户点开后不知道当前文件是哪个，这是三栏应用的基本盘缺陷。
- 无右键菜单 / 拖拽移动 / 多选——文件重命名、删除必须先点开文件再去中栏工具栏操作，**高频操作路径绕远**。
- `.trash/` 与正常笔记同列混排（FileTree.tsx 对 .trash 无任何处理）。
- 组件能力在、宿主没接：`onPreviewFile`（眼睛按钮）与 `gitStatuses` 渲染列在 WorkspaceFileTree.tsx:70-74 支持，但 FileTree.tsx:185-195 未传。

### 2.3 中栏（阅读/编辑）

现有（做得好的点名保留）：三模式 read/edit/split；⌘S 仅 dirty 时拦截；草稿保护（localStorage 防抖 800ms + 重开恢复提示）；**外部变更检测**（focus + 10s 轮询，干净静默重载 / dirty 弹琥珀横幅二选一）——与 AI 协作的关键保障；中文字数统计；图片预览。

缺陷：

- 编辑器是裸 `textarea`（NoteEditor.tsx:441-450，本次会话复核）：无 Tab 缩进、无 ⌘B/⌘I、列表回车不自动续行、无查找替换、无撤销重做按钮。
- **未保存切换无拦截**：新建笔记不落盘仅设 selectedPath（App.tsx:87-93），编辑后直接点树上其他文件 = 静默丢失（草稿保护只在「重新打开同一路径」时生效）。
- split 模式左右滚动**无同步**；无 TOC/大纲侧栏。
- 阅读模式渲染弱于聊天：聊天有 KaTeX（surface/Markdown.tsx:5-19）而 MarkdownReader 没有；`skipHtml` 丢弃内嵌 HTML。
- **预览分流 bug**：`isBrowserPreviewablePath` 含 `.html`（artifact-preview-utils.ts:61-63，本次会话复核），但 NoteEditor.tsx:454-461 一律塞 `<img>`——html 文件会显示成碎图。现成的三分流函数 `artifactPreviewMode()`（browser/reader/document）就在旁边未被使用；PDF/Word/Excel 的 document 预览管线（依赖已装）同样未接线。

### 2.4 右栏（AI 对话）

现有：quickforge surface 全家（思考块折叠、工具卡、代码块复制/全屏、Mermaid、UsageBar、长对话窗口化虚拟滚动、附件全家桶粘贴/拖放/PDF/docx/xlsx、Enter/Shift+Enter/IME 保护）；多会话切换/删除（带确认，列表展示 title，:301）；模型切换收敛为输入框内 quickforge 原版菜单（含外点遮罩，:334）；写保护审批流（盾牌开关 + tool_approval_required + 审批卡）；附带当前笔记（8000 字符截断）；stop 中断。

> 注：ChatPanel.tsx 与 quickforge-surface.css 在本次评审期间被外部并行更新（模型菜单从顶部 select 改为输入框内菜单并加外点遮罩、调试状态脚注被移除），下文涉及其行号以 2026-09-28 15:00 时点为准。

缺陷（详见 §4.5/§4.6）：

- 会话**不能重命名**（title 固定 'NoteFlow 对话'，api.ts:184，本次会话 grep 复核无任何 rename/title 调用）、**不能导出**；多会话列表全部同名，列表可用性归零。
- **消息级操作缺失**：不能复制整条 AI 回复（只有代码块级复制）、不能编辑重发用户消息、不能重新生成。
- **审批卡无 diff**：只展示 args JSON 截断 2000 字（ChatPanel.tsx:362-383），看不到 write_file 将改写的新旧内容对比——写保护是本项目核心差异点，审批体验却是「盲批」。闭包里 `lib/diff-view.ts` 现成未接。
- AI→笔记只有单向（笔记→AI 上下文），AI 的回复**不能一键插入/追加到笔记**，用户只能手动复制粘贴。
- 会话列表下拉无外点关闭（:289-309，无遮罩；模型菜单 :334 已有 `fixed inset-0` 遮罩可直接复刻）。调试状态脚注已在评审期间被外部更新移除。

### 2.5 全局搜索（⌘P）

现有：文件名/全文双模式、防抖、全文结果带行号预览、Enter 直达第一条。

缺陷：**Enter 永远取第一条**、无 ↑↓ 键盘导航（SearchPalette.tsx:87-93，本次会话复核确认）、无命中词高亮、无最近打开、结果上限 100 无提示、无正则/大小写开关。

### 2.6 弹窗与命令式交互

quickforge `showConfirm`/`showPrompt` 复用（命令式、Esc/Enter 语义、destructive 防误触）——**方向正确，继续保持**；新的树内重命名等应优先就地行内编辑而非弹窗（见 A1）。

---

## 3. 现有功能清单（基线盘点）

> 供对照 §4 差距分析。完整行号证据见附录 C。

**文件管理**：文件树（懒加载分页/目录重试/图片缩略图）· 新建笔记（支持 `日记/今天.md` 自动建目录）· 新建文件夹 · 手动/信号刷新 · 重命名 · 移入回收站（`.trash/` 可恢复）

**阅读编辑**：read/edit/split 三模式 · ⌘S 保存 · Markdown 工具栏 11 按钮（H1-H3/粗斜/行内代码/引用/两种列表/链接/代码块/表格）· 字数统计 · 草稿保护 · 外部变更检测 · 图片预览 · 代码文件 CodeBlock 高亮

**AI 对话**：流式回复（思考块/工具卡/52 色代码块/Mermaid/KaTeX）· 附件全家桶（图片/PDF/Word/Excel/zip）· 多会话（列表/切换/删除）· 模型即时切换 · 写保护审批 · 附带当前笔记上下文 · stop 中断 · UsageBar · 窗口化虚拟滚动

**搜索**：⌘P 文件名/全文双模式 + 行号预览

**设置**：默认模型 · 默认写保护/附带笔记偏好 · 消息字号 14-17px · 关于 · 新 provider 引导（6 预设 + 测试连接）

**全局**：三栏拖拽调宽 · 左右栏折叠 · Toast · 确认弹窗 · 错误边界 · 快捷键 ⌘P/⌘N/Esc/⌘S

---

## 4. 功能缺失与半成品分析

优先级定义：**P0** = 修缺陷 + 给已就位的能力接上最后一公里；**P1** = 专业笔记体验标配（克制新增）；**P2** = 锦上添花，看反馈再上。

> 图形化总览见 [docs/gap-map.svg](./gap-map.svg)。

### 4.1 文件管理（树）

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | 选中行高亮（三栏应用基本盘） | WorkspaceFileTree.tsx:81 `isSelected ? '' : ''`（会话复核） | **P0** |
| 2 | 右键菜单（重命名/删除/新建子项/复制路径） | 全 src 无 contextmenu 处理（grep 验证） | **P0** |
| 3 | `.trash/` 隐藏或回收站视图 | FileTree.tsx 对 .trash 无处理，与正常笔记混排 | **P0** |
| 4 | 树内重命名/删除（现绕道中栏工具栏） | 重命名/删除仅在 NoteEditor.tsx:232-257 | **P0**（并入 #2） |
| 5 | 拖拽移动文件 / 多选 | 无 draggable/onDrop（仅聊天输入框有拖放） | P2 |
| 6 | 树内过滤/排序选项 | 顺序纯随服务端返回；WorkspaceFileTree.tsx:74 组件支持 gitStatuses 列但未传 | P1（排序）/ P2（拖拽多选） |
| 7 | 预览眼睛按钮（onPreviewFile） | 组件支持（WorkspaceFileTree.tsx:87），FileTree.tsx:185-195 未传 | P1 |

### 4.2 编辑器

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | 未保存切换/关窗拦截 | 新建不落盘（App.tsx:87-93）；切换 selectedPath 无 dirty 拦截；无 beforeunload | **P0** |
| 2 | Tab 缩进 / 列表回车续行 / ⌘B ⌘I ⌘K | NoteEditor.tsx:441-450 裸 textarea，无 keydown 处理（会话复核） | **P0** |
| 3 | split 滚动同步 | 无任何 sync 代码（grep scrollSync 无匹配）；聊天侧有现成 scroll-sync.ts 可参考 | P1 |
| 4 | 查找替换（⌘F） | 无 | P2 |
| 5 | 语法高亮/行号编辑 | 同 #2；取舍见 §5 B1 | P2（CodeMirror 评估） |
| 6 | 撤销/重做按钮 + 图片粘贴插入 | 工具栏无此按钮（NoteEditor.tsx:368-408） | P1（图片粘贴）/ P2 |

### 4.3 阅读渲染

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | 预览分流修复：html 应走 iframe | artifact-preview-utils.ts:61-63 含 .html（会话复核）；NoteEditor.tsx:454-461 一律 `<img>`（会话复核）；现成 artifactPreviewMode() 三分流未用 | **P0** |
| 2 | PDF/Word/Excel 预览接线 | 依赖已装（package.json:23-37）；document 预览管线在（artifact-preview-utils.ts:46-48、65-68）；README 已知限制 :130 承认 | **P0**（最高性价比） |
| 3 | KaTeX 数学公式（阅读模式） | 聊天有（surface/Markdown.tsx:5-19 + chat-math.ts），MarkdownReader 无 | P1 |
| 4 | TOC/大纲侧栏 + 标题锚点跳转 | MarkdownReader.tsx 无任何 heading id/TOC 逻辑 | P1 |
| 5 | 内嵌 HTML 支持 | MarkdownReader.tsx:114 `skipHtml` | P2（安全默认关闭） |
| 6 | 大图 lightbox | 中栏图片无点击放大；聊天侧 CodeBlock lightbox 已有可复用 | P2 |

### 4.4 搜索

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | ↑↓ 键盘导航 + Enter 取当前项 | SearchPalette.tsx:87-93 Enter 恒取第一条（会话复核） | **P0** |
| 2 | 命中词高亮 | 渲染处（SearchPalette.tsx:143-156）纯文本截断 | P1 |
| 3 | 最近打开（空态默认页） | 无 recent 逻辑（grep 无匹配） | P1 |
| 4 | 正则/大小写开关、结果分页/超限提示 | api.ts:74-93 limit=100 硬编码 | P2 |

### 4.5 AI 对话（会话与消息管理）

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | 会话重命名 | title 仅创建时可设（api.ts:181-185），无更新端点（:181-240 全量会话接口实测）；会话列表已展示 title（ChatPanel.tsx:301），仅缺写入端（grep 复核：run_command 实测零匹配） | **P0** |
| 2 | 消息复制（整条 AI 回复） | AssistantMessage.tsx 仅 cost 按钮（:126-132）；UserMessage.tsx 纯渲染 | **P0** |
| 3 | 审批卡 diff 预览 | ChatPanel.tsx:362-383 仅 args JSON；lib/diff-view.ts 现成未接 | **P0** |
| 4 | AI 回复一键插入笔记 | noteContext 仅单向笔记→AI（App.tsx:113-115）；无任何回流通道 | **P0**（闭环核心差异化） |
| 5 | 会话导出（md/json） | 无任何 export 逻辑（grep 验证） | P1 |
| 6 | 编辑重发 / 重新生成 | surface 快照内 UserMessage/AssistantMessage 均无此按钮 | P1（需改快照，评估成本） |
| 7 | 会话下拉外点关闭 | ChatPanel.tsx:289-309 无遮罩；模型菜单 :334 已有现成遮罩可复刻 | **P0**（一行级） |
| 8 | ~~调试状态脚注移除~~ | 评审期间已被外部更新移除（原 ChatPanel.tsx:413-419） | ✅ 已解决 |

### 4.6 笔记组织专业功能（标签/双链/模板/版本）

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | `[[wikilink]]` 渲染 + backlinks 反链面板 | MarkdownReader 无 wikilink 语法处理；grep 可实现，零依赖 | P1 |
| 2 | 标签（#tag）+ 标签栏/按标签过滤 | 无 | P1 |
| 3 | 版本历史（查看/恢复） | git API 全家在闭包 workspace-api.ts:218-323（status/diff/log/branch）完全未接线 | P1（复用 git） |
| 4 | 模板（templates/）+ 每日笔记按钮 | README 仅示例路径「日记/今天.md」，无专门入口 | P2 |
| 5 | 全库统计（笔记数/最近编辑聚合视图） | 无 | P2 |

> 注：Obsidian 式图谱视图**刻意排除**（见 §7），backlinks 列表足够。

### 4.7 设置与模型

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | 暗色模式切换 | CSS 已全量语义 token 化（styles.css/quickforge-surface.css），仅差 :root class 切换与 UI | P1 |
| 2 | 语言切换 | i18n.ts 中英词条全量已备，无切换入口 | P1 |
| 3 | provider 列表/编辑/删除管理 | SetupDialog 仅能追加一个 OpenAI 兼容 | P1 |
| 4 | 面板宽度/折叠/上次文件持久化 | App.tsx:26-29 useState 固定初值 | **P0**（体验断层：每次刷新回到默认态） |
| 5 | 字号仅作用聊天不作用正文 | SettingsDialog.tsx:156-183 仅设 `--quickforge-message-font-size` | P2 |

### 4.8 全局交互与快捷键

| # | 缺失项 | 证据 | 级 |
|---|---|---|---|
| 1 | 快捷键体系补全：⌘, 设置 · ⌘E 模式切换 · Esc 关闭当前文件 | App.tsx:95-110 仅 3 键 | P1 |
| 2 | 快捷键帮助面板（? 或 ⌘/） | 无 | P2 |
| 3 | 窄屏/移动端基础适配（三栏 → 单栏切换） | 布局固定三栏 + 拖拽最小宽度，无媒体查询 | P2 |
| 4 | beforeunload 草稿提醒 | 无 | **P0**（并入 4.2#1） |

### 4.9 已就位未接线的 7 套能力（最高性价比清单）

| 能力 | 位置 | 接线后点亮 |
|---|---|---|
| 文档预览三分流 artifactPreviewMode | artifact-preview-utils.ts:65-68 + pdfjs/docx/xlsx 依赖 | PDF/Word/Excel 预览（4.3#2） |
| git API 全家 | workspace-api.ts:218-323 | 版本历史（4.6#3） |
| diff-view.ts | lib/diff-view.ts | 审批卡 diff（4.5#3）、版本对比 |
| chat-math/KaTeX 管线 | lib/chat-math.ts + surface/Markdown.tsx | 阅读模式公式（4.3#3） |
| onPreviewFile 眼睛按钮 + AttachmentOverlay 大图 | WorkspaceFileTree.tsx:87 / surface/index.ts:17 | 树上预览、中栏 lightbox |
| code-highlight.ts（52 色） | lib/code-highlight.ts | 编辑模式高亮（若上 CodeMirror 则不需要） |
| i18n 双语词条 | lib/i18n.ts 全量 | 语言切换（4.7#2） |

### 4.10 半成品 / 死代码（清理项，均 P0/P1 级小活）

| 项 | 证据 | 处置 |
|---|---|---|
| 孤儿组件 Markdown.tsx（zinc 硬编码残留，无人引用） | src/components/Markdown.tsx 全 70 行，grep 无 import | 删除（P1） |
| vite.config 注释仍写 "zhibi" | vite.config.ts:8 | 改注释（P1） |
| i18n todoWrite* 词条无渲染器 | i18n.ts:712-721 vs surface-agent.ts:24-37 注册清单 | 补 5 类工具渲染卡或删词条（P2） |
| ChatTypes plan-mode 钩子 `__quickforgePlanBaseOnSend` | ChatTypes.ts:104-105 | 确认不用则删（P2） |
| README 已知限制中「图片无预览」已过时 | README.md:130 vs NoteEditor.tsx:454-461 已实现图片 | 文档更新（P1） |

---

## 5. 克制的设计建议（含交互设计）

> 编号 A=第一性修复/接线（P0），B=专业体验（P1），C=锦上添花（P2）。每项含：入口 → 交互流程 → 复用点/依赖决策 → 工作量级（S≤半天 / M 1-2 天 / L 3 天+）。

### A1（P0）文件树右键菜单 + 就地重命名

- **入口**：树上条目 contextmenu（含触控长按）；替代方案 hover ⋯ 按钮冗余，克制不加。
- **流程**：右键 → 自绘小菜单（复用 Dialog 的 portal + 现有样式 token，约 80 行组件）：`新建笔记 / 新建文件夹 / 重命名 / 移入回收站 / 复制路径`。重命名 = 就地行内输入（复用 FileTree.tsx:96-117 现有行内输入交互），Enter 提交走现有 `run_command mv` 链路 + treeVersion 刷新；删除复用现有 confirm + `.trash` 流程。
- **复用**：零新依赖；与中栏工具栏并存（中栏保留，树上更近）。
- 工作量 **M**。

### A2（P0）选中高亮 + .trash 隐藏

- `WorkspaceFileTree.tsx:81` 空实现补上 `bg-accent/50 text-accent-foreground`（与 quickforge 命中样式一致）；FileTree 请求子目录时过滤 `path === '.trash'` 顶层节点。工作量 **S**。

### A3（P0）预览分流修复 + PDF/Word/Excel 接线

- **入口**：中栏打开对应类型文件时自动进入（无新 UI）。
- **流程**：NoteEditor 预览分支改用 `artifactPreviewMode(path)` 三分流：html → 沙箱 iframe（`sandbox` 属性，禁脚本外联）；pdf/docx/xlsx → document 预览组件（surface 快照已有 attachment 预览全家桶可搬，或直接按闭包管线接 pdfjs/docx-preview/xlsx）；图片 → 现有 `<img>` 不动。
- **复用**：全部依赖已在 package.json，零新增。工作量 **M**。

### A4（P0）未保存拦截

- **流程**：① 切换 selectedPath 时若 dirty → quickforge `showConfirm`（「保存并切换 / 放弃 / 取消」三态，或简化为两态：保存/放弃）；② `beforeunload` 有 dirty 时阻断关闭（原生浏览器确认）；③ 新建笔记立即落盘空文件（消除「幽灵选中」）或维持现状但依赖①兜底。
- **复用**：showConfirm 现成。工作量 **S**。

### A5（P0）编辑器零依赖增强包

- **流程**（textarea keydown 层，约 120 行）：Tab/Shift+Tab 缩进两空格；选中行列表状态下回车自动续 `- `/`1. `；空列表项回车退出列表；⌘B/⌘I/⌘K 包裹选区（复用工具栏已有的 wrapSelection 逻辑）；括号引号自动配对（选区包裹优先）。
- **依赖决策**：不引 CodeMirror（P2 再评估）。工作量 **M**。

### A6（P0）搜索键盘导航

- **流程**：↑↓ 在结果列表移动高亮（wrap 循环）、Enter 打开当前项、⌘↵ 打开第一条、Tab 切换文件名/全文模式；结果条目命中片段 `<mark>` 高亮。工作量 **S**。

### A7（P0）审批卡 diff 预览

- **入口**：写保护审批卡（ChatPanel.tsx:390-409）内新增折叠区「变更预览」。
- **流程**：`toolName === 'write_file'` 且存在旧文件 → 拉旧内容 → `lib/diff-view.ts` 行级 diff（增绿删红，与聊天 diff 渲染同风格）→ 默认折叠，点开看 ±行数摘要。新建文件显示「新建 +N 行」。这是写保护从「盲批」到「明批」的关键。
- **复用**：diff-view.ts 现成。工作量 **M**。

### A8（P0）AI 回复一键插入笔记（双向闭环）

- **入口**：AI 消息尾部 hover 操作条（复制 | 插入笔记）；代码块已有复制按钮，插入按钮加在其旁或消息层。
- **流程**：点击 → 若当前有打开笔记且在编辑/分屏态 → 回复 Markdown **追加**到草稿尾部（前空一行）+ toast「已插入」+ 光标移至末尾；无打开笔记 → prompt 输入新文件名落盘。与 A1「复制路径」同为高频路径铺路。
- **复用**：updateDraft/保存链路现成；需在 surface 快照 AssistantMessage 加一个透传按钮（快照内最小改动，SNAPSHOT.md 记录）。工作量 **M**。

### A9（P0）会话重命名 + 下拉外点关闭 + 消息复制

- 重命名：会话列表条目 hover ✏️ → showPrompt 改 title。写入端二选一：若 quickforge 有会话 title 更新 API 则直连；否则本地 localStorage 映射 sessionId→标题（列表渲染处合并，:301 已展示 title 字段，克制兜底）。下拉面板复刻模型菜单的 `fixed inset-0` 遮罩（:334 现成模式）。消息复制按钮与 A8 同一操作条。工作量 **S~M**。

### A10（P0）面板状态持久化

- localStorage 单 key `noteflow.layout`（leftWidth/rightWidth/左右折叠/selectedPath），启动恢复；顺手建立统一 settings 读写工具（为后续草稿清理、最近打开铺路）。工作量 **S**。

### B1（P1）编辑器增强二期：split 滚动同步 + 图片粘贴插入

- 滚动同步：按滚动百分比同步（聊天侧 scroll-sync.ts 思路），编辑侧驱动预览侧单向即可（克制：不做双向锚点对齐）。图片粘贴：paste 事件拦截 → `notes/assets/` 下 `write_file` 二进制（走 quickforge 文件 API，需确认二进制支持，否则暂存 data URL 并提示）→ 插入相对路径。工作量 **M**。

### B2（P1）TOC 大纲 + KaTeX + wikilink/backlinks + 标签

- **TOC**：阅读模式工具栏「大纲」按钮 → 左滑浮层面板列出 H1-H3（点击滚动锚点，heading 渲染时加 id）。**不做常驻第四栏**（克制）。
- **KaTeX**：MarkdownReader 接 chat-math 管线（import 级改动）。
- **wikilink**：remark 插件（自研 ~60 行）解析 `[[路径|别名]]` → 内链样式 + 点击打开（存在性检查：树数据判断，失效链红显）；backlinks 面板：对当前文件名跑 `grep_files` 结果列表，放 TOC 浮层第二页签。
- **标签**：正则扫当前文件 `#tag` 顶部展示 + 点击即 ⌘P 全文搜该前缀（零存储，零索引）。工作量合计 **L**（可拆）。

### B3（P1）版本历史（git 系）

- **入口**：中栏工具栏「历史」按钮（设置里默认关闭，首次开启提示将 `notes/` git init）。
- **流程**：历史浮层 = commit 列表（log API）→ 选中看与当前 diff（diff-view）→「恢复此版本」= 用旧内容走正常保存链路（产生新 commit，不 revert，安全克制）。**不做** stage/commit UI（保存时自动 `git add 该文件 && commit -m "save <path>"`，或仅快照语义）。远程 push/pull 不做（§7）。
- **复用**：workspace-api.ts:218-323 全套。工作量 **M~L**。

### B4（P1）设置补全：暗色/语言/provider 管理

- 暗色：`<html>` 加 class 切换语义变量集（CSS 已 token 化，成本在变量暗色值维护——quickforge-surface.css 若已含暗色变量则近乎免费）；语言：i18n 词条已全量，下拉即切；provider 管理：设置内列表 + 删除 + 设默认（编辑沿用 SetupDialog 表单复用）。工作量 **M**。

### B5（P1）快捷键补全 + 会话导出 + 清理死代码

- ⌘, 设置、⌘E 循环 read→split→edit、⌘W 关闭当前文件（回空态）；导出 = 会话消息转 Markdown 下载（Blob 下载，零依赖）；删 Markdown.tsx 孤儿、修 zhibi 注释、更新 README 已知限制。工作量 **M**。

### C 组（P2，一句设计）

- 模板：`templates/` 目录扫描，新建笔记时下拉选模板预填。
- 每日笔记：顶栏日历图标一键 `日记/YYYY-MM-DD.md`（存在即打开）。
- 回收站视图：树顶「回收站」入口 → 专属浮层（恢复/彻底删除/清空）。
- 整库导出：jszip（已有依赖）打包 notes/ 下载。
- 查找替换 ⌘F、消息编辑重发/重新生成、工具渲染卡补齐 5 类、快捷键帮助面板、窄屏单栏适配、vitest 纯函数测试、CodeMirror 6 评估。

---

## 6. 分期路线图

| 期 | 主题 | 内容 | 规模感 |
|---|---|---|---|
| 一 | **补最后一公里**（全部 P0） | A1-A10：选中高亮/右键菜单/回收站隐藏/预览分流+文档预览/未保存拦截/编辑器增强包/搜索导航/审批 diff/AI 插入笔记/会话重命名复制/面板持久化 | ~2 周 |
| 二 | **专业体验**（P1） | B1-B5：滚动同步+图片粘贴/TOC+KaTeX+双链反链+标签/版本历史/暗色+语言+provider 管理/快捷键补全+导出+清理 | ~3-4 周（可拆） |
| 三 | **看反馈再加**（P2） | C 组按需逐个评估，每项先过「删掉它损失什么」 | 不设排期 |

节奏理由：第一期全部是「把已有东西做完整」（7 套未接线能力中点亮 4 套 + 修 2 个实际 bug + 补 3 处基本盘交互），零新增依赖、风险低、用户感知强；第二期才开始造新能力，且每项都有克制形态（TOC 浮层而非第四栏、单向滚动同步、标签零索引、历史不 revert）。

---

## 7. 明确不做清单（克制的另一半）

| 不做 | 理由 |
|---|---|
| 插件/扩展系统 | 单机单人工具，无生态诉求；引插件 API = 引安全面 + 版本地狱 |
| 实时协作 / 多用户 | 与「本地文件 + 本地服务」架构根本冲突，等于重写 |
| 原生移动端 App | 浏览器访问本地服务已覆盖；P2 做窄屏适配足矣 |
| 图谱视图（Graph View） | d3 力导向图重、维护贵；backlinks 列表解决 90% 需求，克制 |
| 块级引用 / 数据库表格型笔记 | Notion 化方向；与「纯 md 文件 + AI 可直接读写」的定位相悖 |
| 所见即所得（WYSIWYG）编辑器 | 保持「md 源文 + 预览」心智模型——这与 AI 协作最匹配（AI 产出 md 源文），也避免 Tiptap 类重依赖 |
| git 远程同步 UI（push/pull/凭据） | 凭据管理风险大；用户有终端；本地历史已够 |
| 任意浮动多窗口（同项目多开） | 已按「一窗口一项目」实现多窗口：窗口经 `?project=` 绑定项目、状态按项目隔离；同项目再开=聚焦，避免重复编辑与状态复杂度。自由多开仍不做 |
| AI 全自动批量改写模式 | 写保护审批是本项目核心差异点，全自动会稀释它；保持「AI 提议、人批准」 |
| Monaco / 富文本框架 | 见 §1.3 决策表，不回头 |

---

## 附录 A：与专业笔记应用的域级对照（仅作参照，不追平）

| 域 | Obsidian | Typora/Bear | NoteFlow 现状 | 本方案后 |
|---|---|---|---|---|
| 编辑体验 | 编辑即预览 | 编辑即预览 | 源文+预览（弱编辑） | 增强后接近 Typora 八成高频场景 |
| 双链/标签 | 全量 | Bear 标签 | 无 | wikilink+backlinks+轻标签 |
| 搜索 | 强 | 中 | 双模式可用 | 键盘导航+高亮后达标 |
| 版本 | 插件 | 无 | 无（API 在） | 本地 git 历史 |
| AI | 插件 | 无 | **原生对话+写库+审批（领先）** | + diff 明批 + 回流闭环（继续领先） |
| 数据格式 | md | md | md（纯文件，零锁定） | 不变 |

## 附录 B：克制原则自检清单（每个新功能动工前过一遍）

1. quickforge 闭包里是否已有现成实现？（§4.9 先查）
2. 能否用 ≤150 行自研 + 现有依赖解决？
3. 删掉它，用户损失是否可感知？
4. 是否强化「写笔记 × AI 协作」主线？
5. 破坏性/不可逆？（必须可逆或可拒）
6. 是否在 §7 不做清单里？

## 附录 C：证据索引（★=本次会话工具复核；行号以 2026-09-28 15:00 时点为准，ChatPanel.tsx/surface.css 同期被外部更新过）

| 论断 | 证据 |
|---|---|
| ★ 选中高亮空实现 | src/components/workspace/WorkspaceFileTree.tsx:81 |
| ★ 裸 textarea 编辑器 | src/components/NoteEditor.tsx:441-450 |
| ★ 预览一律走 `<img>` | src/components/NoteEditor.tsx:452-461 |
| ★ html 属 browser-previewable | src/components/workspace/artifact-preview-utils.ts:57-63 |
| ★ 搜索 Enter 恒取第一条 | src/components/SearchPalette.tsx:87-93 |
| ★ 无会话重命名/导出 | shell grep 实测：api.ts:181-240 会话接口全量，title 仅创建时设（:181-185），无更新/导出端点；ChatPanel.tsx:301 列表已展示 title |
| git API 未接线 | src/components/workspace/workspace-api.ts:218-323 |
| diff-view 未接线 | src/lib/diff-view.ts（存在且无消费方） |
| KaTeX 仅聊天有 | src/components/chat/surface/Markdown.tsx:5-19 vs workspace/MarkdownReader.tsx |
| 未保存不拦截 | src/App.tsx:87-93（新建仅 setSelectedPath） |
| 面板状态不持久化 | src/App.tsx:26-29 |
| i18n 无切换入口 | src/lib/i18n.ts（词条全量）+ SettingsDialog.tsx 无语言项 |
| 审批卡仅 JSON | src/components/ChatPanel.tsx:362-383 |
| 工具渲染卡缺 5 类 | src/lib/tool-renderers/index.ts:3-4 注释 + surface-agent.ts:24-37 |
| 回收站仅前端 mv | src/components/NoteEditor.tsx:244-265；server.mjs 无相关逻辑 |
| 快照漂移无版本标记 | src/components/chat/surface/ 无 SNAPSHOT 类文件（find 验证） |
