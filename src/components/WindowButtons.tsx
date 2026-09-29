import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

/** Electron preload 注入的窗口控制桥（仅 Windows 桌面版存在） */
type WindowBridge = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
}

function getWindowBridge(): WindowBridge | null {
  const bridge = (window as Window & { noteflow?: { platform?: string; window?: WindowBridge } }).noteflow
  return bridge?.platform === 'win32' && bridge.window ? bridge.window : null
}

/** 自绘最小化/最大化(全屏)/关闭 —— 贴住窗口右上角（无边框窗口，样式跟随主题） */
export function WindowButtons() {
  const [bridge, setBridge] = useState<WindowBridge | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const wb = getWindowBridge()
    setBridge(wb)
    if (!wb) return
    void wb.isMaximized().then(setMaximized)
    return wb.onMaximizedChange(setMaximized)
  }, [])

  if (!bridge) return null

  // h-11 与顶栏同高、直角 hover、无间距：贴合 Windows 原生窗口控制
  const base = 'flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

  return (
    // 顶栏 px-3(12px) 右内边距用 -mr-3 抵消，让按钮组紧贴右上角
    <div className="-mr-3 ml-1 flex h-11 shrink-0 items-stretch">
      <button type="button" title="最小化" className={base} onClick={() => bridge.minimize()}>
        <Minus className="size-3.5" />
      </button>
      <button type="button" title={maximized ? '向下还原' : '全屏'} className={base} onClick={() => bridge.toggleMaximize()}>
        {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
      </button>
      <button
        type="button"
        title="关闭"
        className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-red-500 hover:text-white"
        onClick={() => bridge.close()}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
