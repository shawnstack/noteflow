import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarCheck, Feather, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Search, Settings2, Unplug } from 'lucide-react'
import { activateProject, getActiveModel, getProjectBundle, listNotePaths, readFileMeta, registerProjectPath, removeProject as removeProjectApi, selectProjectDirectory, writeFileContent } from './lib/api'
import { initTheme } from './lib/theme'
import { getDesktopBridge, openProjectInNewWindow } from './lib/desktop'
import type { ModelLike, ProjectInfo } from './lib/types'
import { ensureGitRepo, gitAutoCommit } from './lib/git-history'
import { resolveWikiTarget } from './lib/wikilinks'
import { formatShortcut, matchesShortcut, useShortcuts } from './lib/shortcuts'
import { FileTree } from './components/FileTree'
import { NoteEditor } from './components/NoteEditor'
import { ChatPanel, type ChatPanelHandle } from './components/ChatPanel'
import { SetupDialog } from './components/SetupDialog'
import { SettingsDialog, initPersistedSettings } from './components/SettingsDialog'
import { CommandRunner } from './components/CommandRunner'
import { SearchPalette } from './components/SearchPalette'
import { TabBar } from './components/TabBar'
import { HistoryPanel } from './components/HistoryPanel'
import { ProjectPicker } from './components/ProjectPicker'
import { WindowButtons } from './components/WindowButtons'
import { useDialog } from './components/Dialog'
import { showPathDialog } from './components/ui/path-dialog'
import { useToast } from './components/Toast'

const LEFT_MIN = 180
const LEFT_MAX = 440
const RIGHT_MIN = 300
const RIGHT_MAX = 620

/** 多标签页持久化（重启后恢复打开的笔记）。key 按项目隔离：多窗口/多项目互不串台 */
const TABS_KEY_PREFIX = 'noteflow.openTabs'
const ACTIVE_TAB_KEY_PREFIX = 'noteflow.activeTab'
/** 旧版单项目时代的 key（读取兼容，写入一律走带项目后缀的新 key） */
const LEGACY_TABS_KEY = 'noteflow.openTabs'
const LEGACY_ACTIVE_TAB_KEY = 'noteflow.activeTab'
const MAX_RESTORE_TABS = 12

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
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
  const toast = useToast()

  /** 本窗口绑定的项目（多窗口：一窗口一项目；切换即重置本窗口工作区状态） */
  const tabsKey = project ? `${TABS_KEY_PREFIX}:${project.id}` : null
  const activeTabKey = project ? `${ACTIVE_TAB_KEY_PREFIX}:${project.id}` : null

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
        const [bundle, activeModel] = await Promise.all([getProjectBundle(), getActiveModel()])
        if (cancelled) return
        if (!bundle.project || bundle.projects.length === 0) {
          setBootError('未找到激活的笔记项目，请确认 NoteFlow 服务（server.mjs）已启动')
          return
        }
        // 多窗口：Electron 新窗口通过 ?project=<id> 绑定项目；无参数时用全局激活项目
        const wanted = new URLSearchParams(window.location.search).get('project')
        const chosen = (wanted && bundle.projects.find((p) => p.id === wanted)) || bundle.project
        setProjects(bundle.projects)
        setProject(chosen)
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

  // 打开的标签与激活页持久化（key 按项目隔离；切换项目瞬间由恢复流程接管，避免误清新项目的已存标签）
  const suppressPersistRef = useRef(false)
  useEffect(() => {
    if (!tabsKey || suppressPersistRef.current) return
    if (tabs.length) localStorage.setItem(tabsKey, JSON.stringify(tabs))
    else localStorage.removeItem(tabsKey)
  }, [tabs, tabsKey])
  useEffect(() => {
    if (!activeTabKey || suppressPersistRef.current) return
    if (selectedPath) localStorage.setItem(activeTabKey, selectedPath)
    else localStorage.removeItem(activeTabKey)
  }, [selectedPath, activeTabKey])

  // 项目就绪后：初始化 git 仓库 + 恢复该项目的标签页（校验文件仍存在；每个项目恢复一次）
  const restoredProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (!project || restoredProjectRef.current === project.id) return
    restoredProjectRef.current = project.id
    suppressPersistRef.current = true
    void ensureGitRepo(project.id).catch(() => {})
    void (async () => {
      const key = `${TABS_KEY_PREFIX}:${project.id}`
      // 旧版单项目 key 兼容：无新 key 时回退读取一次，随即清理（避免别的项目误恢复）
      let raw = localStorage.getItem(key)
      if (raw === null && localStorage.getItem(LEGACY_TABS_KEY) !== null) {
        raw = localStorage.getItem(LEGACY_TABS_KEY)
        localStorage.removeItem(LEGACY_TABS_KEY)
        localStorage.removeItem(LEGACY_ACTIVE_TAB_KEY)
      }
      const alive: string[] = []
      if (raw) {
        let paths: unknown
        try {
          paths = JSON.parse(raw)
        } catch {
          paths = null
        }
        if (Array.isArray(paths)) {
          for (const path of paths.slice(0, MAX_RESTORE_TABS)) {
            if (typeof path !== 'string') continue
            if (await readFileMeta(project.id, path).then(() => true).catch(() => false)) alive.push(path)
          }
        }
      }
      if (alive.length > 0) {
        const active = localStorage.getItem(`${ACTIVE_TAB_KEY_PREFIX}:${project.id}`)
        setTabs(alive)
        setSelectedPath(alive.includes(active ?? '') ? (active as string) : alive[alive.length - 1])
      } else {
        setTabs([])
        setSelectedPath(null)
      }
      // 右键“打开方式”冷启动：URL 带 ?file=<相对路径>，恢复流程完成后定位到该文件
      const urlFile = new URLSearchParams(window.location.search).get('file')
      if (urlFile) {
        openPath(urlFile)
        // 用完即从地址栏移除，刷新/重载不重复打开
        const url = new URL(window.location.href)
        url.searchParams.delete('file')
        history.replaceState(null, '', url)
      }
      suppressPersistRef.current = false
    })()
  }, [project])

  // 主进程推送“打开方式”文件（同项目窗口已开时二次右键打开，无需重载页面）
  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.onOpenFile) return
    return bridge.onOpenFile((relPath) => {
      if (typeof relPath === 'string' && relPath) openPath(relPath)
    })
  }, [openPath])

  /* ---------- 项目切换（一窗口一项目；切换即重置本窗口工作区，组件树按 key 重挂载） ---------- */
  const applyProject = useCallback((next: ProjectInfo, nextProjects?: ProjectInfo[]) => {
    // 挂起标签持久化直到恢复流程完成（否则本 effect 周期会先清掉新项目已存的标签）
    suppressPersistRef.current = true
    setTabs([])
    setSelectedPath(null)
    setDirtyTabs({})
    setNoteList([])
    setHistoryPath(null)
    setAiResult(null)
    setSearchOpen(false)
    setTreeVersion((v) => v + 1)
    if (nextProjects) setProjects(nextProjects)
    setProject(next)
  }, [])

  const switchProject = useCallback(
    async (next: ProjectInfo) => {
      if (next.id === projectRef.current?.id) return
      if (Object.values(dirtyTabs).some(Boolean)) {
        const confirmed = await dialog.confirm({
          title: '切换项目',
          message: '当前有未保存的修改。切换项目会关闭这些标签页，内容已自动存为草稿，重新打开笔记可恢复。',
          confirmText: '切换',
        })
        if (!confirmed) return
      }
      try {
        const bundle = await activateProject(next.id)
        if (!bundle.project) throw new Error('项目不存在或目录已失效')
        applyProject(bundle.project, bundle.projects)
        toast.success(`已切换到「${next.name}」`)
      } catch (err) {
        toast.error(`切换项目失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [applyProject, dirtyTabs, dialog, toast],
  )

  /** 添加项目：对话框里粘贴/输入路径，或点「浏览…」走原生目录选择框；注册后当前窗口切入新项目 */
  const addProject = useCallback(async () => {
    const browse = async (): Promise<string | null> => {
      const bridge = getDesktopBridge()
      if (bridge?.selectDirectory) return bridge.selectDirectory()
      try {
        const res = await selectProjectDirectory()
        return res.cancelled || !res.project ? null : res.project.path
      } catch (err) {
        toast.error(`打开目录选择框失败：${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    }
    const dir = await showPathDialog({
      title: '添加项目',
      description: '输入或粘贴本地文件夹的完整路径，回车即可添加。',
      placeholder: 'D:\\notes\\我的项目',
      confirmLabel: '添加',
      browse,
    })
    if (!dir) return
    try {
      const bundle = await registerProjectPath(dir)
      if (!bundle.project) throw new Error('注册项目失败')
      applyProject(bundle.project, bundle.projects)
      toast.success(`已添加项目「${bundle.project.name}」`)
    } catch (err) {
      toast.error(`添加项目失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [applyProject, toast])

  /** 移除项目：仅从最近列表删除注册信息，不动磁盘文件；当前项目不可移除 */
  const removeProjectHandler = useCallback(
    async (target: ProjectInfo) => {
      const current = projectRef.current
      if (!current || current.id === target.id) return
      const confirmed = await dialog.confirm({
        title: '移除项目',
        message: `确定从列表移除「${target.name}」吗？\n${target.path}\n不会删除磁盘上的任何文件，之后可随时重新添加。`,
        confirmText: '移除',
      })
      if (!confirmed) return
      try {
        const bundle = await removeProjectApi(target.id)
        setProjects(bundle.projects)
        // 防御：若恰好是当前项目（多窗口场景被服务端切走），跟随服务端状态切换
        if (projectRef.current?.id === target.id && bundle.project) {
          applyProject(bundle.project, bundle.projects)
        }
        toast.success(`已移除「${target.name}」`)
      } catch (err) {
        toast.error(`移除项目失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [applyProject, dialog, toast],
  )

  /** 下拉打开时刷新最近项目列表（其他窗口的切换会更新 lastOpenedAt） */
  const refreshProjects = useCallback(async () => {
    try {
      setProjects((await getProjectBundle()).projects)
    } catch {
      /* 忽略：保留当前列表 */
    }
  }, [])

  // 窗口标题跟随项目；URL 同步 ?project= 参数（刷新/新窗口保持绑定）
  useEffect(() => {
    if (!project) return
    const title = `${project.name} — NoteFlow`
    document.title = title
    getDesktopBridge()?.setWindowTitle?.(title)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('project', project.id)
      window.history.replaceState(null, '', url)
    } catch {
      /* URL 异常环境仅影响刷新后的项目记忆 */
    }
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

  /* ---------- 快捷键（设置中可自定义） ---------- */
  const shortcuts = useShortcuts()
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
      if (matchesShortcut(event, shortcuts.search)) {
        event.preventDefault()
        setSearchOpen(true)
      } else if (matchesShortcut(event, shortcuts.newNote)) {
        event.preventDefault()
        void createNote()
      } else if (matchesShortcut(event, shortcuts.closeTab)) {
        // 浏览器可能不允许网页拦截 ⌘W，尽力而为（标签 × / 中键始终可用）
        const active = selectedPathRef.current
        if (active) {
          event.preventDefault()
          closeTab(active)
        }
      } else if (matchesShortcut(event, shortcuts.dailyNote)) {
        // 每日笔记（浏览器 ⌘D 收藏可被 preventDefault 拦截时优先本应用）
        event.preventDefault()
        void openTodayNote()
      } else if (event.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcuts, createNote, closeTab, openTodayNote])

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
          <ProjectPicker
            current={project}
            projects={projects}
            onSelect={(next) => void switchProject(next)}
            onOpenInWindow={openProjectInNewWindow}
            onAdd={() => void addProject()}
            onRemove={(target) => void removeProjectHandler(target)}
            onMenuOpen={() => void refreshProjects()}
          />
        )}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ml-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground hover:border-border hover:text-foreground"
        >
          <Search className="size-3.5" />
          搜索
          <kbd className="rounded border border-border px-1 text-[10px] text-muted-foreground/70">{formatShortcut(shortcuts.search)}</kbd>
        </button>
        <button
          type="button"
          onClick={() => void openTodayNote()}
          title={`打开今天的日记（不存在则按模板创建）· ${formatShortcut(shortcuts.dailyNote)}`}
          className="ml-1 flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground hover:border-border hover:text-foreground"
        >
          <CalendarCheck className="size-3.5" />
          今日
        </button>
        <span className="ml-auto flex items-center gap-1">
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
        <WindowButtons />
      </header>

      {/* 三栏主体（key=项目 id：切换项目时整体重挂载，文件树/编辑器/对话面板状态全部按项目重置） */}
      <div key={project?.id ?? 'booting'} className="flex min-h-0 flex-1">
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
