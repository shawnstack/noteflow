#!/usr/bin/env node
/**
 * dev 模式编排：并行启动
 *  1. server.mjs        —— QuickForge 服务（5178）+ 项目注册
 *  2. vite (5179)       —— 前端 dev server，/api 代理到 5178
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const children = []

function run(name, command, args, color) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
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
  child.on('exit', (code) => {
    if (code && code !== 0) process.stderr.write(`${prefix} 退出码 ${code}\n`)
  })
  children.push(child)
  return child
}

run('quickforge', 'node', ['server.mjs'], '\x1b[36m')
run('vite', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:web'], '\x1b[35m')

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
