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
import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEV_URL = process.env.VITE_DEV_SERVER_URL || ''
const PORT = Number(process.env.NOTEFLOW_PORT || 5179)

let win = null
let nf = null // startNoteFlow() 的返回值
let attached = false // true = 复用了外部已运行的服务（npm start），退出时不负责停服务
let quitting = false

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

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#09090b',
    title: 'NoteFlow',
    // 任务栏/窗口图标（win/linux 开发模式有意义；mac 由 icns 接管，生产由打包注入）
    ...(existsSync(join(ROOT, 'build/icon.png')) ? { icon: join(ROOT, 'build/icon.png') } : {}),
    show: false,
    webPreferences: {
      // 纯 web 页面加载，不注入 node；contextIsolation/sandbox 保持默认开启
    },
  })

  win.once('ready-to-show', () => win.show())

  const target = DEV_URL || (attached ? `http://127.0.0.1:${PORT}` : nf.url)
  log('加载窗口', target)
  win.loadURL(target).catch((err) => {
    dialog.showErrorBox('NoteFlow', `页面加载失败: ${err?.message || err}`)
  })

  // 站外链接交给系统浏览器，站内（127.0.0.1 / 本服务）照常打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(url)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  win.on('closed', () => {
    win = null
  })
}

async function main() {
  app.on('second-instance', () => {
    if (win) {
      win.show()
      win.focus()
    }
  })

  await app.whenReady()
  buildMenu()
  await startBackend()
  createWindow()

  app.on('activate', () => win?.show())

  app.on('window-all-closed', () => {
    // 本地工具：窗口全关即退出（后端服务随进程结束，避免残留）
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
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
