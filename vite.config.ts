import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
// @ts-expect-error node 端共用模块（无类型声明）
import { createAssetEndpoint, defaultNotesDir } from './asset-endpoint.mjs'

// 前端所有 API 请求走相对路径 /api：
// - dev 模式由 vite 代理转发到 zhibi 专属的 QuickForge 服务（127.0.0.1:5178）
// - 生产模式由 server.mjs 的静态服务反向代理
// - /api/noteflow/asset 为 NoteFlow 自有端点（图片上传），dev 下由本 middleware 处理
const assetUpload = createAssetEndpoint({ notesDir: defaultNotesDir(fileURLToPath(new URL('.', import.meta.url))) })

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'noteflow-asset-endpoint',
      configureServer(server) {
        server.middlewares.use('/api/noteflow/asset', (req, res) => {
          console.log('[noteflow-dev] asset endpoint hit:', req.method, req.url)
          void assetUpload(req, res)
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5179,
    proxy: {
      '/api': {
        // NOTEFLOW_QF_PORT 由 dev 编排注入（dev:electron 独立端口冒烟/多实例场景）
        target: `http://127.0.0.1:${process.env.NOTEFLOW_QF_PORT || 5178}`,
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
