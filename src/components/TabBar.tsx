/**
 * 中栏标签栏：多笔记同时打开。
 * - 每个标签显示文件名（title 为完整路径），未保存修改时显示圆点（hover 变关闭按钮）
 * - 激活标签顶部有 accent 指示线；中键 / ⌘W 关闭
 * - 超出宽度横向滚动，不打断布局
 */
import { X } from 'lucide-react'

export type NoteTab = { path: string; dirty: boolean }

type Props = {
  tabs: NoteTab[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

function tabLabel(path: string): string {
  return path.split('/').pop() ?? path
}

export function TabBar({ tabs, activePath, onSelect, onClose }: Props) {
  if (tabs.length === 0) return null
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-background [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab.path === activePath
        return (
          <div
            key={tab.path}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            title={tab.path}
            onClick={() => onSelect(tab.path)}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(tab.path)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(tab.path)
            }}
            className={`group relative flex min-w-0 max-w-52 shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border/60 px-3 text-[12.5px] ${
              active ? 'bg-card text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            }`}
          >
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
            <span className="min-w-0 truncate">{tabLabel(tab.path)}</span>
            {tab.dirty ? (
              <span
                role="button"
                tabIndex={-1}
                title="未保存"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.path)
                }}
                className="ml-auto shrink-0"
              >
                <span className="block size-2 rounded-full bg-amber-500 group-hover:hidden dark:bg-amber-400" />
                <X className="hidden size-3.5 group-hover:block" />
              </span>
            ) : (
              <button
                type="button"
                title="关闭"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.path)
                }}
                className="ml-auto hidden shrink-0 rounded p-0.5 hover:bg-muted group-hover:block"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
