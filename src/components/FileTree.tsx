/**
 * 左栏文件树宿主：完全复用 quickforge 的 WorkspaceFileTree 渲染组件
 * （懒加载分页、图片缩略图、状态机重试），外面包一层笔记操作工具栏。
 */
import { useCallback, useEffect, useReducer, useState } from 'react'
import { FolderPlus, RefreshCw, SquarePen } from 'lucide-react'
import { WorkspaceFileTree } from './workspace/WorkspaceFileTree'
import { getWorkspaceChildren } from './workspace/workspace-api'
import {
  normalizeWorkspaceTreePath,
  workspaceTreeDirectory,
  workspaceTreeReducer,
  workspaceTreeRefreshPaths,
} from './workspace/workspace-tree-state'
import { runCommand, shQuote } from '../lib/api'
import { useToast } from './Toast'

type Props = {
  projectId: string
  selectedPath: string | null
  onSelect: (path: string) => void
  onCreated: (path: string) => void
  treeVersion: number
  onTreeChange: () => void
}

export function FileTree({ projectId, selectedPath, onSelect, onCreated, treeVersion, onTreeChange }: Props) {
  const [treeState, dispatchTree] = useReducer(workspaceTreeReducer, {})
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingDir, setCreatingDir] = useState(false)
  const [newName, setNewName] = useState('')
  const toast = useToast()

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

  const submitCreate = async () => {
    const name = newName.trim()
    setCreatingFile(false)
    setCreatingDir(false)
    setNewName('')
    if (!name) return
    if (creatingDir) {
      const path = name.replace(/^\/+|\/+$/g, '')
      try {
        await runCommand(projectId, `mkdir -p ${shQuote(path)}`)
        onTreeChange()
        toast.success(`已创建文件夹 ${path}`)
      } catch (error) {
        toast.error(`创建失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    let path = name.startsWith('/') ? name.slice(1) : name
    if (!path.endsWith('.md')) path = `${path}.md`
    onCreated(path)
  }

  const rootDirectory = workspaceTreeDirectory(treeState, '.')
  const creating = creatingFile || creatingDir

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">笔记</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="新建笔记（⌘N）"
            onClick={() => {
              setCreatingFile(true)
              setCreatingDir(false)
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SquarePen className="size-4" />
          </button>
          <button
            type="button"
            title="新建文件夹"
            onClick={() => {
              setCreatingDir(true)
              setCreatingFile(false)
            }}
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

      {creating && (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={newName}
            placeholder={creatingDir ? '文件夹名（可含子路径）' : '笔记名（可含目录，如 日记/今天.md）'}
            onChange={(event) => setNewName(event.target.value)}
            onBlur={() => void submitCreate()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitCreate()
              if (event.key === 'Escape') {
                setCreatingFile(false)
                setCreatingDir(false)
                setNewName('')
              }
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
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
        />
        {rootDirectory.status === 'loaded' && rootDirectory.entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">暂无笔记，点击右上角 ✎ 新建</p>
        )}
      </div>
    </div>
  )
}
