/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type PathDialogOptions = {
  title: string
  description?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 打开目录选择框（原生/服务端对话框）；返回 null 表示取消 */
  browse?: () => Promise<string | null>
}

/** 清理粘贴的路径：去首尾空白与包裹引号（Windows「复制文件地址」会带引号） */
export function normalizePastedPath(raw: string): string {
  let value = raw.trim()
  while (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1).trim()
  }
  return value
}

function PathDialogInner({
  options,
  onResolve,
}: {
  options: PathDialogOptions
  onResolve: (value: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const valueRef = useRef(value)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  // 打开即聚焦输入框（方便直接 Ctrl+V 粘贴路径）
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    const normalized = normalizePastedPath(valueRef.current)
    if (normalized) onResolve(normalized)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onResolve(null)
      if (event.key === 'Enter') submit()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResolve])

  const handleBrowse = async () => {
    if (!options.browse || browsing) return
    setBrowsing(true)
    try {
      // 原生框选中即确认，保持旧的"一步到位"体验；取消（null）则留在本对话框继续手输
      const picked = await options.browse()
      if (picked) onResolve(picked)
    } finally {
      setBrowsing(false)
    }
  }

  return createPortal(
    <div
      className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(null)
      }}
    >
      <div
        className={cn(
          'quickforge-dialog-panel-in w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-quickforge',
          'mx-4',
        )}
      >
        <h2 className="text-base font-semibold text-foreground">{options.title}</h2>
        {options.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{options.description}</p>
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={options.placeholder}
            spellCheck={false}
            className="w-full font-mono text-[13px]"
          />
          {options.browse && (
            <Button variant="outline" size="sm" className="h-9 shrink-0" disabled={browsing} onClick={() => void handleBrowse()}>
              <FolderOpen className="size-4" />
              {browsing ? '选择中…' : '浏览…'}
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/70">粘贴完整文件夹路径后回车，或点击「浏览…」选择目录。</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onResolve(null)}>
            {options.cancelLabel ?? '取消'}
          </Button>
          <Button size="sm" onClick={submit} disabled={!normalizePastedPath(value)}>
            {options.confirmLabel ?? '确定'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 弹出"输入/粘贴路径"对话框；返回路径（已规范化），取消返回 null */
export function showPathDialog(options: PathDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)

    function cleanup() {
      root.unmount()
      setTimeout(() => container.remove(), 0)
    }

    function handleResolve(value: string | null) {
      cleanup()
      resolve(value)
    }

    root.render(<PathDialogInner options={options} onResolve={handleResolve} />)
  })
}
