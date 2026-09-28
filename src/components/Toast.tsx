import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, XCircle } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string }

type ToastApi = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用')
  return context
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />,
  error: <XCircle className="size-4 shrink-0 text-red-400" />,
  info: <Info className="size-4 shrink-0 text-sky-400" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev.slice(-3), { id, kind, message }])
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id))
    }, kind === 'error' ? 5000 : 2600)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-card/95 px-3 py-2.5 text-[13px] text-foreground shadow-xl backdrop-blur"
          >
            {ICONS[item.kind]}
            <span className="min-w-0 flex-1 break-words">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
