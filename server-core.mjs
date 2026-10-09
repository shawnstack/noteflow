/**
 * NoteFlow 服务核心（可编程启动入口）
 *
 * 从 server.mjs 抽取，供两类宿主共用：
 *  1. CLI（server.mjs）：spawn 独立 QuickForge 子进程（行为与历史版本一致）；
 *  2. Electron 主进程（electron/main.mjs）：inline=true 在当前进程内启动 QuickForge
 *     —— quickforge 内部 spawn(process.execPath) 在 Electron 下会拉起 GUI 实例，
 *     inline 模式绕开该问题（quickforge 官方支持，依赖 node:sqlite，无原生 ABI 问题）。
 *
 * startNoteFlow(options) → { host, port, url, qf, server, stop() }
 * 选项（均可省略，默认与环境变量同 server.mjs）：
 *  host        静态服务监听地址（默认 NOTEFLOW_HOST / 127.0.0.1；QuickForge 恒为 127.0.0.1）
 *  port        静态服务端口，传 0 表示随机（默认 NOTEFLOW_PORT / 5179）
 *  qfPort      QuickForge 服务端口（默认 NOTEFLOW_QF_PORT / 5178）
 *  dataDir     数据目录（默认 ~/.noteflow）
 *  notesDir    笔记目录（默认 <项目>/notes；Electron 打包态默认 ~/Documents/NoteFlow）
 *  serveStatic 是否托管 dist 静态文件 + /api 反代（dev 模式为 false，前端由 vite 提供）
 *  inline      QuickForge 是否运行于当前进程（Electron 用）
 *  log         日志函数
 */
import { createServer, request as httpRequest } from 'node:http'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startQuickForge } from '@shawnstack/quickforge'
import { createAssetEndpoint } from './asset-endpoint.mjs'
import { createFsEndpoint } from './fs-endpoint.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const DIST = join(ROOT, 'dist')

/** 打包进安装目录后不能把笔记写进 resources/app/notes（只读且路径过长会被截断）。 */
function defaultNotesDir() {
  if (process.env.NOTEFLOW_NOTES_DIR) return resolve(process.env.NOTEFLOW_NOTES_DIR)
  const packaged = Boolean(process.versions.electron) && !process.defaultApp && !process.env.VITE_DEV_SERVER_URL
  if (packaged) return join(homedir(), 'Documents', 'NoteFlow')
  return join(ROOT, 'notes')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

export async function startNoteFlow(options = {}) {
  const {
    host = process.env.NOTEFLOW_HOST || '127.0.0.1',
    port = Number(process.env.NOTEFLOW_PORT || 5179),
    qfPort = Number(process.env.NOTEFLOW_QF_PORT || 5178),
    dataDir = process.env.NOTEFLOW_DATA_DIR || join(homedir(), '.noteflow'),
    notesDir = defaultNotesDir(),
    serveStatic = true,
    inline = false,
    log = (tag, msg = '') => console.log(`[noteflow] ${tag}${msg ? ` ${msg}` : ''}`),
  } = options

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /**
   * 调 QuickForge 管理 API；503 maintenance（如启动期 sqlite 迁移）是暂态，自动重试。
   * （/api/health 只探进程存活，migration 完成前就会返回 200，inline 模式下尤其明显）
   */
  const apiWithRetry = async (label, doFetch, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs
    let lastDetail = ''
    while (true) {
      const res = await doFetch()
      if (res.ok) return res
      const body = await res.text().catch(() => '')
      const transient = res.status === 503 && /maintenance|migrating/.test(body)
      if (!transient) {
        const err = new Error(`${label}失败: HTTP ${res.status} ${body.slice(0, 200)}`)
        err.code = `HTTP_${res.status}`
        throw err
      }
      lastDetail = `HTTP ${res.status} ${body.slice(0, 120)}`
      if (Date.now() > deadline) {
        throw new Error(`${label}失败（等待维护状态结束超时）: ${lastDetail}`)
      }
      await sleep(500)
    }
  }

  log('启动 QuickForge 服务（NoteFlow 专属实例）…', inline ? '（inline 模式：运行于当前进程）' : '')
  log(`数据目录: ${dataDir}`)
  log(`笔记目录: ${notesDir}`)
  await mkdir(notesDir, { recursive: true })

  const app = await startQuickForge({
    host: '127.0.0.1',
    port: qfPort,
    dataDir,
    workspaceDir: ROOT,
    openBrowser: false,
    // 强起新实例：绝不复用正在运行的 QuickForge（那会共享它的数据目录与配置）
    reuseExisting: false,
    timeoutMs: 90_000,
    ...(inline ? { inline: true } : {}),
  })

  const base = app.url
  log(`QuickForge 服务就绪: ${base} (pid ${app.pid}${app.inline ? ', inline' : ''})`)

  // 1) 允许前端直调 write_file / edit_file 工具（保存笔记、精确编辑）
  try {
    await apiWithRetry('设置 agent-access-mode', () =>
      fetch(`${base}/api/storage/settings/key/agent-access-mode`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'full-access' }),
      }),
    )
  } catch (err) {
    log('警告', `设置 agent-access-mode 失败: ${err.message}`)
  }

  // 2) 注册并激活 notes 目录为项目（幂等：同一路径永远返回同一 projectId）
  const projectRes = await apiWithRetry('注册笔记目录', () =>
    fetch(`${base}/api/project/path`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: notesDir }),
    }),
  ).catch(async (err) => {
    await app.stop().catch(() => {})
    throw err
  })
  const projectPayload = await projectRes.json()
  log(`笔记项目: ${projectPayload.project?.id} -> ${projectPayload.project?.path}`)

  if (!serveStatic) {
    log('后端就绪', 'dev 模式下前端由 vite 提供（npm run dev），本进程仅维护 QuickForge 服务')
    return {
      host,
      port: null,
      url: null,
      qf: app,
      server: null,
      stop: async () => {
        await app.stop().catch(() => {})
        log('已停止')
      },
    }
  }

  // 3) 生产模式：静态托管 dist + /api 反向代理
  if (!existsSync(join(DIST, 'index.html'))) {
    await app.stop().catch(() => {})
    throw new Error(`未找到 ${DIST}/index.html，请先执行 npm run build`)
  }

  const handleAssetUpload = createAssetEndpoint({ notesDir })
  // 跨平台文件操作（重命名 / 回收站 / 定位 / git 历史等）：projectId 由 quickforge 项目注册表解析
  const handleFsApi = createFsEndpoint({ qfBase: base })

  const proxyApi = (req, res) => {
    const proxyReq = httpRequest(
      {
        host: '127.0.0.1',
        port: qfPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${qfPort}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
        // SSE 等长连接必须立即发出响应头（首个 ping 可能 15s 后才到）
        res.flushHeaders()
        proxyRes.pipe(res)
      },
    )
    proxyReq.on('error', (err) => {
      log('代理错误', String(err))
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({ error: 'quickforge_unreachable' }))
    })
    req.pipe(proxyReq)
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    // 健康检查（Electron attach 探测用：识别“这是不是 NoteFlow 自己的服务”）
    if (url.pathname === '/api/noteflow/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, app: 'noteflow', pid: process.pid, qfPid: app.pid }))
      return
    }
    // 编辑器粘贴图片的二进制上传（quickforge write_file 只收 UTF-8，走自有端点）
    if (url.pathname === '/api/noteflow/asset') {
      await handleAssetUpload(req, res)
      return
    }
    // 跨平台文件操作（Node fs 实现，macOS/Windows 通用）
    if (url.pathname === '/api/noteflow/fs') {
      await handleFsApi(req, res)
      return
    }
    if (url.pathname.startsWith('/api/')) {
      proxyApi(req, res)
      return
    }
    // 静态文件（SPA 回退到 index.html）
    let filePath = normalize(join(DIST, decodeURIComponent(url.pathname)))
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    try {
      const info = await stat(filePath).catch(() => null)
      if (info?.isDirectory()) filePath = join(filePath, 'index.html')
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      const body = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'content-type': MIME['.html'] })
      res.end(body)
    }
  })

  try {
    await new Promise((resolveListen, rejectListen) => {
      const onError = (err) => rejectListen(err)
      server.once('error', onError)
      server.listen(port, host, () => {
        server.removeListener('error', onError)
        resolveListen()
      })
    })
  } catch (err) {
    // 静态服务起不来时把已就绪的 QuickForge 一并停掉，避免半启动状态
    await app.stop().catch(() => {})
    throw err
  }

  const actualPort = server.address().port
  log('NoteFlow 已启动', `http://${host}:${actualPort}`)

  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    qf: app,
    server,
    stop: async () => {
      const tasks = []
      if (server) {
        tasks.push(
          new Promise((r) => {
            server.closeAllConnections?.()
            server.close(() => r())
          }),
        )
      }
      tasks.push(app.stop().catch(() => {}))
      await Promise.allSettled(tasks)
      log('已停止')
    },
  }
}
