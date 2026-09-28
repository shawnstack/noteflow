import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// 前端所有 API 请求走相对路径 /api：
// - dev 模式由 vite 代理转发到 zhibi 专属的 QuickForge 服务（127.0.0.1:5178）
// - 生产模式由 server.mjs 的静态服务反向代理
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5179,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5178',
        changeOrigin: true,
        configure: (proxy) => {
          // SSE 长连接不能被代理超时掐断（与 quickforge 的 vite.config 做法一致）
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            const contentType = String(proxyRes.headers['content-type'] || '')
            if (contentType.includes('text/event-stream')) {
              res.setTimeout(0)
              res.setHeader('X-Accel-Buffering', 'no')
              // 立即发出响应头：SSE 首个 ping 可能 15s 后才到，不 flush 会让 EventSource 一直等
              res.flushHeaders()
            }
          })
        },
      },
    },
  },
})
