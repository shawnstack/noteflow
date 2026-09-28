import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bold,
  BookOpen,
  Code,
  Columns2,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  RotateCcw,
  Save,
  Table,
  Trash2,
  TriangleAlert,
  Type as TypeIcon,
} from 'lucide-react'
import {
  readFileContent,
  readFileMeta,
  runCommand,
  shQuote,
  writeFileContent,
} from '../lib/api'
import { MarkdownReader } from './workspace/MarkdownReader'
import { isBrowserPreviewablePath, workspacePreviewUrl } from './workspace/artifact-preview-utils'
import { useDialog } from './Dialog'
import { useToast } from './Toast'
import { countWords } from '../lib/types'

type Mode = 'read' | 'edit' | 'split'

type Props = {
  projectId: string
  path: string | null
  onSaved: (path: string) => void
  onContentChange: (path: string, content: string) => void
  /** 文件被重命名/移入回收站/恢复后通知宿主刷新树与选中态 */
  onFileMoved: (nextSelectedPath: string | null) => void
}

const DRAFT_PREFIX = 'noteflow.draft:'
const TRASH_DIR = '.trash'

export function NoteEditor({ projectId, path, onSaved, onContentChange, onFileMoved }: Props) {
  const [content, setContent] = useState('')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<Mode>('read')
  const [dirty, setDirty] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMtime, setSavedMtime] = useState<number | null>(null)
  const [externalChanged, setExternalChanged] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [language, setLanguage] = useState('markdown')
  const pathRef = useRef(path)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toast = useToast()
  const dialog = useDialog()
  const inTrash = path !== null && path.startsWith(`${TRASH_DIR}/`)

  const reload = useCallback(
    async (target: string) => {
      const data = await readFileContent(projectId, target)
      if (pathRef.current !== target) return
      setContent(data.content)
      setDraft(data.content)
      setLanguage(data.language || 'markdown')
      setSavedMtime(data.mtimeMs)
      setIsNew(false)
      setExternalChanged(false)
      localStorage.removeItem(DRAFT_PREFIX + target)
      setDraftRestored(false)
    },
    [projectId],
  )

  // 切换文件 / 外部刷新时加载
  useEffect(() => {
    pathRef.current = path
    setDirty(false)
    setSavedMtime(null)
    setExternalChanged(false)
    setDraftRestored(false)
    if (!path) {
      setContent('')
      setDraft('')
      setIsNew(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    readFileContent(projectId, path)
      .then(async (data) => {
        if (cancelled || pathRef.current !== path) return
        setContent(data.content)
        setSavedMtime(data.mtimeMs)
        setIsNew(false)
        // 崩溃草稿恢复
        const saved = localStorage.getItem(DRAFT_PREFIX + path)
        if (saved !== null && saved !== data.content) {
          setDraft(saved)
          setDirty(true)
          setDraftRestored(true)
          setMode('edit')
        } else {
          setDraft(data.content)
          localStorage.removeItem(DRAFT_PREFIX + path)
        }
      })
      .catch(() => {
        if (cancelled) return
        // 文件尚不存在（新建流程）：进入空白编辑态
        setContent('')
        setDraft('')
        setIsNew(true)
        setMode('edit')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, path])

  const save = useCallback(async () => {
    if (!path || saving) return
    setSaving(true)
    setError(null)
    try {
      await writeFileContent(projectId, path, draft)
      setContent(draft)
      setDirty(false)
      setIsNew(false)
      setDraftRestored(false)
      setExternalChanged(false)
      localStorage.removeItem(DRAFT_PREFIX + path)
      const meta = await readFileMeta(projectId, path).catch(() => null)
      if (meta && pathRef.current === path) setSavedMtime(meta.mtimeMs)
      toast.success(`已保存 ${path}`)
      onSaved(path)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [projectId, path, draft, saving, onSaved, toast])

  // Ctrl/Cmd + S 保存
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (!dirty) return
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, dirty])

  // 草稿防抖持久化（崩溃保护）
  useEffect(() => {
    if (!path || !dirty) return
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_PREFIX + path, draft)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [path, draft, dirty])

  // 外部变更检测（AI 可能修改了当前笔记）：无未保存修改时静默重载，有则提示
  useEffect(() => {
    if (!path || isNew) return
    let stopped = false
    const check = async () => {
      if (stopped || document.hidden) return
      if (pathRef.current !== path || savedMtime === null) return
      try {
        const meta = await readFileMeta(projectId, path)
        if (stopped || pathRef.current !== path || meta.mtimeMs === savedMtime) return
        if (!dirty) {
          await reload(path)
          toast.info(`${path} 已在外部更新，已重新加载`)
        } else {
          setExternalChanged(true)
        }
      } catch {
        // 网络抖动忽略
      }
    }
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void check(), 10_000)
    return () => {
      stopped = true
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [path, projectId, savedMtime, dirty, isNew, reload, toast])

  const updateDraft = (value: string) => {
    setDraft(value)
    setDirty(value !== content)
  }

  /* ---------- 当前文件操作（重命名 / 回收站 / 恢复） ---------- */
  const execFileCommand = async (label: string, command: string) => {
    try {
      const result = (await runCommand(projectId, command)) as { isError?: boolean; content?: string; error?: string }
      if (result && (result.isError || result.error)) {
        throw new Error(String(result.error || result.content || '命令执行失败'))
      }
      toast.success(label)
      return true
    } catch (error) {
      toast.error(`${label}失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const renameFile = async () => {
    if (!path) return
    const oldName = path.split('/').pop() ?? path
    const name = await dialog.prompt({ title: '重命名', defaultValue: oldName, confirmText: '重命名' })
    if (!name || !name.trim() || name.trim() === oldName) return
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const target = parent ? `${parent}/${name.trim()}` : name.trim()
    if (await execFileCommand(`已重命名为 ${name.trim()}`, `mv ${shQuote(path)} ${shQuote(target)}`)) {
      onFileMoved(target)
    }
  }

  const trashFile = async () => {
    if (!path) return
    const confirmed = await dialog.confirm({
      title: '移入回收站',
      message: `「${path.split('/').pop()}」将被移入 .trash/ 目录，可随时恢复。`,
      confirmText: '移入回收站',
      danger: true,
    })
    if (!confirmed) return
    const name = path.split('/').pop() ?? path
    if (await execFileCommand('已移入回收站', `mkdir -p ${shQuote(TRASH_DIR)} && mv ${shQuote(path)} ${shQuote(`${TRASH_DIR}/${name}`)}`)) {
      onFileMoved(null)
    }
  }

  const restoreFile = async () => {
    if (!path) return
    const name = path.split('/').pop() ?? path
    if (await execFileCommand(`已恢复 ${name}`, `mv ${shQuote(path)} ${shQuote(name)}`)) {
      onFileMoved(name)
    }
  }

  // 上报当前内容（供对话面板引用）
  useEffect(() => {
    if (path && !isNew) onContentChange(path, draft)
  }, [path, draft, isNew, onContentChange])

  /* ---------- 工具栏操作（基于 textarea 选区） ---------- */
  const withSelection = (next: string, selStart: number, selEnd: number) => {
    updateDraft(next)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(selStart, selEnd)
    })
  }

  const wrapSelection = (before: string, after = before) => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e, value } = ta
    const selected = value.slice(s, e)
    withSelection(`${value.slice(0, s)}${before}${selected}${after}${value.slice(e)}`, s + before.length, s + before.length + selected.length)
  }

  const prefixLines = (prefix: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e, value } = ta
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const lineEnd = e + (value.slice(e).indexOf('\n') === -1 ? value.length - e : value.slice(e).indexOf('\n'))
    const block = value.slice(lineStart, lineEnd)
    const prefixed = block
      .split('\n')
      .map((line, index) => (prefix === '1. ' ? `${index + 1}. ${line}` : `${prefix}${line}`))
      .join('\n')
    withSelection(`${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`, lineStart, lineStart + prefixed.length)
  }

  const insertBlock = (block: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: s, value } = ta
    const before = value.slice(0, s)
    const pad = before.endsWith('\n') || before === '' ? '' : '\n\n'
    withSelection(`${before}${pad}${block}${value.slice(s)}`, s + pad.length + block.length, s + pad.length + block.length)
  }

  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground/70">
        <BookOpen className="size-10" />
        <p className="text-sm">从左侧选择一篇笔记，或新建一篇开始书写</p>
        <p className="text-xs text-muted-foreground/60">Cmd+P 搜索 · Cmd+N 新建</p>
      </div>
    )
  }

  const words = countWords(draft)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={path}>
          {path}
        </span>
        {isNew && (
          <span className="shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[11px] text-indigo-300">
            <FilePlus2 className="mr-1 inline size-3" />
            新笔记
          </span>
        )}
        {draftRestored && <span className="shrink-0 text-[11px] text-amber-400">已恢复未保存草稿</span>}
        {dirty && !draftRestored && <span className="shrink-0 text-[11px] text-amber-400">未保存</span>}
        {!dirty && <span className="shrink-0 text-[11px] text-muted-foreground/70">{words > 0 ? `${words} 字` : '已保存'}</span>}
        <div className="flex shrink-0 items-center gap-1">
          <ModeButton active={mode === 'read'} onClick={() => setMode('read')} title="阅读" icon={<BookOpen className="size-4" />} />
          <ModeButton active={mode === 'edit'} onClick={() => setMode('edit')} title="编辑" icon={<Pencil className="size-4" />} />
          <ModeButton active={mode === 'split'} onClick={() => setMode('split')} title="分屏" icon={<Columns2 className="size-4" />} />
          <span className="mx-1 h-4 w-px bg-border" />
          {inTrash ? (
            <ModeButton active={false} onClick={() => void restoreFile()} title="从回收站恢复" icon={<RotateCcw className="size-4" />} />
          ) : (
            <>
              <ModeButton active={false} onClick={() => void renameFile()} title="重命名" icon={<TypeIcon className="size-4" />} />
              <ModeButton active={false} onClick={() => void trashFile()} title="移入回收站" icon={<Trash2 className="size-4" />} />
            </>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="ml-2 flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="size-3.5" />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* 编辑工具栏（仅编辑/分屏模式） */}
      {mode !== 'read' && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-1.5">
          <ToolButton title="标题 1" onClick={() => prefixLines('# ')}>
            <Heading1 className="size-4" />
          </ToolButton>
          <ToolButton title="标题 2" onClick={() => prefixLines('## ')}>
            <Heading2 className="size-4" />
          </ToolButton>
          <ToolButton title="标题 3" onClick={() => prefixLines('### ')}>
            <Heading3 className="size-4" />
          </ToolButton>
          <Divider />
          <ToolButton title="粗体" onClick={() => wrapSelection('**')}>
            <Bold className="size-4" />
          </ToolButton>
          <ToolButton title="斜体" onClick={() => wrapSelection('*')}>
            <Italic className="size-4" />
          </ToolButton>
          <ToolButton title="行内代码" onClick={() => wrapSelection('`')}>
            <Code className="size-4" />
          </ToolButton>
          <Divider />
          <ToolButton title="引用" onClick={() => prefixLines('> ')}>
            <Quote className="size-4" />
          </ToolButton>
          <ToolButton title="无序列表" onClick={() => prefixLines('- ')}>
            <List className="size-4" />
          </ToolButton>
          <ToolButton title="有序列表" onClick={() => prefixLines('1. ')}>
            <ListOrdered className="size-4" />
          </ToolButton>
          <Divider />
          <ToolButton title="链接" onClick={() => wrapSelection('[', '](https://)')}>
            <Link2 className="size-4" />
          </ToolButton>
          <ToolButton title="代码块" onClick={() => insertBlock('```\n\n```')}>
            <span className="font-mono text-[11px]">{'{ }'}</span>
          </ToolButton>
          <ToolButton title="表格" onClick={() => insertBlock('| 列1 | 列2 |\n| --- | --- |\n|  |  |')}>
            <Table className="size-4" />
          </ToolButton>
          <span className="ml-auto pr-1 text-[11px] text-muted-foreground/70">{words} 字</span>
        </div>
      )}

      {error && <p className="border-b border-red-900/50 bg-red-950/40 px-4 py-1.5 text-xs text-red-400">{error}</p>}
      {externalChanged && (
        <div className="flex items-center gap-2 border-b border-amber-900/50 bg-amber-950/30 px-4 py-1.5 text-xs text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">文件已被 AI 或外部程序修改</span>
          <button type="button" onClick={() => void reload(path).then(() => toast.info('已加载最新版本'))} className="shrink-0 rounded border border-amber-700 px-2 py-0.5 hover:bg-amber-900/40">
            加载最新
          </button>
          <button
            type="button"
            onClick={() => {
              setExternalChanged(false)
              readFileMeta(projectId, path).then((meta) => setSavedMtime(meta.mtimeMs)).catch(() => {})
            }}
            className="shrink-0 rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
          >
            保留我的版本
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground/70">加载中…</p>
        ) : (
          <div className="flex h-full">
            {mode !== 'read' && (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => updateDraft(event.target.value)}
                spellCheck={false}
                placeholder="# 开始书写…"
                className={`h-full w-full resize-none bg-transparent p-6 font-mono text-[13.5px] leading-7 text-foreground outline-none ${
                  mode === 'split' ? 'w-1/2 border-r border-border' : ''
                }`}
              />
            )}
            {mode !== 'edit' && (
              <div className={`h-full overflow-y-auto ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
                {isBrowserPreviewablePath(path) ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <img
                      src={workspacePreviewUrl(projectId, path)}
                      alt={path}
                      className="max-h-full max-w-full rounded-xl border border-border object-contain"
                    />
                  </div>
                ) : (
                  <MarkdownReader
                    projectId={projectId}
                    path={path}
                    content={draft || content}
                    language={language}
                    mode={isMarkdown(path) ? 'preview' : 'source'}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, title, icon }: { active: boolean; onClick: () => void; title: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded p-1.5 ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
    >
      {icon}
    </button>
  )
}

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-muted" />
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}
