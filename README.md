# NoteFlow

> 笔记 · 流动如水

三栏 AI 笔记应用：**左侧文件管理 · 中间文本阅读/编辑 · 右侧 AI 对话**。布局自有，文件读写、AI 模型、SSE 流式等基础能力全部复用 [QuickForge](https://www.npmjs.com/package/@shawnstack/quickforge)。

## 功能

**设计系统**：全局采用 quickforge 语义 token（背景/前景/边框/accent），三栏一套色系；弹窗（确认/输入）直接复用 quickforge 的 `showConfirm` / `showPrompt`（命令式，交互动画完全一致）。

**文件管理（左栏）**
- 文件树：**quickforge WorkspaceFileTree 组件**（懒加载分页、目录状态机重试、图片缩略图）
- 新建笔记（支持 `日记/今天.md` 自动建目录）、新建文件夹
- 当前文件操作（中栏工具栏）：重命名、移入回收站（`.trash/`，可恢复）
- **回收站管理**：`.trash/` 内条目右键「彻底删除（不可恢复）」，`.trash/` 目录右键「清空回收站」
- **拖拽移动**：把文件/文件夹拖到目录行（或空白处=根目录、`.trash/`=回收站），目标高亮，防同名覆盖
- 全局搜索 `⌘P`：文件名 / 全文内容双模式，↑↓ 键盘导航，Enter 直达

**阅读编辑（中栏）**
- **双链笔记**：`[[笔记名]]` / `[[目录/笔记名|别名]]` 语法——编辑器输入 `[[` 弹出补全（↑↓/Enter 插入），阅读模式渲染为链接点击直达；目标不存在时琥珀色虚线样式，点击确认即创建
- **反向链接**：阅读区底部自动列出引用当前笔记的其它笔记（含上下文行），点击跳转
- **大纲导航**：工具栏 ListTree 按钮展开 H1–H3 大纲侧栏，点击平滑滚动定位
- **多笔记标签页**：中栏顶部标签栏同时打开多篇笔记，未保存圆点标记，`⌘W`/中键/× 关闭，重启自动恢复（最多 12 个）
- 三种模式：阅读（**quickforge MarkdownReader**，与聊天同源渲染）/ 编辑 / 分屏
- 代码/非 md 文件阅读：聊天同款 CodeBlock（52 色高亮）；图片直接预览
- Markdown 工具栏：标题、粗体、斜体、代码、引用、列表、链接、双链、代码块、表格
- **粘贴/拖入图片**：直接 `⌘V` 截图或拖图片进编辑器，自动存 `assets/<年-月>/` 并插入相对链接（阅读模式直接显示）
- **选中文字 → AI**：编辑器选中一段文字出现浮动菜单（润色/翻译/解释/扩写），一键发送到右侧对话；**回复完成后顶部提示条支持一键替换回原选区或插入光标处**
- **每日笔记**：顶栏「今日」按钮或 `⌘D` 打开 `日记/YYYY-MM-DD.md`（不存在则按模板创建）
- **版本历史**：中栏时钟图标，`notes/` 为独立 git 仓库，保存/AI 修改/文件移动后自动 commit；历史面板查看任意版本 diff、一键回滚
- `⌘S` 保存；中文场景字数统计
- 崩溃草稿保护（localStorage 自动暂存，重开可恢复；切换标签即时落盘）
- 外部变更检测：AI 或外部程序修改了当前笔记时自动重载或提示（与 AI 协作的关键保障）

**AI 对话（右栏）**
- **聊天渲染层直接复用 quickforge 源码**（`src/components/chat/surface/` + lib 闭包 + CSS 抽取，快照式复制）：
  - 思考块折叠（reasoning 流式可见）、工具消息卡（参数/结果详情折叠）
  - 自研代码高亮（52 色 token）+ 复制按钮、Mermaid 图表、KaTeX 公式
  - 附件支持：粘贴/拖放图片、PDF / Word / Excel / zip 文档预览全家桶
  - UsageBar token 用量、长对话窗口化虚拟滚动、生产级输入框交互
- 适配层 `src/lib/surface-agent.ts`：把 QuickForge HTTP/SSE 客户端包装成 pi-agent-core `Agent` 表面喂给 `ChatSurface`
- 多会话管理（列表/切换/删除）、模型即时切换（provider 分组下拉）
- **写保护开关**（盾牌图标）：AI 修改笔记前弹审批卡，需你批准
- 附带当前笔记上下文（回形针图标开关）

**交互基础**
- 三栏拖拽调宽、左右栏可折叠
- Toast 操作反馈、破坏性操作确认弹窗、全局错误边界
- 快捷键：`⌘P` 搜索 · `⌘N` 新建笔记 · `⌘D` 今日日记 · `⌘S` 保存 · `⌘W` 关闭标签 · `Esc` 关闭弹层

**命令运行（与 quickforge 同协议）**
- 聊天中 AI 回复的 shell 代码块：▶ 按钮直接运行（quickforge 原版 CodeBlock 内置）
- 中栏笔记的 shell 代码块：代码块标题栏「▶ 运行」按钮
- 多行命令/危险命令（rm -rf、sudo、git push 等）先弹确认
- 输出面板显示 stdout/stderr/退出码（经 QuickForge run_command 工具执行，工作目录为 notes/）

**设置（顶栏齿轮）**
- 默认模型（新对话生效）+ 服务商配置入口
- 对话偏好：默认写保护、默认附带当前笔记
- 外观：消息字号（14–17，实时生效）
- 关于：版本、笔记目录、数据目录

## 布局

```
┌────────────────────────────────────────────────────────────┐
│  NoteFlow              [笔记项目]                           │
├──────────┬──────────────────────────┬──────────────────────┤
│          │                          │                      │
│  文件树   │   阅读 / 编辑 / 分屏       │   AI 对话            │
│  (笔记)   │   Markdown 渲染          │   · 流式回复          │
│          │   Ctrl+S 保存            │   · 引用当前笔记       │
│  + 新建   │                          │   · 工具调用可见       │
│  + 刷新   │                          │   · 模型配置          │
│          │                          │                      │
└──────────┴──────────────────────────┴──────────────────────┘
     │                │                        │
     ▼                ▼                        ▼
  /api/workspace/*   /api/projects/:id/tools   /api/agents/* (SSE)
                     └──────────┬─────────────┘
                                ▼
                    QuickForge 服务（@shawnstack/quickforge）
                    专属实例 · 端口 5178 · 数据目录 ~/.noteflow
```

## 快速开始

```bash
npm install
npm run dev        # Web 开发：vite(5179) + QuickForge 服务(5178)
npm run dev:electron  # Electron 开发：vite + Electron 窗口（inline QuickForge）
```

生产模式（Web / Node 包）：

```bash
npm run build
npm start          # http://127.0.0.1:5179 （三栏 UI 静态托管 + /api 反代）
```

Electron 桌面端：

```bash
npm run electron:start   # 直接以 Electron 运行（复用 dist）
npm run electron:build   # 打包 dmg（release/NoteFlow-<版本>-arm64.dmg，mac arm64）
```

模型配置存于 `~/.noteflow`（与桌面版 `~/.quickforge` 完全隔离，互不干扰），
可在应用内「模型设置」添加（任一 OpenAI 兼容服务商）。

## Electron 桌面端（v0.5）

> 打包完整流程（环境搭建、配置原理、踩坑记录）见 **[docs/electron-packaging.md](docs/electron-packaging.md)**。

同一套代码，两种宿主，后端逻辑完全共用（`server-core.mjs`）：

| | Web / Node 包（`npm start`） | Electron（`electron:build`） |
|---|---|---|
| QuickForge 启动方式 | spawn 独立子进程 | **inline 运行于 Electron 主进程** |
| 静态服务 | `server.mjs` | 同一份 `server-core.mjs`，同进程 |
| 前端加载 | 浏览器访问 5179 | `BrowserWindow.loadURL` 加载 127.0.0.1 |
| 退出方式 | Ctrl+C / SIGTERM 优雅停止 | 关窗即停（sqlite flush 后退出） |

要点：

- **为何 inline**：quickforge 的 `startQuickForge` 内部是
  `spawn(process.execPath, [...])` 且会删掉 `ELECTRON_RUN_AS_NODE`——在 Electron
  主进程里直接调用会拉起又一个 GUI 实例。`startQuickForge({ inline: true })`
  官方支持在当前进程内启动（依赖 Node 内置 `node:sqlite`，无原生 ABI 问题；
  Electron 44 内置 Node 24 ≥ 22.19 满足要求）。
- **attach 复用**：Electron 启动时先探测 `127.0.0.1:5179/api/noteflow/health`，
  发现是已在运行的 NoteFlow 服务（如 `npm start` 开着）就直接连上去，
  不会起第二个 QuickForge 实例争用 `~/.noteflow` 的 sqlite。
- **打包**：electron-builder，`asar: false`（主进程要按磁盘路径 dynamic import
  `server-core.mjs` 与 quickforge，含 vendor prebuilds）；生产依赖只保留
  `@shawnstack/quickforge`（前端库全部由 vite 打进 dist bundle，放 devDependencies
  以缩小包体）。产物 ~150MB dmg。
- 未签名/未公证：首次打开 dmg 拖出的 App 若被 Gatekeeper 拦截，右键 → 打开。
- `dev:electron` 与 `dev` 不要同时开（都要独占 5178 的 QuickForge 实例）；
  如需并存可用 `NOTEFLOW_DEV_PORT` / `NOTEFLOW_QF_PORT` 改端口。

## 工作方式

- `server.mjs` 通过 QuickForge 的 `public-api`（`startQuickForge`）启动一个**专属服务实例**
  （独立数据目录、强制新进程，不复用正在运行的 QuickForge），随后：
  1. 设置 `agent-access-mode=full-access`（允许前端直调 `write_file` 工具保存笔记）；
  2. 注册并激活 `notes/` 目录为工作区项目。
- `POST /api/noteflow/asset`（NoteFlow 自有端点）：编辑器粘贴图片的二进制落盘
  （quickforge 的 `write_file` 只收 UTF-8 文本）；生产由 `server.mjs` 处理，开发由 `vite.config.ts` 的 middleware 处理（共用 `asset-endpoint.mjs`）。
- **版本历史**：`notes/` 是独立 git 仓库（首启自动 `git init`，`.trash/` 已排除），
  外层代码仓库已通过 `.gitignore` 忽略 `notes/`；保存 / AI 回复结束 / 文件移动后防抖自动 commit
  （1.5s 合并），全部经 quickforge `run_command` 执行。
- 前端所有请求走相对路径 `/api`：dev 由 vite 代理转发，生产由 `server.mjs` 反向代理（SSE 不缓冲、不超时）。
- 文件树：`GET /api/workspace/children`（游标分页）。
- 读取：`GET /api/workspace/file`；保存：`POST /api/projects/:id/tools/write_file`（自动创建父目录）。
- 对话：客户端生成 sessionId → `POST /api/agents/:id` 创建 → `EventSource /api/agents/events` 全局流按
  sessionId 过滤 → `POST /api/agents/:id/prompt` 发消息，流式渲染于右侧面板。
- 「附带当前笔记」开关：发送时把当前打开的笔记内容（截断 8000 字符）注入消息上下文。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NOTEFLOW_HOST` | `127.0.0.1` | 静态服务监听地址（设 `0.0.0.0` 可供局域网访问） |
| `NOTEFLOW_PORT` | `5179` | NoteFlow 对外端口（生产模式，`0` 为随机） |
| `NOTEFLOW_QF_PORT` | `5178` | QuickForge 服务端口 |
| `NOTEFLOW_DATA_DIR` | `~/.noteflow` | 数据目录（模型配置、会话记录） |
| `NOTEFLOW_NOTES_DIR` | `<项目>/notes` | 笔记目录 |
| `NOTEFLOW_DEV_PORT` | `5179` | `dev:electron` 的 vite 端口 |

## 已知限制（v1.4）

- 聊天渲染层为 quickforge 源码**快照**（复制时的版本），quickforge 升级后需手动同步。
- goal/todo/ask-user/subagent/generate-image 五类工具的专属渲染卡未搬（回落默认渲染，不影响使用）。
- 双链的 `[[` 补全弹层位置按等宽字体估算光标坐标（分屏/极端行宽下可能有少量偏移）。
- 版本历史基于 git log（单文件 200 条上限）；`run_command` 输出预览限 200 行。
