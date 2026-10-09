import { useState } from 'react'
import { workspacePreviewUrl } from './artifact-preview-utils'
import { cn } from '@/lib/utils'

/**
 * 图片阅读器：按 workspace 预览接口渲染图片，带缩放工具条
 * （适应窗口 / 100% / ±25% 步进，25%–400% 夹取）。
 */

type ImageReaderProps = {
  projectId: string
  path: string
  alt?: string
}

const ZOOM_STEP = 25
const ZOOM_MIN = 25
const ZOOM_MAX = 400

export function ImageReader({ projectId, path, alt }: ImageReaderProps) {
  // scale === null 表示「适应窗口」（默认）
  const [scale, setScale] = useState<number | null>(null)

  const zoom = (delta: number) => setScale((current) => clampZoom((current ?? 100) + delta))

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5">
        <span className="mr-1 text-[11px] text-muted-foreground/70">{scale === null ? '适应窗口' : `${scale}%`}</span>
        <ZoomButton title="缩小" onClick={() => zoom(-ZOOM_STEP)}>−</ZoomButton>
        <ZoomButton title="放大" onClick={() => zoom(ZOOM_STEP)}>＋</ZoomButton>
        <ZoomButton title="按 100% 显示" onClick={() => setScale(100)}>100%</ZoomButton>
        <ZoomButton title="适应窗口" onClick={() => setScale(null)} active={scale === null}>适应</ZoomButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <img
            src={workspacePreviewUrl(projectId, path)}
            alt={alt ?? path}
            className={cn('rounded-xl border border-border', scale === null ? 'max-h-full max-w-full object-contain' : 'object-left-top')}
            style={scale === null ? undefined : { width: `${scale}%`, height: 'auto' }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}

function clampZoom(value: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

function ZoomButton({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'min-w-8 rounded px-2 py-1 text-[11px] transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
