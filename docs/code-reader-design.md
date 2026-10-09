# 中栏智能识别与代码阅读体验 · 设计方案

> 目标：非 md 文件（代码为主）获得与 markdown 同级的阅读体验；文件类型智能识别；中栏按钮/工具栏按类型自适应。
> 基线：NoteFlow 0.4.0，2026-09-29。相关既有结论见 `docs/DESIGN.md` §4.3 / §A3、`docs/noteflow-gap-design.md`。

## 1. 现状问题

| 问题 | 位置 |
|---|---|
| 非 md 文件复用聊天 `CodeBlock`：无行号、`max-h-96` 限高（阅读长文件体验差） | `MarkdownReader.tsx:156` |
| `html` 被判为图片塞 `<img>`（显示裂图） | `NoteEditor.tsx:862-882`，`isBrowserPreviewablePath` 含 `.html` |
| `pdf/docx/xlsx` 走 UTF-8 文本接口 → 乱码 | 同上，无 document 分支 |
| 已有三分流函数 `artifactPreviewMode()` 未接线 | `artifact-preview-utils.ts:65-70` |
| 识别逻辑重复两处，`.mdx` 判定不一致（`isMarkdown` 不含 mdx，`inferArtifactKind` 判 mdx 为 markdown） | `artifact-preview-utils.ts` vs `lib/tool-artifacts.ts` / `NoteEditor.tsx:1048` |
| 按钮恒定：代码文件也显示 md 格式化工具栏（H1/粗体/双链）；图片/pdf 显示"编辑/分屏/保存"；统计恒为"N 字" | `NoteEditor.tsx:650-737` |
| 无扩展名脚本（如 `bin/run`）、未知二进制无法识别，二进制照读乱码 | 无内容嗅探 |

## 2. 智能识别：分层检测（单一来源）

```
detectFileKind(path, content?)
├─ L1 扩展名 → kind        （合并现有 inferArtifactKind，扩表）
├─ L2 特殊文件名             （dockerfile/makefile/.gitignore… → code）
└─ L3 内容嗅探（仅 L1 未命中时）
   ├─ 首行 #!shebang → 解析解释器 → code + language
   ├─ 前 8KB 含 \u0000 → binary
   └─ 其余 → code(plaintext)
```

统一输出 `FileKind`：`markdown | code | image | html | pdf | docx | excel | binary`，附带 `language`（后端 `data.language` 优先，嗅探补充）。

落点：新建 `src/lib/file-kind.ts` 纯函数，`artifact-preview-utils.ts` 与 `tool-artifacts.ts` 改为复用它；二进制判定在前端做（内容已在手，`\u0000` 检查零成本），不改 node_modules 里的 quickforge 后端。

**方案对比**

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 前端扩展名+内容嗅探 | 零后端改动、内容已在手 | 规则需自己维护 | ✅ 采用 |
| B. 后端加 binary 标志 | 权威 | quickforge 在 node_modules 不可改；fs-endpoint 加接口多一跳 | ✗ |
| C. 仅扩展名 | 最简单 | 无扩展名脚本/未知二进制识别不了 | ✗ |

## 3. 中栏渲染分发（接线 artifactPreviewMode）

```
markdown → MarkdownReader(preview)          现状保留
code     → CodeReader（新组件，§4）
image    → <img>（现状）+ 缩放工具
html     → 沙箱 <iframe sandbox src=previewUrl>（禁脚本；沙箱内相对资源经 previewUrl 域可加载）
pdf/docx/xlsx → DocumentReader（复用聊天附件 pdfjs / docx-preview / xlsx 管线，
                 由"内存 ArrayBuffer"改为 fetch(previewUrl) 取二进制；白名单已含这三类）
binary   → 信息卡（大小/mtime/「二进制文件不支持预览」+ 下载链接）
```

依赖均已安装（pdfjs-dist / docx-preview / xlsx），不新增包。docx 渲染后的 XSS 净化函数从 `AttachmentPreview.tsx` 抽出共享。

## 4. CodeReader（新组件，不动聊天 CodeBlock）

复用自研 `src/lib/code-highlight.ts`（52 色、零依赖），聊天 CodeBlock 保持不动。

功能：
- 行号槽（与内容同步滚动）
- 顶部：语言徽标 + `N 行` 统计；操作：复制全文、自动换行开关
- 符号大纲：正则提取 `function/class/def/interface/const =` 等符号（ts/js/py/go/java/c/sql/sh… 常用语言），复用现有大纲侧栏 UI，点击滚动定位
- 大文件降级：>300KB 跳过高亮直接纯文本（避免整文件 tokenize 卡顿）；虚拟滚动列 P2
- 容器自然高度撑满中栏（去掉 max-h-96）

**高亮方案对比**

| 方案 | 质量 | 成本 | 结论 |
|---|---|---|---|
| A. 沿用自研 code-highlight | 良（52 色，语言覆盖有限） | 零新依赖，聊天已验证 | ✅ 采用，覆盖不足按需补规则 |
| B. Shiki | VSCode 级（TextMate） | 体积大、需懒加载 chunk、重写渲染路径 | P2 再评估 |
| C. highlight.js（已装） | 中 | 与自研双栈重复维护 | ✗ |

## 5. 代码编辑（Edit 模式）

- 保留 `textarea` 纯文本编辑（保存走 UTF-8 文本接口，天然支持）
- 轻量增强：Tab/Shift+Tab 缩进、Enter 保持缩进续行、等宽字体确认
- CodeMirror 6（语法高亮编辑、体验最好）重依赖，列 P2 可选

## 6. 按钮自适应矩阵（核心调整）

| kind | 阅读 | 编辑 | 分屏 | 大纲 | 工具栏（编辑区下方） | 统计文案 | 保存 |
|---|---|---|---|---|---|---|---|
| markdown | ✓ 预览 | ✓ | ✓ | 标题树 | md 格式化（现状） | N 字 | ✓ |
| code | ✓ 源码 | ✓ | ✓ 源码\|源码 | **符号树** | **代码工具栏**：复制/换行/语言徽标 | **N 行 · 语言** | ✓ |
| image | ✓ | 隐藏 | 隐藏 | 隐藏 | 图片工具栏：放大/缩小/适应/100% | 文件大小 | 隐藏 |
| html | ✓ iframe 渲染 | ✓ 源码 | ✓ 预览\|源码 | 隐藏 | 无 | N 行 | ✓ |
| pdf/docx | ✓ 文档 | 隐藏 | 隐藏 | 隐藏（xlsx 显示 sheet 签） | 无 | 页数/sheet 数 | 隐藏 |
| binary | 信息卡 | 隐藏 | 隐藏 | 隐藏 | 无 | 大小 | 隐藏 |

- 通用保留：重命名 / 回收站 / 恢复 / 版本历史
- 打开新文件时默认模式按 kind：image/pdf/docx/binary 直接锁定阅读；markdown/code 沿用当前模式
- 编辑类按钮用"隐藏"而非禁用，避免对不可编辑类型的误导

## 7. 实施分期

| 阶段 | 内容 |
|---|---|
| **P0** | 统一识别 `file-kind.ts`（含嗅探）；NoteEditor 分发接线（修 html/pdf/docx/xlsx/binary 分支）；按钮自适应矩阵；CodeReader 基础（行号/复制/换行/统计/大文件降级） |
| **P1** | 符号大纲；pdf/docx/xlsx DocumentReader 接线；html 沙箱 iframe；`.mdx` 归一（建议暂归 code 源码，react-markdown skipHtml 无法渲染 JSX） |
| **P2** | 代码内搜索/折叠、虚拟滚动、Shiki 评估、CodeMirror 6 编辑 |

验证：`npm run typecheck` + `npm run build`（项目无测试框架）。

## 8. 待确认决策点

1. 本次范围：仅 P0，还是 P0+P1（文档预览一并接线）？
2. 高亮：自研（推荐）vs 引入 Shiki？
3. html 阅读模式：禁脚本沙箱（安全，推荐）vs 允许脚本？
4. `.mdx` 归类：markdown（接受 JSX 部分渲染不完美）vs code（保守源码视图，推荐）？
