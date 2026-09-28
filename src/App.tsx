import { useCallback, useEffect, useRef, useState } from 'react'
import { Feather, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Search, Settings2, Unplug } from 'lucide-react'
import { getActiveModel, getActiveProject } from './lib/api'
import type { ModelLike, ProjectInfo } from './lib/types'
import { FileTree } from './components/FileTree'
import { NoteEditor } from './components/NoteEditor'
import { ChatPanel } from './components/ChatPanel'
import { SetupDialog } from './components/SetupDialog'
import { SettingsDialog, initPersistedSettings } from './components/SettingsDialog'
import { CommandRunner } from './components/CommandRunner'
import { SearchPalette } from './components/SearchPalette'
import { useDialog } from './components/Dialog'

const LEFT_MIN = 180
const LEFT_MAX = 440
const RIGHT_MIN = 300
const RIGHT_MAX = 620

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [model, setModel] = useState<ModelLike | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [noteContext, setNoteContext] = useState<{ path: string; content: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(248)
  const [rightWidth, setRightWidth] = useState(400)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
  const dialog = useDialog()

  useEffect(() => {
    void initPersistedSettings()
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      try {
        const [activeProject, activeModel] = await Promise.all([getActiveProject(), getActiveModel()])
        if (cancelled) return
        if (!activeProject) {
          setBootError('未找到激活的笔记项目，请确认 NoteFlow 服务（server.mjs）已启动')
          return
        }
        setProject(activeProject)
        setModel(activeModel)
        if (!activeModel) setSetupOpen(true)
      } catch (err) {
        if (!cancelled) setBootError(`连接 QuickForge 服务失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------- 三栏拖拽调宽 ---------- */
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.side === 'left') {
        setLeftWidth(Math.min(LEFT_MAX, Math.max(LEFT_MIN, drag.startWidth + event.clientX - drag.startX)))
      } else {
        setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, drag.startWidth - (event.clientX - drag.startX))))
      }
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startDrag = (side: 'left' | 'right') => (event: React.MouseEvent) => {
    dragRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? leftWidth : rightWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  /* ---------- 快捷键 ---------- */
  const createNote = useCallback(async () => {
    const name = await dialog.prompt({ title: '新建笔记', placeholder: '笔记名（可含目录，如 日记/今天.md）', confirmText: '创建' })
    if (!name || !name.trim()) return
    let path = name.trim().replace(/^\/+/, '')
    if (!path.endsWith('.md')) path = `${path}.md`
    setSelectedPath(path)
  }, [dialog])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setSearchOpen(true)
      } else if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
      } else if (event.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNote])

  /* ---------- 回调 ---------- */
  const handleNoteContent = useCallback((path: string, content: string) => {
    setNoteContext((prev) => (prev?.path === path && prev.content === content ? prev : { path, content }))
  }, [])

  const handleCreated = useCallback(
    (path: string) => {
      setSelectedPath(path)
      setTreeVersion((v) => v + 1)
    },
    [],
  )

  const handleSaved = useCallback(() => {
    setTreeVersion((v) => v + 1)
  }, [])

  const handleFileMoved = useCallback((nextPath: string | null) => {
    setSelectedPath(nextPath)
    setTreeVersion((v) => v + 1)
  }, [])

  const handleModelChange = useCallback((next: ModelLike) => setModel(next), [])

  if (bootError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Unplug className="size-10 text-red-400" />
        <p className="max-w-md text-center text-sm">{bootError}</p>
        <p className="text-xs text-muted-foreground/70">请先运行 npm run dev（开发）或 npm run build &amp;&amp; npm start（生产）</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        {leftCollapsed ? (
          <button type="button" title="展开文件树" onClick={() => setLeftCollapsed(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <PanelLeft className="size-4" />
          </button>
        ) : (
          <button type="button" title="收起文件树" onClick={() => setLeftCollapsed(true)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <PanelLeftClose className="size-4" />
          </button>
        )}
        <Feather className="size-4 text-indigo-400" />
        <span className="text-sm font-medium tracking-wide">NoteFlow</span>
        {project && (
          <span className="ml-1 max-w-40 truncate rounded-full bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground" title={project.path}>
            {project.name}
          </span>
        )}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ml-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground hover:border-border hover:text-foreground"
        >
          <Search className="size-3.5" />
          搜索
          <kbd className="rounded border border-border px-1 text-[10px] text-muted-foreground/70">⌘P</kbd>
        </button>
        <span className="ml-auto flex items-center gap-1">
          <span className="hidden text-[11px] text-muted-foreground/70 md:inline">⌘S 保存 · ⌘N 新建</span>
          <button
            type="button"
            title="设置"
            onClick={() => setSettingsOpen(true)}
            className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="size-4" />
          </button>
          {rightCollapsed ? (
            <button type="button" title="展开对话" onClick={() => setRightCollapsed(false)} className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <PanelRight className="size-4" />
            </button>
          ) : (
            <button type="button" title="收起对话" onClick={() => setRightCollapsed(true)} className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <PanelRightClose className="size-4" />
            </button>
          )}
        </span>
      </header>

      {/* 三栏主体 */}
      <div className="flex min-h-0 flex-1">
        {!leftCollapsed && (
          <>
            <aside className="shrink-0 border-r border-border bg-background" style={{ width: leftWidth }}>
              {project ? (
                <FileTree
                  projectId={project.id}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onCreated={handleCreated}
                  treeVersion={treeVersion}
                  onTreeChange={() => setTreeVersion((v) => v + 1)}
                />
              ) : (
                <p className="p-3 text-xs text-muted-foreground/70">连接服务中…</p>
              )}
            </aside>
            <div onMouseDown={startDrag('left')} className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-indigo-500/40" />
          </>
        )}

        <main className="min-w-0 flex-1 bg-card/40">
          {project ? (
            <NoteEditor projectId={project.id} path={selectedPath} onSaved={handleSaved} onContentChange={handleNoteContent} onFileMoved={handleFileMoved} />
          ) : (
            <p className="p-6 text-sm text-muted-foreground/70">加载中…</p>
          )}
        </main>

        {!rightCollapsed && (
          <>
            <div onMouseDown={startDrag('right')} className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-indigo-500/40" />
            <aside className="shrink-0 border-l border-border bg-background" style={{ width: rightWidth }}>
              {project ? (
                <ChatPanel projectId={project.id} noteContext={noteContext} onOpenSetup={() => setSetupOpen(true)} model={model} onModelChange={handleModelChange} />
              ) : null}
            </aside>
          </>
        )}
      </div>

      {project && (
        <SearchPalette open={searchOpen} projectId={project.id} onClose={() => setSearchOpen(false)} onSelect={setSelectedPath} />
      )}
      {project && <CommandRunner projectId={project.id} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onOpenSetup={() => { setSettingsOpen(false); setSetupOpen(true) }} notesDir={project?.path} />
      <SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onConfigured={handleModelChange} />
    </div>
  )
}
