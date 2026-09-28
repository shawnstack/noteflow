#!/usr/bin/env node
/**
 * NoteFlow 启动器
 *
 * 布局：左 文件管理 · 中 文本阅读/编辑 · 右 AI 对话（自研三栏 UI）。
 * 能力：文件读写、工作区浏览、AI Agent（多厂商模型）、SSE 事件流
 *       全部复用 QuickForge 服务（@shawnstack/quickforge public-api）。
 *
 * 职责：
 *  1. 启动 NoteFlow 专属 QuickForge 实例（独立数据目录 ~/.noteflow，
 *     与桌面版 ~/.quickforge 互不干扰；不复用已运行实例）；
 *  2. 开启 agent-access-mode=full-access（允许前端直调 write_file 保存笔记）；
 *  3. 注册并激活 notes/ 目录为工作区项目；
 *  4. 生产模式（默认 / --serve-static）：静态托管 dist/ 并将 /api 反向代理到 QuickForge 服务。
 *
 * 环境变量：
 *  NOTEFLOW_PORT      NoteFlow 对外端口（默认 5179）
 *  NOTEFLOW_QF_PORT   QuickForge 服务端口（默认 5178）
 *  NOTEFLOW_DATA_DIR  数据目录（默认 ~/.noteflow）
 *  NOTEFLOW_NOTES_DIR 笔记目录（默认 <项目>/notes）
 */
import { createServer, request as httpRequest } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startQuickForge } from '@shawnstack/quickforge'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.NOTEFLOW_PORT || 5179)
const QF_PORT = Number(process.env.NOTEFLOW_QF_PORT || 5178)
const DATA_DIR = process.env.NOTEFLOW_DATA_DIR || join(homedir(), '.noteflow')
const NOTES_DIR = resolve(process.env.NOTEFLOW_NOTES_DIR || join(ROOT, 'notes'))
const SERVE_STATIC = process.argv.includes('--serve-static')

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

function log(tag, msg = '') {
  console.log(`[noteflow] ${tag}${msg ? ` ${msg}` : ''}`)
}

async function main() {
  log('启动 QuickForge 服务（NoteFlow 专属实例）…')
  log(`数据目录: ${DATA_DIR}`)
  log(`笔记目录: ${NOTES_DIR}`)

  const app = await startQuickForge({
    host: '127.0.0.1',
    port: QF_PORT,
    dataDir: DATA_DIR,
    workspaceDir: ROOT,
    openBrowser: false,
    // 强起新实例：绝不复用正在运行的 QuickForge（那会共享它的数据目录与配置）
    reuseExisting: false,
    timeoutMs: 90_000,
  })

  const base = app.url
  log(`QuickForge 服务就绪: ${base} (pid ${app.pid})`)

  // 1) 允许前端直调 write_file / edit_file 工具（保存笔记、精确编辑）
  const accessRes = await fetch(`${base}/api/storage/settings/key/agent-access-mode`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'full-access' }),
  })
  if (!accessRes.ok) {
    log('警告', `设置 agent-access-mode 失败: HTTP ${accessRes.status}`)
  }

  // 2) 注册并激活 notes 目录为项目（幂等：同一路径永远返回同一 projectId）
  const projectRes = await fetch(`${base}/api/project/path`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: NOTES_DIR }),
  })
  if (!projectRes.ok) {
    throw new Error(`注册笔记目录失败: HTTP ${projectRes.status} ${await projectRes.text()}`)
  }
  const projectPayload = await projectRes.json()
  log(`笔记项目: ${projectPayload.project?.id} -> ${projectPayload.project?.path}`)

  if (!SERVE_STATIC) {
    log('后端就绪', 'dev 模式下前端由 vite 提供（npm run dev），本进程仅维护 QuickForge 服务')
    return
  }

  // 3) 生产模式：静态托管 dist + /api 反向代理
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`未找到 ${DIST}/index.html，请先执行 npm run build`)
  }

  const proxyApi = (req, res) => {
    const proxyReq = httpRequest(
      {
        host: '127.0.0.1',
        port: QF_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${QF_PORT}` },
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
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
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

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  log('NoteFlow 已启动', `http://127.0.0.1:${PORT}  (Ctrl+C 退出)`)
}

main().catch((err) => {
  console.error('[noteflow] 启动失败:', err)
  process.exit(1)
})
