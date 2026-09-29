# NoteFlow Electron 打包指南

> 记录 v0.5（2026-09-29）首次打包的完整过程，含环境搭建、配置原理与踩坑。
> 换新机器或重新打包时照本文操作即可。

## 1. 产物与工具链

| 项 | 值 |
|---|---|
| 目标平台 | macOS Apple Silicon（arm64） |
| 打包工具 | electron-builder 26.15.3 |
| Electron | 44.4.5（内置 Node 24.21.0） |
| 产物 | `release/NoteFlow-<版本>-arm64.dmg`（约 149MB）+ `release/mac-arm64/NoteFlow.app` |
| 打包配置 | 项目根 `electron-builder.yml` |

一条命令完成打包（前端构建 + electron-builder）：

```bash
npm run electron:build
```

## 2. 首次环境搭建

### 2.1 安装依赖

```bash
# Electron 二进制走 npmmirror 镜像（GitHub 直连不通）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  npm install -D electron electron-builder
```

### 2.2 坑①：npm 11 拦截 electron 的 postinstall

npm 11 默认拦截带 install script 的包，electron 装完后**二进制并没有下载**
（执行 `npx electron --version` 会显示 `Downloading Electron binary...` 然后卡住）。

处理两步：

```bash
# 1) 批准 electron 的 install script（写入 package.json 的 allowScripts）
npm install-scripts approve electron

# 2) 手动触发二进制下载（仍需镜像变量）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

验证：

```bash
npx electron --version          # 应输出 v44.4.5
ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(process.versions.node)"
                               # 应输出 24.21.0（≥22.19，node:sqlite 可用）
```

### 2.3 验证内置 Node 版本（重要前置检查）

quickforge（NoteFlow 的服务端）依赖 Node 内置的 `node:sqlite`，要求 Node ≥ 22.19。
Electron 内置的 Node 版本与系统 Node 无关，升级 Electron 版本后务必重新验证：

```bash
ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(process.versions.node)"
```

| Electron | 内置 Node | 可用性 |
|---|---|---|
| 38 | 22.18 | ❌ 低于 22.19 |
| **44.4.5（当前）** | **24.21.0** | ✅ |

## 3. 打包配置说明（electron-builder.yml）

```yaml
appId: app.noteflow.desktop
productName: NoteFlow
directories:
  output: release          # 产物输出目录（已 gitignore）
  buildResources: build    # 图标等资源（源文件 build/icon.svg，与 web favicon 同设计）
files:                     # 进包内容（其余不进，见 §3.2 依赖归位）
  - electron/**
  - server-core.mjs
  - asset-endpoint.mjs
  - dist/**
  - package.json
asar: false                # 关键，见 §3.1
mac:
  category: public.app-category.productivity
  icon: build/icon.icns    # 824/1024 留白 squircle（icon-mac.svg 生成）
  target:
    - target: dmg
      arch: [arm64]
win:
  icon: build/icon.ico     # 16-256 七档；mac 交叉打包 NSIS 需 wine
linux:
  category: Office
  icon: build/icons        # hicolor 16-512 九档
electronDownload:
  mirror: https://npmmirror.com/mirrors/electron/   # 打包机重下 Electron 时的镜像
```

图标源与重生成：`build/icon.svg`（全出血，与 web favicon 同设计）+ `build/icon-mac.svg`（Apple 留白版），改完后执行 `bash build/gen-icons.sh` 一键重生成 icon.png / icon.icns / icon.ico / icons/。

### 3.1 为什么 `asar: false`

Electron 主进程（`electron/main.mjs`）需要 **dynamic import 磁盘真实路径**：

- `server-core.mjs` → `@shawnstack/quickforge`；
- quickforge 内部还会按文件路径读取 `vendor/node-pty/prebuilds/darwin-arm64/*.node`。

asar 虚拟文件系统对这类"跨进程/原生模块按路径读取"不友好，本地工具不在乎体积，
直接关闭 asar 最省心。electron-builder 会警告 `asar usage is disabled — strongly
not recommended`，可忽略。

### 3.2 依赖归位（控制包体）

**package.json 生产依赖只保留 `@shawnstack/quickforge` 一个**，其余 17 个
（react、mermaid、pdfjs-dist、katex、xlsx……）全部挪到 devDependencies：

- 前端库由 vite 构建时打进 `dist/` bundle，运行时不需要 node_modules；
- electron-builder 按**生产依赖树**收集 node_modules，挪走后包内只剩
  quickforge 依赖链（约 146 个包），dmg 从 ~300MB 降到 149MB；
- `@earendil-works/pi-agent-core` / `pi-ai` 前端要用，但 quickforge 自身也依赖
  它们，会随其依赖树自动进包，无需重复声明。

## 4. 运行架构（打包产物如何工作）

```
NoteFlow.app
└─ Electron 主进程 (electron/main.mjs)
   ├─ 单实例锁 requestSingleInstanceLock
   ├─ 探测 127.0.0.1:5179/api/noteflow/health
   │   ├─ 是 NoteFlow → attach 复用（npm start 开着时不再起第二个实例）
   │   └─ 否 → startNoteFlow({ inline: true })
   │        ├─ startQuickForge({ inline: true })   ← QuickForge 跑在主进程内
   │        └─ 静态服务（dist + /api 反代 + asset 端点）
   └─ BrowserWindow.loadURL(http://127.0.0.1:5179)
```

**为什么必须 inline**：quickforge 的 `startQuickForge` 默认分支是
`spawn(process.execPath, [...])` 且删除 `ELECTRON_RUN_AS_NODE` 环境变量——在
Electron 主进程里调用会拉起又一个 Electron GUI 实例（死路）。`inline: true`
是官方提供的进程内启动路径。可行性前提（已验证）：

- quickforge 的 sqlite 用 **`node:sqlite`**（Node 内置 `DatabaseSync`），无原生
  ABI 兼容问题（没有 better-sqlite3）；
- 唯一原生依赖 node-pty 自带 `darwin-arm64` prebuild（N-API），按需加载。

## 5. 打包后验证（冒烟）

不要直接双击 .app 测试（会和正在运行的实例抢端口/数据目录）。命令行带环境变量
启动，用临时数据目录：

```bash
NOTEFLOW_PORT=5292 NOTEFLOW_QF_PORT=5293 \
NOTEFLOW_DATA_DIR=/tmp/nf-smoke/data NOTEFLOW_NOTES_DIR=/tmp/nf-smoke/notes \
  "release/mac-arm64/NoteFlow.app/Contents/MacOS/NoteFlow"
```

检查点：

```bash
curl -s http://127.0.0.1:5292/api/noteflow/health
# {"ok":true,"app":"noteflow","pid":4871,"qfPid":4871}
#                                            ^^^^^ 关键：qfPid == pid 证明 quickforge 在 Electron 进程内（inline）

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5292/   # 200 首页
curl -s http://127.0.0.1:5292/api/health                            # quickforge 反代正常
```

优雅退出验证：`kill -TERM <pid>`，日志应出现 `SQLite storage closed`，且
`pgrep -f NoteFlow.app` 无残留、端口释放。

## 6. 常见问题

### 6.1 Gatekeeper 拦截（未签名）

产物未签名未公证。首次打开从 dmg 拖出的 App 若被拦：**右键 App → 打开**。
System Settings → Privacy & Security 里点"仍要打开"也可以。

### 6.2 electron-builder 下载辅助二进制卡住

打包时 electron-builder 还会下载 dmg 构建器等辅助二进制（默认走 GitHub），
必须带镜像变量：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npm run electron:build
```

### 6.3 quickforge 管理 API 503（migrating）

`/api/health` 只探进程存活，sqlite migration 完成前就返回 200，紧接着调
管理 API 会得到 `503 {"maintenance":true,"state":"migrating"}`。inline 模式
必现此竞态。已修复：`server-core.mjs` 的 `apiWithRetry` 对 503+maintenance
自动重试（500ms 间隔，上限 60s）。若换 quickforge 版本后复现，先查这段。

### 6.4 Electron 启动报错弹窗后进程不退、再起被锁

错误对话框 `await showMessageBox` 会等用户点击，后台/自动化场景无人点击 →
进程卡住 → 持有单实例锁 → 后续启动全部被挡。已修复：main.mjs 对话框不
await + 10s 兜底 `app.exit(1)`。排障时可用 `pgrep -f "MacOS/Electron"` 找残留。

### 6.5 dev 与 dev:electron 不能同时开

两者都要独占 5178 的 NoteFlow 专属 QuickForge 实例（数据目录 `~/.noteflow`
的 sqlite 不宜双实例并发写）。需要并存时用端口隔离：

```bash
NOTEFLOW_DEV_PORT=5599 NOTEFLOW_QF_PORT=5598 ... npm run dev:electron
```

## 7. 版本升级流程

1. `package.json` 改 `version`（产物文件名带版本号）；
2. 升级 electron / quickforge 后重跑 §2.3 的内置 Node 版本检查；
3. `ELECTRON_BUILDER_BINARIES_MIRROR=... npm run electron:build`；
4. 按 §5 冒烟（重点确认 `qfPid == pid` 与 sqlite 正常关闭）。
