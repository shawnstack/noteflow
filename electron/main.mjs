/**
 * NoteFlow Electron 主进程
 *
 * 架构（inline 模式）：QuickForge 服务 + 静态服务全部运行于本进程。
 *  - quickforge 的 startQuickForge({ inline: true }) 支持进程内启动，
 *    绕开其内部 spawn(process.execPath) 在 Electron 下会拉起 GUI 实例的问题；
 *  - quickforge 依赖 node:sqlite（Node 内置），无原生 ABI 兼容问题
 *    （Electron 44 内置 Node 24 ≥ 22.19）；
 *  - 前端页面通过 loadURL 加载本进程静态服务（127.0.0.1），
 *    与 Web 模式（npm start）完全同一套后端代码（server-core.mjs）。
 *
 * 启动分支：
 *  1. 开发模式（VITE_DEV_SERVER_URL 由 scripts/dev-electron.mjs 注入）：
 *     仅 inline 起 QuickForge（5178），静态与 asset 端点由 vite 提供；
 *  2. 生产模式：先探测同机已运行的 NoteFlow 服务（npm start 场景），
 *     存在则直接 attach 复用（避免两个 QuickForge 实例争用 ~/.noteflow 的 sqlite），
 *     否则本进程内启动全套服务；端口被占时降级为随机端口。
 */
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEV_URL = process.env.VITE_DEV_SERVER_URL || ''
const PORT = Number(process.env.NOTEFLOW_PORT || 5179)

let nf = null // startNoteFlow() 的返回值
let attached = false // true = 复用了外部已运行的服务（npm start），退出时不负责停服务
let quitting = false

/** 项目 → 窗口映射（一窗口一项目：同项目再开窗口 = 聚焦已有窗口） */
const projectWindows = new Map()
let lastFocusedWindow = null
let tray = null // 系统托盘（常驻引用，防 GC 回收）

const log = (tag, msg = '') => console.log(`[noteflow-electron] ${tag}${msg ? ` ${msg}` : ''}`)

async function importServerCore() {
  return import(pathToFileURL(join(ROOT, 'server-core.mjs')).href)
}

/** 探测 127.0.0.1:port 是否已有 NoteFlow 自己的服务在跑 */
async function probeNoteflow(port) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`http://127.0.0.1:${port}/api/noteflow/health`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (data?.ok === true && data?.app === 'noteflow') {
      return { url: `http://127.0.0.1:${port}` }
    }
    return null
  } catch {
    return null
  }
}

async function startBackend() {
  const { startNoteFlow } = await importServerCore()

  if (DEV_URL) {
    log('开发模式', `静态资源由 vite 提供: ${DEV_URL}`)
    nf = await startNoteFlow({ inline: true, serveStatic: false })
    return
  }

  const existing = await probeNoteflow(PORT)
  if (existing) {
    attached = true
    log('复用已运行的服务', existing.url)
    return
  }

  try {
    nf = await startNoteFlow({ inline: true, serveStatic: true, port: PORT })
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      log('警告', `端口 ${PORT} 被其他程序占用，改用随机端口`)
      nf = await startNoteFlow({ inline: true, serveStatic: true, port: 0 })
    } else {
      throw err
    }
  }
}

function buildMenu() {
  // mac 必须有应用菜单（Cmd+Q / 复制粘贴快捷键都来自菜单）；role 菜单自带全部默认行为
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow({ projectId } = {}) {
  // 一窗口一项目：该项目已有窗口则聚焦，不再新建
  if (projectId && projectWindows.has(projectId)) {
    const existing = projectWindows.get(projectId)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return existing
    }
    projectWindows.delete(projectId)
  }

  const w = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 680,
    minHeight: 460,
    backgroundColor: '#09090b',
    title: 'NoteFlow',
    // Windows 隐藏系统标题栏与按钮，最小化/最大化/关闭由前端自绘（顶栏最右），
    // 样式与应用完全一致，顶栏空白区即拖拽区。
    ...(process.platform === 'win32' ? { frame: false } : {}),
    // 任务栏/窗口图标（win/linux 开发模式有意义；mac 由 icns 接管，生产由打包注入）
    ...(existsSync(join(ROOT, 'build/icon.png')) ? { icon: join(ROOT, 'build/icon.png') } : {}),
    show: false,
    webPreferences: {
      // 必须 .cjs：沙箱渲染进程的 preload 不支持 ESM
      preload: join(__dirname, 'preload.cjs'),
      // 纯 web 页面加载，不注入 node；contextIsolation/sandbox 保持默认开启
    },
  })

  if (projectId) projectWindows.set(projectId, w)

  w.once('ready-to-show', () => w.show())
  w.on('focus', () => {
    lastFocusedWindow = w
  })

  // 自绘窗口按钮：同步最大化状态给前端（图标在“最大化/还原”间切换）
  const sendMaximized = () => {
    if (!w.isDestroyed()) w.webContents.send('noteflow:maximized-changed', w.isMaximized())
  }
  w.on('maximize', sendMaximized)
  w.on('unmaximize', sendMaximized)

  // 多窗口项目绑定：?project=<id> 由渲染层读取（刷新后仍保持绑定）
  const base = DEV_URL || (attached ? `http://127.0.0.1:${PORT}` : nf.url)
  const target = projectId ? `${base}${base.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId)}` : base
  log('加载窗口', target)
  w.loadURL(target).catch((err) => {
    dialog.showErrorBox('NoteFlow', `页面加载失败: ${err?.message || err}`)
  })

  // 站外链接交给系统浏览器，站内（127.0.0.1 / 本服务）照常打开
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(url)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // 托盘常驻：点“关闭”= 隐藏到托盘（进程与后端服务继续运行），
  // 真正退出走托盘菜单“退出”（app.quit → before-quit 优雅停服务）
  w.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    w.hide()
  })

  w.on('closed', () => {
    if (projectId && projectWindows.get(projectId) === w) projectWindows.delete(projectId)
    if (lastFocusedWindow === w) lastFocusedWindow = null
  })
  return w
}

/** 聚焦最近使用的窗口；一个都没有则新建（默认项目） */
function focusOrCreateWindow() {
  const candidate =
    lastFocusedWindow && !lastFocusedWindow.isDestroyed()
      ? lastFocusedWindow
      : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || null
  if (candidate) {
    if (candidate.isMinimized()) candidate.restore()
    candidate.show()
    candidate.focus()
    return candidate
  }
  return createWindow()
}

/** 创建系统托盘：win/linux 左键点图标显示窗口，右键菜单含“显示/退出” */
function createTray() {
  // 优先 16px 专用图（打包配置已带上）；缺失则退回主图标
  const iconPath = join(ROOT, 'build/icons/16x16.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromPath(join(ROOT, 'build/icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('NoteFlow')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 NoteFlow', click: () => focusOrCreateWindow() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  )
  // mac 上单击托盘 = 打开菜单，不另绑 click（显示窗口走 dock）
  if (process.platform !== 'darwin') tray.on('click', () => focusOrCreateWindow())
}

/** IPC 回包：消息来自哪个窗口就操作哪个窗口（多窗口各自控制自己） */
function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender)
}

/** 页面主题色 → 窗口背景与原生控件配色（窗口按钮已自绘，无需标题栏覆盖） */
function applyTitleBarTheme(w, theme) {
  if (process.platform !== 'win32' || !w || w.isDestroyed()) return
  const dark = theme !== 'light'
  w.setBackgroundColor(dark ? '#09090b' : '#ffffff')
  nativeTheme.themeSource = dark ? 'dark' : 'light'
}

async function main() {
  app.on('second-instance', () => {
    focusOrCreateWindow()
  })

  await app.whenReady()
  ipcMain.on('noteflow:theme', (event, theme) => applyTitleBarTheme(windowFromEvent(event), theme))
  // 自绘窗口按钮的动作通道（按消息来源窗口操作，多窗口互不干扰）
  ipcMain.on('noteflow:window', (event, action) => {
    const w = windowFromEvent(event)
    if (!w || w.isDestroyed()) return
    if (action === 'minimize') w.minimize()
    else if (action === 'toggle-maximize') w.isMaximized() ? w.unmaximize() : w.maximize()
    else if (action === 'close') w.close()
  })
  ipcMain.handle('noteflow:is-maximized', (event) => {
    const w = windowFromEvent(event)
    return w && !w.isDestroyed() ? w.isMaximized() : false
  })
  // 在新窗口打开项目（一窗口一项目：已有该项目窗口则聚焦）
  ipcMain.on('noteflow:open-project-window', (_event, projectId) => {
    if (typeof projectId !== 'string' || !projectId) return
    createWindow({ projectId })
  })
  // 原生目录选择框（添加项目用）
  ipcMain.handle('noteflow:select-directory', async (event) => {
    const w = windowFromEvent(event)
    const result = await dialog.showOpenDialog(w, { properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths?.[0] ?? null)
  })
  // 窗口标题跟随当前项目
  ipcMain.on('noteflow:set-title', (event, title) => {
    const w = windowFromEvent(event)
    if (w && !w.isDestroyed() && typeof title === 'string') w.setTitle(title)
  })
  buildMenu()
  await startBackend()
  createWindow()
  createTray()

  app.on('activate', () => {
    // mac：点 dock 图标时，有窗口聚焦之，没有则新建
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else focusOrCreateWindow()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻模式：窗口全关不退出，由托盘菜单“退出”结束进程
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    if (tray) {
      tray.destroy()
      tray = null
    }
    if (!nf || attached) return // attached 时服务不属于本进程，不负责停止
    event.preventDefault()
    log('正在停止后台服务…')
    nf
      .stop()
      .catch(() => {})
      .finally(() => app.exit(0))
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log('已有实例在运行，退出')
  app.quit()
} else {
  main().catch((err) => {
    console.error('[noteflow-electron] 启动失败:', err)
    // 对话框不 await：避免无人点击时进程卡住不退出（后台/自动化场景）
    let exited = false
    const forceExit = () => {
      if (!exited) {
        exited = true
        app.exit(1)
      }
    }
    dialog
      .showMessageBox({
        type: 'error',
        title: 'NoteFlow 启动失败',
        message: String(err?.message || err),
        buttons: ['确定'],
      })
      .finally(forceExit)
    setTimeout(forceExit, 10_000).unref?.()
  })
}
