/**
 * 图片素材上传端点（POST /api/noteflow/asset）
 *
 * 编辑器粘贴/拖入图片时把二进制落盘到 notes/assets/<年-月>/。
 * quickforge 的 write_file 只接受 UTF-8 文本，二进制必须走自有端点——
 * 本 handler 同时挂载在 server.mjs（生产）与 vite middleware（开发）。
 *
 * 请求体：JSON { ext: 'png' | 'jpg' | ..., dataBase64: string }
 * 响应：{ path: 'assets/2026-09/paste-....png' }
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { isPathWithin } from './fs-endpoint.mjs'

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'])
const MAX_BYTES = 15 * 1024 * 1024
const MAX_BODY_CHARS = Math.ceil((MAX_BYTES * 4) / 3) + 4096

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function randomTag() {
  return Math.random().toString(36).slice(2, 6)
}

export function createAssetEndpoint({ notesDir }) {
  const root = resolve(notesDir)
  return async function handleAssetUpload(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_BODY_CHARS) {
          sendJson(res, 413, { error: '图片过大（上限 15MB）' })
          return
        }
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const ext = String(body.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!ALLOWED_EXT.has(ext)) {
        sendJson(res, 400, { error: `不支持的图片格式：${ext || '(空)'}` })
        return
      }
      const buffer = Buffer.from(String(body.dataBase64 || ''), 'base64')
      if (buffer.length === 0) {
        sendJson(res, 400, { error: '图片数据为空' })
        return
      }
      if (buffer.length > MAX_BYTES) {
        sendJson(res, 413, { error: '图片过大（上限 15MB）' })
        return
      }
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const relPath = `assets/${month}/paste-${stamp}-${randomTag()}.${ext === 'jpeg' ? 'jpg' : ext}`
      const absPath = resolve(join(root, relPath))
      // isPathWithin 用 path.relative 判断（旧 startsWith(root + '/') 在 Windows 恒 false → 上传必 403）
      if (!isPathWithin(root, absPath)) {
        sendJson(res, 403, { error: 'invalid_path' })
        return
      }
      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, buffer)
      sendJson(res, 200, { path: relPath })
    } catch (error) {
      sendJson(res, 500, { error: `上传失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }
}

/** 与 server.mjs 保持一致的笔记目录解析（也供 vite dev middleware 使用） */
export function defaultNotesDir(projectRoot) {
  const dir = process.env.NOTEFLOW_NOTES_DIR || join(projectRoot, 'notes')
  return resolve(dir)
}
