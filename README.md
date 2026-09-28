# NoteFlow

> 笔记 · 流动如水

三栏 AI 笔记应用：**左侧文件管理 · 中间文本阅读/编辑 · 右侧 AI 对话**。布局自有，文件读写、AI 模型、SSE 流式等基础能力全部复用 [QuickForge](https://www.npmjs.com/package/@shawnstack/quickforge)。

## 功能

**设计系统**：全局采用 quickforge 语义 token（背景/前景/边框/accent），三栏一套色系；弹窗（确认/输入）直接复用 quickforge 的 `showConfirm` / `showPrompt`（命令式，交互动画完全一致）。

**文件管理（左栏）**
- 文件树：**quickforge WorkspaceFileTree 组件**（懒加载分页、目录状态机重试、图片缩略图）
- 新建笔记（支持 `日记/今天.md` 自动建目录）、新建文件夹
- 当前文件操作（中栏工具栏）：重命名、移入回收站（`.trash/`，可恢复）
- 全局搜索 `⌘P`：文件名 / 全文内容双模式，Enter 直达

**阅读编辑（中栏）**
- 三种模式：阅读（**quickforge MarkdownReader**，与聊天同源渲染）/ 编辑 / 分屏
- 代码/非 md 文件阅读：聊天同款 CodeBlock（52 色高亮）；图片直接预览
- Markdown 工具栏：标题、粗体、斜体、代码、引用、列表、链接、代码块、表格
- `⌘S` 保存；中文场景字数统计
- 崩溃草稿保护（localStorage 自动暂存，重开可恢复）
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
- 快捷键：`⌘P` 搜索 · `⌘N` 新建笔记 · `⌘S` 保存 · `Esc` 关闭弹层

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
npm run dev        # 开发：vite(5179) + QuickForge 服务(5178)
```

生产模式：

```bash
npm run build
npm start          # http://127.0.0.1:5179 （三栏 UI 静态托管 + /api 反代）
```

模型配置：模型 provider / API key / 默认模型已从桌面版 QuickForge 迁移
（存于 `~/.noteflow`，与桌面版 `~/.quickforge` 完全隔离，互不干扰）。
新配置可在应用内「模型设置」完成（任一 OpenAI 兼容服务商）。

## 工作方式

- `server.mjs` 通过 QuickForge 的 `public-api`（`startQuickForge`）启动一个**专属服务实例**
  （独立数据目录、强制新进程，不复用正在运行的 QuickForge），随后：
  1. 设置 `agent-access-mode=full-access`（允许前端直调 `write_file` 工具保存笔记）；
  2. 注册并激活 `notes/` 目录为工作区项目。
- 前端所有请求走相对路径 `/api`：dev 由 vite 代理转发，生产由 `server.mjs` 反向代理（SSE 不缓冲、不超时）。
- 文件树：`GET /api/workspace/children`（游标分页）。
- 读取：`GET /api/workspace/file`；保存：`POST /api/projects/:id/tools/write_file`（自动创建父目录）。
- 对话：客户端生成 sessionId → `POST /api/agents/:id` 创建 → `EventSource /api/agents/events` 全局流按
  sessionId 过滤 → `POST /api/agents/:id/prompt` 发消息，流式渲染于右侧面板。
- 「附带当前笔记」开关：发送时把当前打开的笔记内容（截断 8000 字符）注入消息上下文。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NOTEFLOW_PORT` | `5179` | NoteFlow 对外端口（生产模式） |
| `NOTEFLOW_QF_PORT` | `5178` | QuickForge 服务端口 |
| `NOTEFLOW_DATA_DIR` | `~/.noteflow` | 数据目录（模型配置、会话记录） |
| `NOTEFLOW_NOTES_DIR` | `<项目>/notes` | 笔记目录 |

## 从桌面版 QuickForge 迁移模型配置

```bash
python3 - <<'PY'
import json, os
src = os.path.expanduser('~/.quickforge/config')
dst = os.path.expanduser('~/.noteflow/config')
sp, dp = json.load(open(f'{src}/providers.json')), json.load(open(f'{dst}/providers.json'))
dp['customProviders'].update(sp.get('customProviders', {}))
dp['providerKeys'].update(sp.get('providerKeys', {}))
json.dump(dp, open(f'{dst}/providers.json', 'w'), ensure_ascii=False, indent=2)
ss, ds = json.load(open(f'{src}/settings.json')), json.load(open(f'{dst}/settings.json'))
for k in ['active-model', 'default-options', 'language']:
    if k in ss: ds[k] = ss[k]
json.dump(ds, open(f'{dst}/settings.json', 'w'), ensure_ascii=False, indent=2)
print('done')
PY
```

（注意：只迁模型相关配置，不迁 hooks——桌面版的 build/ntfy hook 绑定的是 quickforge 项目和它自己的 sqlite，迁过来会错乱。）

## 已知限制（v1.2）

- 聊天渲染层为 quickforge 源码**快照**（复制时的版本），quickforge 升级后需手动同步。
- goal/todo/ask-user/subagent/generate-image 五类工具的专属渲染卡未搬（回落默认渲染，不影响使用）。
- 回收站内文件不支持彻底删除（进 `.trash/` 后可恢复，需彻底清除可让 AI 执行 `rm`）。
