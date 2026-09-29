import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarCheck, Feather, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Search, Settings2, Unplug } from 'lucide-react'
import { getActiveModel, getActiveProject, listNotePaths, readFileMeta, writeFileContent } from './lib/api'
import { initTheme } from './lib/theme'
import type { ModelLike, ProjectInfo } from './lib/types'
import { ensureGitRepo, gitAutoCommit } from './lib/git-history'
import { resolveWikiTarget } from './lib/wikilinks'
import { FileTree } from './components/FileTree'
import { NoteEditor } from './components/NoteEditor'
import { ChatPanel, type ChatPanelHandle } from './components/ChatPanel'
import { SetupDialog } from './components/SetupDialog'
import { SettingsDialog, initPersistedSettings } from './components/SettingsDialog'
import { CommandRunner } from './components/CommandRunner'
import { SearchPalette } from './components/SearchPalette'
import { TabBar } from './components/TabBar'
import { HistoryPanel } from './components/HistoryPanel'
import { useDialog } from './components/Dialog'

const LEFT_MIN = 180
const LEFT_MAX = 440
const RIGHT_MIN = 300
const RIGHT_MAX = 620

/** 多标签页持久化（重启后恢复打开的笔记） */
const TABS_KEY = 'noteflow.openTabs'
const ACTIVE_TAB_KEY = 'noteflow.activeTab'
const MAX_RESTORE_TABS = 12

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({})
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [model, setModel] = useState<ModelLike | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [noteContext, setNoteContext] = useState<{ path: string; content: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [noteList, setNoteList] = useState<string[]>([])
  const [aiResult, setAiResult] = useState<{ text: string; at: number } | null>(null)
  const [leftWidth, setLeftWidth] = useState(248)
  const [rightWidth, setRightWidth] = useState(400)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
  const selectedPathRef = useRef<string | null>(null)
  const projectRef = useRef<ProjectInfo | null>(null)
  const chatPanelRef = useRef<ChatPanelHandle>(null)
  const gitTimerRef = useRef<number | null>(null)
  const dialog = useDialog()

  useEffect(() => {
    selectedPathRef.current = selectedPath
  }, [selectedPath])
  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    void initPersistedSettings()
    initTheme()
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

  /* ---------- 多笔记标签页 ---------- */
  const openPath = useCallback((path: string) => {
    setTabs((current) => (current.includes(path) ? current : [...current, path]))
    setSelectedPath(path)
  }, [])

  const closeTab = useCallback(
    (path: string) => {
      const idx = tabs.indexOf(path)
      const next = tabs.filter((p) => p !== path)
      setTabs(next)
      if (selectedPath === path) {
        setSelectedPath(next[Math.min(idx, next.length - 1)] ?? null)
      }
      setDirtyTabs((current) => {
        if (!current[path]) return current
        const nextDirty = { ...current }
        delete nextDirty[path]
        return nextDirty
      })
    },
    [tabs, selectedPath],
  )

  // 打开的标签与激活页持久化
  useEffect(() => {
    if (tabs.length) localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
    else localStorage.removeItem(TABS_KEY)
  }, [tabs])
  useEffect(() => {
    if (selectedPath) localStorage.setItem(ACTIVE_TAB_KEY, selectedPath)
    else localStorage.removeItem(ACTIVE_TAB_KEY)
  }, [selectedPath])

  // 项目就绪后：初始化 git 仓库 + 恢复上次的标签页（校验文件仍存在）
  const tabsRestoredRef = useRef(false)
  useEffect(() => {
    if (!project || tabsRestoredRef.current) return
    tabsRestoredRef.current = true
    void ensureGitRepo(project.id).catch(() => {})
    void (async () => {
      const raw = localStorage.getItem(TABS_KEY)
      if (!raw) return
      let paths: unknown
      try {
        paths = JSON.parse(raw)
      } catch {
        return
      }
      if (!Array.isArray(paths)) return
      const alive: string[] = []
      for (const path of paths.slice(0, MAX_RESTORE_TABS)) {
        if (typeof path !== 'string') continue
        if (await readFileMeta(project.id, path).then(() => true).catch(() => false)) alive.push(path)
      }
      if (alive.length === 0) return
      const active = localStorage.getItem(ACTIVE_TAB_KEY)
      setTabs(alive)
      setSelectedPath(alive.includes(active ?? '') ? (active as string) : alive[alive.length - 1])
    })()
  }, [project])

  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyTabs((current) => (Boolean(current[path]) === dirty ? current : { ...current, [path]: dirty }))
  }, [])

  /* ---------- git 自动版本记录（防抖合并 1.5s 内的连续变更） ---------- */
  const scheduleGitCommit = useCallback((reason: string) => {
    const current = projectRef.current
    if (!current) return
    if (gitTimerRef.current) window.clearTimeout(gitTimerRef.current)
    gitTimerRef.current = window.setTimeout(() => {
      gitTimerRef.current = null
      void gitAutoCommit(current.id, reason).catch((err) => console.warn('[noteflow] git 自动提交失败', err))
    }, 1500)
  }, [])

  /* ---------- 笔记路径清单（双链解析 / [[ 补全 / 反向链接；随树刷新防抖重建） ---------- */
  useEffect(() => {
    const current = projectRef.current
    if (!current) return
    const timer = window.setTimeout(() => {
      listNotePaths(current.id)
        .then(setNoteList)
        .catch(() => {})
    }, 600)
    return () => window.clearTimeout(timer)
  }, [project, treeVersion])

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
    openPath(path)
  }, [dialog, openPath])

  /* ---------- 每日笔记（⌘D / 顶栏按钮：一键打开或创建今天的日记） ---------- */
  const openTodayNote = useCallback(async () => {
    const current = projectRef.current
    if (!current) return
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const path = `日记/${date}.md`
    const exists = await readFileMeta(current.id, path).then(() => true).catch(() => false)
    if (!exists) {
      const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
      const template = `# ${date} 周${weekday}\n\n## 待办\n\n- [ ] \n\n## 记录\n\n`
      await writeFileContent(current.id, path, template).catch(() => {})
      setTreeVersion((v) => v + 1)
      scheduleGitCommit('新建每日笔记')
    }
    openPath(path)
  }, [openPath, scheduleGitCommit])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setSearchOpen(true)
      } else if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
      } else if (mod && event.key.toLowerCase() === 'w') {
        // 浏览器可能不允许网页拦截 ⌘W，尽力而为（标签 × / 中键始终可用）
        const active = selectedPathRef.current
        if (active) {
          event.preventDefault()
          closeTab(active)
        }
      } else if (mod && event.key.toLowerCase() === 'd') {
        // 每日笔记（浏览器 ⌘D 收藏可被 preventDefault 拦截时优先本应用）
        event.preventDefault()
        void openTodayNote()
      } else if (event.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNote, closeTab, openTodayNote])

  /* ---------- 回调 ---------- */
  const handleNoteContent = useCallback((path: string, content: string) => {
    setNoteContext((prev) => (prev?.path === path && prev.content === content ? prev : { path, content }))
  }, [])

  const handleCreated = useCallback(
    (path: string) => {
      openPath(path)
      setTreeVersion((v) => v + 1)
    },
    [openPath],
  )

  const handleSaved = useCallback(
    (path: string) => {
      setTreeVersion((v) => v + 1)
      scheduleGitCommit(`保存 ${path.split('/').pop() ?? path}`)
    },
    [scheduleGitCommit],
  )

  const handleFileCreated = useCallback(() => {
    setTreeVersion((v) => v + 1)
    scheduleGitCommit('插入图片')
  }, [scheduleGitCommit])

  const handleAgentEnd = useCallback((lastAssistantText: string) => {
    scheduleGitCommit('AI 对话')
    if (lastAssistantText.trim()) setAiResult({ text: lastAssistantText.trim(), at: Date.now() })
  }, [scheduleGitCommit])

  /** 选中文字 AI 操作：展开右栏并把 prompt 发到对话 */
  const handleAskAi = useCallback((prompt: string) => {
    setRightCollapsed(false)
    chatPanelRef.current?.ask(prompt)
  }, [])

  const openHistory = useCallback((path: string) => setHistoryPath(path), [])

  /* ---------- 双链：点击未创建的 wiki 目标 → 确认后创建 ---------- */
  const handleOpenWiki = useCallback(
    async (target: string) => {
      const current = projectRef.current
      if (!current) return
      const resolved = resolveWikiTarget(target, noteList)
      if (resolved) {
        openPath(resolved)
        return
      }
      const clean = target.trim()
      const path = clean.toLowerCase().endsWith('.md') || clean.toLowerCase().endsWith('.markdown') ? clean : `${clean}.md`
      const confirmed = await dialog.confirm({
        title: '创建笔记',
        message: `「${clean}」还不存在，现在创建吗？`,
        confirmText: '创建',
      })
      if (!confirmed) return
      openPath(path)
    },
    [dialog, noteList, openPath],
  )

  const handleRestored = useCallback((path: string) => {
    setTreeVersion((v) => v + 1)
    window.dispatchEvent(new CustomEvent('noteflow:file-restored', { detail: { path } }))
  }, [])

  /** 路径统一映射（重命名/移动/删除后同步标签页、激活页与未保存标记） */
  const applyPathMoved = useCallback((oldPath: string, nextPath: string | null) => {
    const mapPath = (p: string): string | null => {
      if (p === oldPath) return nextPath
      if (p.startsWith(`${oldPath}/`)) return nextPath === null ? null : nextPath + p.slice(oldPath.length)
      return p
    }
    setTabs((current) => current.map(mapPath).filter((p): p is string => p !== null))
    setSelectedPath((current) => (current === null ? null : mapPath(current)))
    setDirtyTabs((current) => {
      const next: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(current)) {
        const mapped = mapPath(key)
        if (mapped !== null) next[mapped] = value
      }
      return next
    })
    setTreeVersion((v) => v + 1)
  }, [])

  // 中栏工具栏的重命名/回收站/恢复：以当前激活页为旧路径
  const handleFileMoved = useCallback(
    (nextPath: string | null) => {
      const old = selectedPathRef.current
      if (old) applyPathMoved(old, nextPath)
      else if (nextPath) openPath(nextPath)
      scheduleGitCommit('文件操作')
    },
    [applyPathMoved, openPath, scheduleGitCommit],
  )

  // 文件树右键 / 拖拽移动后：刷新树 + git 记录
  const handlePathMoved = useCallback(
    (oldPath: string, nextPath: string | null) => {
      applyPathMoved(oldPath, nextPath)
      scheduleGitCommit('文件移动')
    },
    [applyPathMoved, scheduleGitCommit],
  )

  const handleModelChange = useCallback((next: ModelLike) => setModel(next), [])

  if (bootError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Unplug className="size-10 text-red-500 dark:text-red-400" />
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
        <Feather className="size-4 text-indigo-500 dark:text-indigo-400" />
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
        <button
          type="button"
          onClick={() => void openTodayNote()}
          title="打开今天的日记（不存在则按模板创建）· ⌘D"
          className="ml-1 flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground hover:border-border hover:text-foreground"
        >
          <CalendarCheck className="size-3.5" />
          今日
        </button>
        <span className="ml-auto flex items-center gap-1">
          <span className="hidden text-[11px] text-muted-foreground/70 md:inline">⌘S 保存 · ⌘N 新建 · ⌘D 日记</span>
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
                  onSelect={openPath}
                  onCreated={handleCreated}
                  onPathMoved={handlePathMoved}
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
            <div className="relative flex h-full min-h-0 flex-col">
              <TabBar
                tabs={tabs.map((path) => ({ path, dirty: Boolean(dirtyTabs[path]) }))}
                activePath={selectedPath}
                onSelect={openPath}
                onClose={closeTab}
              />
              <div className="min-h-0 flex-1">
                <NoteEditor
                  projectId={project.id}
                  path={selectedPath}
                  onSaved={handleSaved}
                  onContentChange={handleNoteContent}
                  onFileMoved={handleFileMoved}
                  onDirtyChange={handleDirtyChange}
                  onAskAi={handleAskAi}
                  onOpenHistory={openHistory}
                  onFileCreated={handleFileCreated}
                  noteList={noteList}
                  onOpenWiki={handleOpenWiki}
                  onOpenPath={openPath}
                  aiResult={aiResult}
                />
              </div>
              <HistoryPanel
                open={historyPath !== null}
                projectId={project.id}
                path={historyPath ?? ''}
                onClose={() => setHistoryPath(null)}
                onRestored={handleRestored}
              />
            </div>
          ) : (
            <p className="p-6 text-sm text-muted-foreground/70">加载中…</p>
          )}
        </main>

        {!rightCollapsed && (
          <>
            <div onMouseDown={startDrag('right')} className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-indigo-500/40" />
            <aside className="shrink-0 border-l border-border bg-background" style={{ width: rightWidth }}>
              {project ? (
                <ChatPanel
                  ref={chatPanelRef}
                  projectId={project.id}
                  noteContext={noteContext}
                  onOpenSetup={() => setSetupOpen(true)}
                  model={model}
                  onModelChange={handleModelChange}
                  onAgentEnd={handleAgentEnd}
                />
              ) : null}
            </aside>
          </>
        )}
      </div>

      {project && (
        <SearchPalette open={searchOpen} projectId={project.id} onClose={() => setSearchOpen(false)} onSelect={openPath} />
      )}
      {project && <CommandRunner projectId={project.id} />}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onOpenSetup={() => { setSettingsOpen(false); setSetupOpen(true) }} notesDir={project?.path} />
      <SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} onConfigured={handleModelChange} />
    </div>
  )
}
