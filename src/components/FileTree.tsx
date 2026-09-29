/**
 * 左栏文件树宿主：完全复用 quickforge 的 WorkspaceFileTree 渲染组件
 * （懒加载分页、图片缩略图、状态机重试），外面包一层笔记操作工具栏与右键菜单。
 * 右键菜单通过事件冒泡捕获（行按钮的 title 即 node.path），不改动快照组件。
 */
import { useCallback, useEffect, useReducer, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  PencilLine,
  RefreshCw,
  RotateCcw,
  SquarePen,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { WorkspaceFileTree } from './workspace/WorkspaceFileTree'
import { getWorkspaceChildren } from './workspace/workspace-api'
import {
  normalizeWorkspaceTreePath,
  workspaceTreeDirectory,
  workspaceTreeParentPath,
  workspaceTreeReducer,
  workspaceTreeRefreshPaths,
} from './workspace/workspace-tree-state'
import { runCommand, shQuote } from '../lib/api'
import { movePath, moveToTrash, renamePath, restoreFromTrash, revealInFinder, deletePermanently, emptyTrash, TRASH_DIR } from '../lib/file-ops'
import { ATTACH_NOTE_KEY, SETTINGS_EVENT } from './SettingsDialog'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

type Props = {
  projectId: string
  selectedPath: string | null
  onSelect: (path: string) => void
  onCreated: (path: string) => void
  /** 文件/文件夹被重命名、删除或恢复后通知宿主刷新树并调整选中态（null 表示已入回收站） */
  onPathMoved: (oldPath: string, nextPath: string | null) => void
  treeVersion: number
  onTreeChange: () => void
}

type MenuTarget =
  | { kind: 'file' | 'directory'; path: string }
  | { kind: 'blank' }

type MenuState = { x: number; y: number; target: MenuTarget } | null

type MenuItem = { label: string; icon: LucideIcon; danger?: boolean; onSelect: () => void } | { separator: true }

/** 右键菜单浮层：fixed 定位 + 边界翻转，点击外部 / Escape / 滚动 / resize 自动关闭 */
function FileContextMenu({ x, y, items, onClose }: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useEffect(() => {
    const el = ref.current
    if (el) {
      const rect = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
      const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
      setPosition((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as globalThis.Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [x, y, onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="fixed z-[10000] min-w-[11rem] overflow-hidden rounded-[0.85rem] border border-border bg-popover p-[0.35rem] text-popover-foreground shadow-lg"
    >
      {items.map((item, index) =>
        'separator' in item ? (
          <div key={`sep-${index}`} className="mx-1 my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={`flex w-full items-center gap-2 rounded-[0.55rem] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted ${
              item.danger ? 'text-destructive hover:bg-destructive/10' : ''
            }`}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

export function FileTree({ projectId, selectedPath, onSelect, onCreated, onPathMoved, treeVersion, onTreeChange }: Props) {
  const [treeState, dispatchTree] = useReducer(workspaceTreeReducer, {})
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [createTarget, setCreateTarget] = useState<{ kind: 'file' | 'dir'; parent: string } | null>(null)
  const [newName, setNewName] = useState('')
  const [menu, setMenu] = useState<MenuState>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const dragPathRef = useRef<string | null>(null)
  const toast = useToast()
  const dialog = useDialog()

  const loadDirectory = useCallback(
    async (path: string) => {
      const normalized = normalizeWorkspaceTreePath(path)
      const generation = Date.now()
      dispatchTree({ type: 'request', path: normalized, generation })
      try {
        const response = await getWorkspaceChildren(projectId, normalized)
        dispatchTree({ type: 'success', path: normalized, generation, entries: response.entries, nextCursor: response.nextCursor })
        return true
      } catch (error) {
        dispatchTree({ type: 'failure', path: normalized, generation, error: error instanceof Error ? error.message : String(error) })
        return false
      }
    },
    [projectId],
  )

  const loadMore = useCallback(
    async (path: string) => {
      const normalized = normalizeWorkspaceTreePath(path)
      const directory = workspaceTreeDirectory(treeState, normalized)
      if (!directory.nextCursor) return
      const generation = directory.generation || Date.now()
      dispatchTree({ type: 'request', path: normalized, generation, append: true, cursor: directory.nextCursor })
      try {
        const response = await getWorkspaceChildren(projectId, normalized, { cursor: directory.nextCursor })
        dispatchTree({ type: 'success', path: normalized, generation, entries: response.entries, nextCursor: response.nextCursor, append: true })
      } catch (error) {
        dispatchTree({ type: 'failure', path: normalized, generation, error: error instanceof Error ? error.message : String(error) })
      }
    },
    [projectId, treeState],
  )

  const toggleDirectory = useCallback(
    (path: string) => {
      const normalized = normalizeWorkspaceTreePath(path)
      setExpandedPaths((current) => {
        const next = new Set(current)
        if (next.has(normalized)) next.delete(normalized)
        else next.add(normalized)
        if (!current.has(normalized)) void loadDirectory(normalized)
        return next
      })
    },
    [loadDirectory],
  )

  // 初次加载根目录
  useEffect(() => {
    void loadDirectory('.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // 外部信号（保存/删除/重命名后）刷新所有已展开目录
  useEffect(() => {
    if (treeVersion === 0) return
    const paths = workspaceTreeRefreshPaths(treeState, new Set(expandedPaths))
    for (const path of paths) void loadDirectory(path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeVersion])

  /* ---------- 右键菜单 ---------- */
  const refreshTree = () => {
    const paths = workspaceTreeRefreshPaths(treeState, new Set(expandedPaths))
    for (const path of paths) void loadDirectory(path)
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest('button')
    const path = button?.getAttribute('title') ?? ''
    if (path) {
      const parent = workspaceTreeParentPath(path) ?? '.'
      const node = workspaceTreeDirectory(treeState, parent).entries.find((entry) => entry.path === path)
      if (node) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          target: { kind: node.type === 'directory' ? 'directory' : 'file', path },
        })
        return
      }
    }
    // 空白区域：新建入口；点到「加载更多」等非文件行按钮时不打扰
    if (!button) {
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, target: { kind: 'blank' } })
    }
  }

  const menuItems: MenuItem[] = []
  if (menu) {
    const target = menu.target
    if (target.kind === 'blank') {
      menuItems.push(
        { label: '新建笔记', icon: SquarePen, onSelect: () => startCreate('file', '.') },
        { label: '新建文件夹', icon: FolderPlus, onSelect: () => startCreate('dir', '.') },
        { separator: true },
        { label: '刷新', icon: RefreshCw, onSelect: refreshTree },
        { label: '在 Finder 中打开', icon: FolderOpen, onSelect: () => void revealTarget('.', 'root') },
      )
    } else if (target.kind === 'directory' && target.path === TRASH_DIR) {
      // 回收站目录本身：清空 + 常规目录操作
      menuItems.push(
        { label: '清空回收站', icon: Trash2, danger: true, onSelect: () => void emptyTrashConfirm() },
        { separator: true },
        { label: '刷新', icon: RefreshCw, onSelect: refreshTree },
        { label: '在 Finder 中打开', icon: FolderOpen, onSelect: () => void revealTarget(target.path, target.kind) },
      )
    } else if (target.path.startsWith(`${TRASH_DIR}/`)) {
      menuItems.push(
        { label: '恢复到根目录', icon: RotateCcw, onSelect: () => void restoreTarget(target.path) },
        { label: '重命名', icon: PencilLine, onSelect: () => void renameTarget(target.path) },
        { label: '在 Finder 中显示', icon: FolderOpen, onSelect: () => void revealTarget(target.path, target.kind) },
        { separator: true },
        { label: '彻底删除（不可恢复）', icon: Trash2, danger: true, onSelect: () => void destroyTarget(target.path) },
      )
    } else if (target.kind === 'directory') {
      menuItems.push(
        { label: '新建笔记', icon: SquarePen, onSelect: () => startCreate('file', target.path) },
        { label: '新建文件夹', icon: FolderPlus, onSelect: () => startCreate('dir', target.path) },
        { separator: true },
        { label: '重命名', icon: PencilLine, onSelect: () => void renameTarget(target.path) },
        { label: '复制路径', icon: Copy, onSelect: () => void copyPath(target.path) },
        { label: '在 Finder 中打开', icon: FolderOpen, onSelect: () => void revealTarget(target.path, target.kind) },
        { separator: true },
        { label: '删除（移入回收站）', icon: Trash2, danger: true, onSelect: () => void trashTarget(target.path, target.kind) },
      )
    } else {
      if (target.path.endsWith('.md')) {
        menuItems.push({ label: '与此笔记对话', icon: MessageSquare, onSelect: () => chatWithNote(target.path) })
        menuItems.push({ separator: true })
      }
      menuItems.push(
        { label: '重命名', icon: PencilLine, onSelect: () => void renameTarget(target.path) },
        { label: '复制路径', icon: Copy, onSelect: () => void copyPath(target.path) },
        { label: '在 Finder 中显示', icon: FolderOpen, onSelect: () => void revealTarget(target.path, target.kind) },
        { separator: true },
        { label: '移入回收站', icon: Trash2, danger: true, onSelect: () => void trashTarget(target.path, 'file') },
      )
    }
  }

  /* ---------- 文件操作（与中栏工具栏共用 lib/file-ops） ---------- */
  const startCreate = (kind: 'file' | 'dir', parent: string) => {
    setCreateTarget({ kind, parent: normalizeWorkspaceTreePath(parent) })
    setNewName('')
  }

  const renameTarget = async (path: string) => {
    const oldName = path.split('/').pop() ?? path
    const name = await dialog.prompt({ title: '重命名', defaultValue: oldName, confirmText: '重命名' })
    if (!name || !name.trim() || name.trim() === oldName) return
    try {
      const nextPath = await renamePath(projectId, path, name)
      toast.success(`已重命名为 ${name.trim()}`)
      onPathMoved(path, nextPath)
    } catch (error) {
      toast.error(`重命名失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const trashTarget = async (path: string, kind: 'file' | 'directory') => {
    const name = path.split('/').pop() ?? path
    const confirmed = await dialog.confirm({
      title: '移入回收站',
      message:
        kind === 'directory'
          ? `文件夹「${name}」及其全部内容将被移入 .trash/，可随时恢复。`
          : `「${name}」将被移入 .trash/ 目录，可随时恢复。`,
      confirmText: '移入回收站',
      danger: true,
    })
    if (!confirmed) return
    try {
      await moveToTrash(projectId, path)
      toast.success('已移入回收站')
      onPathMoved(path, null)
    } catch (error) {
      toast.error(`移入回收站失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const restoreTarget = async (path: string) => {
    try {
      const nextPath = await restoreFromTrash(projectId, path)
      toast.success(`已恢复 ${nextPath.split('/').pop()}`)
      onPathMoved(path, nextPath)
    } catch (error) {
      toast.error(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 彻底删除回收站内条目（rm -rf，不可恢复） */
  const destroyTarget = async (path: string) => {
    const name = path.split('/').pop() ?? path
    const confirmed = await dialog.confirm({
      title: '彻底删除',
      message: `「${name}」将从磁盘永久删除，不可恢复。`,
      confirmText: '彻底删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      await deletePermanently(projectId, path)
      toast.success('已彻底删除')
      onPathMoved(path, null)
    } catch (error) {
      toast.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 清空整个回收站 */
  const emptyTrashConfirm = async () => {
    const confirmed = await dialog.confirm({
      title: '清空回收站',
      message: '.trash/ 内的全部内容将被永久删除，不可恢复。',
      confirmText: '清空',
      danger: true,
    })
    if (!confirmed) return
    try {
      await emptyTrash(projectId)
      toast.success('回收站已清空')
      refreshTree()
      onTreeChange()
    } catch (error) {
      toast.error(`清空失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success(`已复制：${path}`)
    } catch (error) {
      toast.error(`复制失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const revealTarget = async (path: string, kind: 'file' | 'directory' | 'root') => {
    try {
      await revealInFinder(projectId, path, kind)
    } catch (error) {
      toast.error(`打开失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 选中笔记并确保「发送时附带笔记」开启，然后直接去聊天 */
  const chatWithNote = (path: string) => {
    onSelect(path)
    localStorage.setItem(ATTACH_NOTE_KEY, '1')
    window.dispatchEvent(new Event(SETTINGS_EVENT))
    toast.success('已选中，发送消息时将附带此笔记')
  }

  /* ---------- 拖拽移动（宿主层冒泡捕获，与右键菜单同模式：行按钮 title 即节点路径） ---------- */
  const handleNodeDragStart = (path: string, event: ReactDragEvent) => {
    dragPathRef.current = path
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', path)
      event.dataTransfer.effectAllowed = 'move'
    }
  }

  /** 命中行 → 目录本身 / 文件父目录；空白（含加载更多）→ 根目录 */
  const resolveDropDir = (title: string | null): string | null => {
    if (!title) return '.'
    const parent = workspaceTreeParentPath(title) ?? '.'
    const node = workspaceTreeDirectory(treeState, parent).entries.find((entry) => entry.path === title)
    if (!node) return null
    return node.type === 'directory' ? title : parent
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragPathRef.current) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const button = (event.target as HTMLElement).closest('button')
    const dir = resolveDropDir(button?.getAttribute('title') ?? null)
    setDropDir((current) => (current === dir ? current : dir))
  }

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragPathRef.current) return
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDropDir(null)
  }

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    const src = dragPathRef.current
    const dir = dropDir
    dragPathRef.current = null
    setDropDir(null)
    if (!src || !dir || dir === null) return
    event.preventDefault()
    try {
      const target = await movePath(projectId, src, dir)
      toast.success(`已移动到 ${dir === '.' ? '根目录' : `${dir}/`}`)
      onPathMoved(src, target)
    } catch (error) {
      // 同目录拖放等"无操作"情形静默；真实错误提示
      const message = error instanceof Error ? error.message : String(error)
      if (message !== '已在该目录中') toast.error(`移动失败：${message}`)
    }
  }

  const submitCreate = async () => {
    const target = createTarget
    if (!target) return
    const name = newName.trim()
    setCreateTarget(null)
    setNewName('')
    if (!name) return
    if (target.kind === 'dir') {
      const dirPath = [target.parent === '.' ? '' : target.parent, name.replace(/^\/+|\/+$/g, '')]
        .filter(Boolean)
        .join('/')
      if (!dirPath) return
      try {
        await runCommand(projectId, `mkdir -p ${shQuote(dirPath)}`)
        onTreeChange()
        toast.success(`已创建文件夹 ${dirPath}`)
      } catch (error) {
        toast.error(`创建失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    const base = name.startsWith('/') ? name.slice(1) : name
    const relative = target.parent === '.' ? base : `${target.parent}/${base}`
    onCreated(relative.endsWith('.md') ? relative : `${relative}.md`)
  }

  const rootDirectory = workspaceTreeDirectory(treeState, '.')
  const closeMenu = useCallback(() => setMenu(null), [])

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
      onDragEnd={() => {
        dragPathRef.current = null
        setDropDir(null)
      }}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">笔记</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新建笔记（⌘N）"
            onClick={() => startCreate('file', '.')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SquarePen className="size-4" />
          </button>
          <button
            type="button"
            title="新建文件夹"
            onClick={() => startCreate('dir', '.')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FolderPlus className="size-4" />
          </button>
          <button
            type="button"
            title="刷新"
            onClick={() => {
              const paths = workspaceTreeRefreshPaths(treeState, new Set(expandedPaths))
              for (const path of paths) void loadDirectory(path)
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className={`size-4 ${rootDirectory.status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {createTarget && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={newName}
            placeholder={createTarget.kind === 'dir' ? '文件夹名（可含子路径）' : '笔记名（可含目录，如 日记/今天.md）'}
            onChange={(event) => setNewName(event.target.value)}
            onBlur={() => void submitCreate()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitCreate()
              if (event.key === 'Escape') {
                setCreateTarget(null)
                setNewName('')
              }
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {createTarget.parent !== '.' && (
            <p className="mt-1 px-1 text-[11px] text-muted-foreground">将在 {createTarget.parent}/ 内创建</p>
          )}
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto pb-3 ${dropDir === '.' ? 'rounded-md ring-1 ring-inset ring-primary/60' : ''}`}>
        <WorkspaceFileTree
          treeState={treeState}
          rootEntries={rootDirectory.entries}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath ?? undefined}
          projectId={projectId}
          onToggleDirectory={toggleDirectory}
          onRetryDirectory={(path) => void loadDirectory(path)}
          onLoadMore={(path) => void loadMore(path)}
          onSelectFile={onSelect}
          onNodeDragStart={handleNodeDragStart}
          dropTargetPath={dropDir}
        />
        {rootDirectory.status === 'loaded' && rootDirectory.entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">暂无笔记，点击右上角 ✎ 新建</p>
        )}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
    </div>
  )
}
