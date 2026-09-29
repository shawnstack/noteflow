#!/usr/bin/env node
/**
 * NoteFlow 启动器（CLI 薄壳）
 *
 * 布局：左 文件管理 · 中 文本阅读/编辑 · 右 AI 对话（自研三栏 UI）。
 * 能力：文件读写、工作区浏览、AI Agent（多厂商模型）、SSE 事件流
 *       全部复用 QuickForge 服务（@shawnstack/quickforge public-api）。
 *
 * 实际逻辑在 server-core.mjs（与 Electron 桌面端共用）：
 *  1. 启动 NoteFlow 专属 QuickForge 实例（独立数据目录 ~/.noteflow，
 *     与桌面版 ~/.quickforge 互不干扰；不复用已运行实例）；
 *  2. 开启 agent-access-mode=full-access（允许前端直调 write_file 保存笔记）；
 *  3. 注册并激活 notes/ 目录为工作区项目；
 *  4. 生产模式（npm start = node server.mjs --serve-static）：静态托管 dist/ 并将 /api 反向代理到 QuickForge 服务。
 *
 * 环境变量：
 *  NOTEFLOW_HOST      静态服务监听地址（默认 127.0.0.1，可设 0.0.0.0 供局域网访问）
 *  NOTEFLOW_PORT      NoteFlow 对外端口（默认 5179，传 0 为随机端口）
 *  NOTEFLOW_QF_PORT   QuickForge 服务端口（默认 5178）
 *  NOTEFLOW_DATA_DIR  数据目录（默认 ~/.noteflow）
 *  NOTEFLOW_NOTES_DIR 笔记目录（默认 <项目>/notes）
 */
import { startNoteFlow } from './server-core.mjs'

const serveStatic = process.argv.includes('--serve-static')

async function boot() {
  const nf = await startNoteFlow({ serveStatic })

  const shutdown = async (signal) => {
    console.log(`[noteflow] 收到 ${signal}，正在停止…`)
    try {
      await nf.stop()
    } catch {}
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  if (serveStatic) {
    console.log('[noteflow] Ctrl+C 退出')
  }

  // dev 模式（无静态服务）下事件循环可能没有常驻 handle，显式挂起保持进程存活
  await new Promise(() => {})
}

boot().catch((err) => {
  console.error('[noteflow] 启动失败:', err)
  process.exit(1)
})
