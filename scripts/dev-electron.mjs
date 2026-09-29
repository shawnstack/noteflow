#!/usr/bin/env node
/**
 * Electron 开发模式编排：按序启动
 *  1. vite dev server（5179）—— 前端 + /api 代理到 5178 + asset 端点 middleware
 *  2. electron —— 主进程 inline 起 QuickForge（5178），窗口加载 vite URL
 *
 * 注意：与 npm run dev（纯 Web 开发）不要同时开 —— 两边都要独占 5178 的
 * NoteFlow 专属 QuickForge 实例。
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
// vite 端口可用 NOTEFLOW_DEV_PORT 覆盖（默认与纯 Web dev 相同的 5179）
const DEV_PORT = process.env.NOTEFLOW_DEV_PORT || '5179'
const DEV_URL = `http://localhost:${DEV_PORT}`

const children = []

function run(name, command, args, color, env = process.env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = `${color}[${name}]\x1b[0m`
  const pipe = (stream, out) => {
    stream.setEncoding('utf8')
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        out.write(`${prefix} ${line}\n`)
      }
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  children.push(child)
  return child
}

/** 等待 vite dev server 可访问（vite 8 只监听 localhost/::1，必须用 localhost 探测） */
async function waitForVite(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill('SIGINT')
    } catch {}
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

run(
  'vite',
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev:web', '--', '--port', DEV_PORT, '--strictPort'],
  '\x1b[35m',
)

if (!(await waitForVite(DEV_URL))) {
  process.stderr.write(`[dev-electron] vite dev server (${DEV_URL}) 60s 内未就绪，退出\n`)
  shutdown()
}

const electron = run(
  'electron',
  'npx',
  ['electron', 'electron/main.mjs'],
  '\x1b[33m',
  { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
)

// 窗口关闭（electron 退出）后整个编排一起收摊
electron.on('exit', shutdown)
