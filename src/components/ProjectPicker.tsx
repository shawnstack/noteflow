import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderPlus, FolderOpen, ExternalLink, Monitor, Trash2, X } from 'lucide-react'
import type { ProjectInfo } from '../lib/types'

type Props = {
  current: ProjectInfo
  projects: ProjectInfo[]
  onSelect: (project: ProjectInfo) => void
  onOpenInWindow: (projectId: string) => void
  onAdd: () => void
  onRemove: (project: ProjectInfo) => void
  onMenuOpen?: () => void | Promise<void>
}

/** 相对时间（最近项目排序提示） */
function timeAgo(iso?: string): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  if (ms < 60_000) return '刚刚'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)} 天前`
  return new Date(iso).toLocaleDateString()
}

/**
 * 顶栏项目选择器：下拉列出最近项目（按最近打开排序）。
 * - 点击项目 = 行内展开打开方式二选一：在当前窗口打开 / 在新窗口打开
 * - 每项右侧快捷按钮 = 直接在新窗口打开（同项目已有窗口则聚焦）/ 从列表移除
 * - 底部"添加项目…" = 对话框粘贴路径或浏览目录注册新项目
 */
export function ProjectPicker({ current, projects, onSelect, onOpenInWindow, onAdd, onRemove, onMenuOpen }: Props) {
  const [open, setOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<ProjectInfo | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) setMenuFor(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    void onMenuOpen?.()
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const recent = [...projects].sort((a, b) => {
    const ta = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0
    const tb = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0
    if (tb !== ta) return tb - ta
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  })

  return (
    <div ref={rootRef} className="relative ml-1">
      <button
        type="button"
        title={current.path}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-56 items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <span className="truncate">{current.name}</span>
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl">
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium tracking-wide text-muted-foreground/80">最近的项目</p>
          <div className="max-h-72 overflow-y-auto">
            {recent.map((project) => {
              const active = project.id === current.id
              const expanded = !active && menuFor?.id === project.id
              if (expanded) {
                return (
                  <div key={project.id} className="my-0.5 rounded-md bg-muted/70 p-1">
                    <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
                      <FolderOpen className="size-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" title={project.path}>
                        {project.name}
                      </span>
                      <button
                        type="button"
                        title="取消"
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setMenuFor(null)}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground/90 transition-colors hover:bg-background hover:text-foreground"
                      onClick={() => {
                        setOpen(false)
                        onSelect(project)
                      }}
                    >
                      <Monitor className="size-3.5 text-muted-foreground" />
                      在当前窗口打开
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-foreground/90 transition-colors hover:bg-background hover:text-foreground"
                      onClick={() => {
                        setOpen(false)
                        onOpenInWindow(project.id)
                      }}
                    >
                      <ExternalLink className="size-3.5 text-muted-foreground" />
                      在新窗口打开
                    </button>
                    <p className="px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground/70">同项目已有窗口时将聚焦该窗口</p>
                  </div>
                )
              }
              return (
                <div
                  key={project.id}
                  className={`group relative flex items-center gap-2 rounded-md px-2 py-1.5 ${active ? 'bg-muted' : 'hover:bg-muted/70'}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      if (active) {
                        setOpen(false)
                        return
                      }
                      setMenuFor((prev) => (prev?.id === project.id ? null : project))
                    }}
                  >
                    <FolderOpen className={`size-3.5 shrink-0 ${active ? 'text-indigo-500 dark:text-indigo-400' : 'text-muted-foreground'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className={`truncate text-[12px] ${active ? 'font-medium text-foreground' : 'text-foreground/90'}`}>{project.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(project.lastOpenedAt)}</span>
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground/70" title={project.path}>
                        {project.path}
                      </span>
                    </span>
                  </button>
                  {!active && (
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        title="在新窗口打开（同项目已有窗口时聚焦）"
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation()
                          setOpen(false)
                          onOpenInWindow(project.id)
                        }}
                      >
                        <ExternalLink className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="从列表移除（不删除文件）"
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-red-500 group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation()
                          setOpen(false)
                          onRemove(project)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
            {recent.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-muted-foreground/70">暂无其他项目</p>}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              onClick={() => {
                setOpen(false)
                onAdd()
              }}
            >
              <FolderPlus className="size-3.5" />
              添加项目…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
