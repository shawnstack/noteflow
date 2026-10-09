import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bold,
  BookOpen,
  Brackets,
  Code,
  Columns2,
  CornerDownRight,
  FilePlus2,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  Languages,
  Link2,
  List,
  ListOrdered,
  ListTree,
  MessageSquareText,
  Pencil,
  Quote,
  RotateCcw,
  Save,
  Sparkles,
  Table,
  Trash2,
  TriangleAlert,
  Type as TypeIcon,
  WandSparkles,
} from 'lucide-react'
import {
  readFileContent,
  readFileMeta,
  relativeAssetLink,
  searchContent,
  uploadImageAsset,
  writeFileContent,
} from '../lib/api'
import { extractWikiTargets, resolveWikiTarget, transformWikiLinks, wikiCompleteCandidates } from '../lib/wikilinks'
import { moveToTrash, renamePath, restoreFromTrash, TRASH_DIR } from '../lib/file-ops'
import { matchesShortcut, useShortcuts } from '../lib/shortcuts'
import { MarkdownReader } from './workspace/MarkdownReader'
import { CodeReader } from './workspace/CodeReader'
import { ImageReader } from './workspace/ImageReader'
import { HtmlReader } from './workspace/HtmlReader'
import { DocumentReader } from './workspace/DocumentReader'
import { isTextEditableKind, languageFromPath, languageFromShebangContent, refineFileKind, type FileKind } from '../lib/file-kind'
import { extractCodeSymbols } from '../lib/code-symbols'
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
  /** 未保存状态变化（标签栏圆点） */
  onDirtyChange?: (path: string, dirty: boolean) => void
  /** 选中文字 AI 操作：把构造好的 prompt 发到右侧对话 */
  onAskAi?: (prompt: string) => void
  /** 打开版本历史面板 */
  onOpenHistory?: (path: string) => void
  /** 编辑器写入了新素材文件（粘贴图片落盘）后通知宿主（刷新树 + git commit） */
  onFileCreated?: () => void
  /** 全部笔记路径（双链解析 / [[ 补全 / 反向链接） */
  noteList?: string[]
  /** 点击未创建的 wiki 目标：宿主负责确认后创建 */
  onOpenWiki?: (target: string) => void
  /** 直接打开一篇已有笔记（反向链接跳转） */
  onOpenPath?: (path: string) => void
  /** 最近一次 AI 回复全文（选中文字 AI → 替换回选区） */
  aiResult?: { text: string; at: number } | null
}

/** 选中文字 AI 操作类型 */
type AskAction = 'polish' | 'translate' | 'explain' | 'expand'

const DRAFT_PREFIX = 'noteflow.draft:'

/** 草稿 key 按项目隔离（多窗口/多项目互不串台） */
const draftKey = (projectId: string, path: string) => `${DRAFT_PREFIX}${projectId}:${path}`
/** 读取草稿：优先项目隔离 key，兼容旧版全局 key */
const readDraft = (projectId: string, path: string): string | null =>
  localStorage.getItem(draftKey(projectId, path)) ?? localStorage.getItem(DRAFT_PREFIX + path)
const writeDraft = (projectId: string, path: string, content: string) => {
  localStorage.setItem(draftKey(projectId, path), content)
  localStorage.removeItem(DRAFT_PREFIX + path) // 清理旧版全局 key
}
const clearDraft = (projectId: string, path: string) => {
  localStorage.removeItem(draftKey(projectId, path))
  localStorage.removeItem(DRAFT_PREFIX + path)
}

export function NoteEditor({ projectId, path, onSaved, onContentChange, onFileMoved, onDirtyChange, onAskAi, onOpenHistory, onFileCreated, noteList, onOpenWiki, onOpenPath, aiResult }: Props) {
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
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [wikiMenu, setWikiMenu] = useState<{ x: number; y: number; query: string; candidates: string[]; selected: number } | null>(null)
  const [backlinks, setBacklinks] = useState<{ path: string; line: number | null; text: string }[] | null>(null)
  const [backlinksOpen, setBacklinksOpen] = useState(true)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [pendingAi, setPendingAi] = useState<{ start: number; end: number; text: string; action: AskAction; at: number } | null>(null)
  /** 智能识别的文件类型（路径 + 内容嗅探，见 lib/file-kind.ts） */
  const [kind, setKind] = useState<FileKind>('markdown')
  const [fileSize, setFileSize] = useState<number | null>(null)
  const pathRef = useRef(path)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const charWidthRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  /** 最新编辑状态快照（path 切换时同步 flush 草稿，防 800ms 防抖窗口丢字） */
  const editStateRef = useRef<{ path: string; draft: string; dirty: boolean }>({ path: '', draft: '', dirty: false })
  /** 最近一次松开鼠标的位置（选中浮动菜单锚点） */
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const toast = useToast()
  const dialog = useDialog()
  const inTrash = path !== null && path.startsWith(`${TRASH_DIR}/`)
  /** 智能识别结果派生：文本类才提供编辑/分屏/保存；code 走 CodeReader + 符号大纲 */
  const canEdit = isTextEditableKind(kind)
  const isCodeKind = kind === 'code'

  const reload = useCallback(
    async (target: string) => {
      const data = await readFileContent(projectId, target)
      if (pathRef.current !== target) return
      setContent(data.content)
      setDraft(data.content)
      setLanguage(data.language || 'markdown')
      setSavedMtime(data.mtimeMs)
      setKind(refineFileKind(target, data.content))
      setFileSize(data.size)
      setIsNew(false)
      setExternalChanged(false)
      clearDraft(projectId, target)
      setDraftRestored(false)
    },
    [projectId],
  )

  // 切换文件 / 外部刷新时加载
  useEffect(() => {
    // 切走前把上一个文件的未保存草稿立即落盘（防抖 800ms 窗口内切换会丢最近输入）
    const prev = editStateRef.current
    if (prev.path && prev.path !== path && prev.dirty) {
      writeDraft(projectId, prev.path, prev.draft)
    }
    editStateRef.current = { path: path ?? '', draft: '', dirty: false }
    pathRef.current = path
    setDirty(false)
    setSavedMtime(null)
    setExternalChanged(false)
    setDraftRestored(false)
    setPendingAi(null)
    setWikiMenu(null)
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
        const nextKind = refineFileKind(path, data.content)
        setKind(nextKind)
        setFileSize(data.size)
        setIsNew(false)
        // 崩溃草稿恢复
        const saved = readDraft(projectId, path)
        if (saved !== null && saved !== data.content) {
          setDraft(saved)
          setDirty(true)
          setDraftRestored(true)
          setMode('edit')
        } else {
          setDraft(data.content)
          clearDraft(projectId, path)
        }
      })
      .catch(() => {
        if (cancelled) return
        // 文件尚不存在（新建流程）：进入空白编辑态（仅文本类，文档/二进制锁定阅读）
        setContent('')
        setDraft('')
        const nextKind = refineFileKind(path, '')
        setKind(nextKind)
        setFileSize(null)
        setIsNew(true)
        setMode(isTextEditableKind(nextKind) ? 'edit' : 'read')
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
      clearDraft(projectId, path)
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

  // 保存快捷键（设置中可自定义）
  const shortcuts = useShortcuts()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, shortcuts.save)) {
        if (!dirty) return
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcuts, save, dirty])

  // 草稿防抖持久化（崩溃保护）
  useEffect(() => {
    if (!path || !dirty) return
    const timer = window.setTimeout(() => {
      writeDraft(projectId, path, draft)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [projectId, path, draft, dirty])

  // 编辑状态快照同步（仅当前文件；path 切换期间不串档）+ 未保存状态上报（标签栏圆点）
  useEffect(() => {
    if (editStateRef.current.path === (path ?? '')) {
      editStateRef.current = { path: path ?? '', draft, dirty }
    }
    if (path) onDirtyChange?.(path, dirty)
  }, [path, draft, dirty, onDirtyChange])

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

  // 版本回滚后立即重载该文件（App 派发 noteflow:file-restored）
  useEffect(() => {
    const onRestored = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail
      if (detail && detail.path === pathRef.current) void reload(detail.path)
    }
    window.addEventListener('noteflow:file-restored', onRestored)
    return () => window.removeEventListener('noteflow:file-restored', onRestored)
  }, [reload])

  const updateDraft = (value: string) => {
    setDraft(value)
    setDirty(value !== content)
  }

  /* ---------- 当前文件操作（重命名 / 回收站 / 恢复，逻辑与文件树右键菜单共用 lib/file-ops） ---------- */
  const renameFile = async () => {
    if (!path) return
    const oldName = path.split('/').pop() ?? path
    const name = await dialog.prompt({ title: '重命名', defaultValue: oldName, confirmText: '重命名' })
    if (!name || !name.trim() || name.trim() === oldName) return
    try {
      const target = await renamePath(projectId, path, name)
      toast.success(`已重命名为 ${name.trim()}`)
      onFileMoved(target)
    } catch (error) {
      toast.error(`重命名失败：${error instanceof Error ? error.message : String(error)}`)
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
    try {
      await moveToTrash(projectId, path)
      toast.success('已移入回收站')
      onFileMoved(null)
    } catch (error) {
      toast.error(`移入回收站失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const restoreFile = async () => {
    if (!path) return
    try {
      const name = await restoreFromTrash(projectId, path)
      toast.success(`已恢复 ${name}`)
      onFileMoved(name)
    } catch (error) {
      toast.error(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
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

  /** 代码文件编辑增强：Tab/Shift+Tab 缩进、Enter 保持缩进（markdown 不劫持 Tab，保留焦点移动） */
  const handleCodeEditorKeys = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return
    const ta = event.currentTarget
    const { selectionStart: s, selectionEnd: e, value } = ta
    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1
        if (value.startsWith('\t', lineStart)) {
          const next = value.slice(0, lineStart) + value.slice(lineStart + 1)
          withSelection(next, Math.max(lineStart, s - 1), Math.max(lineStart, e - 1))
        } else if (value.startsWith('  ', lineStart)) {
          const next = value.slice(0, lineStart) + value.slice(lineStart + 2)
          withSelection(next, Math.max(lineStart, s - 2), Math.max(lineStart, e - 2))
        }
      } else {
        const next = `${value.slice(0, s)}  ${value.slice(Math.max(s, e))}`
        withSelection(next, s + 2, s + 2)
      }
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(lineStart, s))?.[0] ?? ''
      if (indent) {
        event.preventDefault()
        const insert = `\n${indent}`
        const next = `${value.slice(0, s)}${insert}${value.slice(Math.max(s, e))}`
        withSelection(next, s + insert.length, s + insert.length)
      }
    }
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

  /* ---------- 粘贴 / 拖入图片（落盘 assets/<年-月>/，插入相对链接） ---------- */
  const insertImageFile = async (file: Blob) => {
    if (!path) return
    const ext = (file.type.split('/')[1] || 'png').split('+')[0].toLowerCase()
    try {
      const assetPath = await uploadImageAsset(file, ext)
      insertBlock(`![图片](${relativeAssetLink(path, assetPath)})`)
      onFileCreated?.()
    } catch (err) {
      toast.error(`图片插入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!path) return
    const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    const file = imageItem?.getAsFile()
    if (!file) return
    event.preventDefault()
    void insertImageFile(file)
  }

  const handleDropImage = (event: React.DragEvent<HTMLTextAreaElement>) => {
    if (!path) return
    const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void insertImageFile(file)
  }

  /* ---------- 选中文字 → AI 操作（浮动菜单，结果发右侧对话） ---------- */
  const updateAiMenu = () => {
    const ta = textareaRef.current
    if (!ta || !onAskAi) {
      setAiMenu(null)
      return
    }
    const { selectionStart: s, selectionEnd: e, value } = ta
    const text = s === e ? '' : value.slice(s, e)
    if (text.trim().length < 2 || text.length > 20000) {
      setAiMenu(null)
      return
    }
    const pos = lastPointerRef.current
    setAiMenu({ x: pos?.x ?? 320, y: pos?.y ?? 160, text })
  }

  const askAi = (action: AskAction) => {
    if (!aiMenu) return
    const ta = textareaRef.current
    const text = aiMenu.text
    const start = ta ? ta.selectionStart : 0
    const end = ta ? ta.selectionEnd : 0
    setAiMenu(null)
    setPendingAi({ start, end, text, action, at: Date.now() })
    const wrapped = `\`\`\`\n${text}\n\`\`\``
    const prompts: Record<AskAction, string> = {
      polish: `请润色下面选中的文字，保持原意与语言不变，直接输出润色后的正文，不要任何解释或前后缀：\n\n${wrapped}`,
      translate: `请将下面选中的文字翻译成中文（若本来就是中文则翻译成英文），直接输出译文正文，不要任何解释：\n\n${wrapped}`,
      explain: `请解释下面选中的文字的含义/背景/要点，简洁明了：\n\n${wrapped}`,
      expand: `请扩写下面选中的文字，保持原有风格与语境，直接输出扩写后的正文，不要任何解释：\n\n${wrapped}`,
    }
    onAskAi?.(prompts[action])
  }

  /* ---------- AI 结果应用回选区（选中文字 AI 的闭环） ---------- */
  const lastAi = aiResult ?? null
  const aiApplyReady = lastAi !== null && lastAi.text.trim().length > 0 && pendingAi !== null && lastAi.at > pendingAi.at
  const aiReplaceValid = aiApplyReady && pendingAi !== null && draft.slice(pendingAi.start, pendingAi.end) === pendingAi.text

  const applyAiToSelection = (mode: 'replace' | 'insert') => {
    if (!lastAi || lastAi.text.trim().length === 0) return
    if (mode === 'replace' && pendingAi && aiReplaceValid) {
      const next = draft.slice(0, pendingAi.start) + lastAi.text + draft.slice(pendingAi.end)
      withSelection(next, pendingAi.start, pendingAi.start + lastAi.text.length)
    } else {
      const ta = textareaRef.current
      const at = ta ? ta.selectionStart : draft.length
      const next = `${draft.slice(0, at)}${lastAi.text}\n${draft.slice(at)}`
      withSelection(next, at + lastAi.text.length, at + lastAi.text.length)
    }
    setPendingAi(null)
  }

  /* ---------- 双链：[[ 自动补全 ---------- */
  const monoCharWidth = (): number => {
    if (charWidthRef.current !== null) return charWidthRef.current
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return 8
    ctx.font = '13.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    charWidthRef.current = ctx.measureText('0'.repeat(50)).width / 50
    return charWidthRef.current
  }

  const updateWikiMenu = useCallback(() => {
    const ta = textareaRef.current
    if (!ta || !noteList || noteList.length === 0 || document.activeElement !== ta) {
      setWikiMenu(null)
      return
    }
    const caret = ta.selectionStart
    if (caret !== ta.selectionEnd) {
      setWikiMenu(null)
      return
    }
    const before = ta.value.slice(0, caret)
    const open = before.lastIndexOf('[[')
    if (open === -1) {
      setWikiMenu(null)
      return
    }
    const segment = before.slice(open + 2)
    if (segment.includes(']]') || segment.includes('\n') || segment.length > 48) {
      setWikiMenu(null)
      return
    }
    const candidates = wikiCompleteCandidates(segment, noteList)
    if (candidates.length === 0) {
      setWikiMenu(null)
      return
    }
    // 估算光标位置（等宽字体），补全弹层锚点
    let line = 0
    let lastBreak = 0
    for (let i = 0; i < caret; i++) {
      if (before.charCodeAt(i) === 10) {
        line++
        lastBreak = i + 1
      }
    }
    const col = Math.min(caret - lastBreak, 80)
    const rect = ta.getBoundingClientRect()
    setWikiMenu({
      x: Math.max(rect.left + 8, Math.min(rect.left + 24 + col * monoCharWidth(), window.innerWidth - 280)),
      y: rect.top + 24 + (line + 1) * 28 - ta.scrollTop,
      query: segment,
      candidates,
      selected: 0,
    })
  }, [noteList])

  const applyWikiComplete = (notePath: string) => {
    const ta = textareaRef.current
    const menu = wikiMenu
    if (!ta || !menu) return
    const caret = ta.selectionStart
    const open = ta.value.slice(0, caret).lastIndexOf('[[')
    if (open === -1) {
      setWikiMenu(null)
      return
    }
    const base = notePath.replace(/\.(md|markdown)$/i, '')
    const next = `${ta.value.slice(0, open)}[[${base}]] ${ta.value.slice(caret)}`
    setWikiMenu(null)
    const cursor = open + base.length + 5
    withSelection(next, cursor, cursor)
  }

  const insertWikiStub = () => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: s, value } = ta
    withSelection(`${value.slice(0, s)}[[]]${value.slice(s)}`, s + 2, s + 2)
    window.setTimeout(updateWikiMenu, 0)
  }

  /* ---------- 双链：阅读渲染（[[..]] → 链接）与点击 ---------- */
  const isMarkdownNote = path !== null && isMarkdown(path)

  const previewContent = useMemo(() => {
    const raw = draft || content
    return isMarkdownNote && noteList ? transformWikiLinks(raw, noteList) : raw
  }, [draft, content, isMarkdownNote, noteList])

  const handleOpenNoteLink = useCallback(
    (target: string, exists: boolean) => {
      if (exists) {
        const resolved = resolveWikiTarget(target, noteList ?? [])
        if (resolved) {
          onOpenPath?.(resolved)
          return
        }
      }
      onOpenWiki?.(target)
    },
    [noteList, onOpenPath, onOpenWiki],
  )

  /* ---------- 反向链接（谁引用了当前笔记） ---------- */
  const noteBaseName = path !== null && isMarkdown(path) ? (path.split('/').pop() ?? '').replace(/\.(md|markdown)$/i, '') : ''

  useEffect(() => {
    if (!noteBaseName || inTrash) {
      setBacklinks(null)
      return
    }
    let cancelled = false
    setBacklinks(null)
    const timer = window.setTimeout(async () => {
      try {
        const matches = await searchContent(projectId, noteBaseName)
        if (cancelled) return
        const hits: { path: string; line: number | null; text: string }[] = []
        for (const match of matches) {
          if (match.path === path || match.path.startsWith('.trash/')) continue
          const targets = extractWikiTargets(match.text)
          if (targets.length === 0) continue
          const refers = targets.some((target) => resolveWikiTarget(target, noteList ?? []) === path)
          if (refers) hits.push(match)
        }
        if (!cancelled) setBacklinks(hits.slice(0, 20))
      } catch {
        /* 搜索失败静默（反链面板非关键路径） */
      }
    }, 450)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // content：仅在保存/重载后变化，避免每次击键都全文搜索
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, path, inTrash, noteBaseName, noteList, content])

  /* ---------- 大纲（H1-H3 导航） ---------- */
  const outline = useMemo(() => {
    if (!isMarkdownNote) return []
    const items: { level: number; text: string }[] = []
    for (const line of (draft || content).split('\n')) {
      const match = /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
      if (match) items.push({ level: match[1].length, text: match[2].slice(0, 64) })
      if (items.length >= 120) break
    }
    return items
  }, [draft, content, isMarkdownNote])

  const scrollToHeading = (index: number) => {
    const container = previewRef.current
    if (!container) return
    const headings = container.querySelectorAll('article h1, article h2, article h3')
    headings[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* ---------- 代码文件：符号大纲 + 阅读语言 ---------- */
  const codeLanguage = useMemo(() => {
    if (language && language !== 'plaintext') return language
    return languageFromPath(path ?? '') ?? languageFromShebangContent(content) ?? 'plaintext'
  }, [language, path, content])

  const codeSymbols = useMemo(
    () => (isCodeKind ? extractCodeSymbols(draft || content, codeLanguage) : []),
    [isCodeKind, draft, content, codeLanguage],
  )

  const scrollToCodeLine = (line: number) => {
    previewRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 非文本类（图片/文档/二进制）锁定阅读模式（按钮也已隐藏，此处兜底切换残留状态）
  useEffect(() => {
    if (!canEdit && mode !== 'read') setMode('read')
  }, [canEdit, mode])

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
  const lineCount = isCodeKind || kind === 'html' ? (draft || content).split('\n').length : 0
  /** 状态区文案：md=字数，代码/HTML=行数(·语言)，其余=文件大小 */
  const statsLabel =
    isCodeKind || kind === 'html'
      ? lineCount > 0
        ? `${lineCount} 行${isCodeKind && codeLanguage !== 'plaintext' ? ` · ${codeLanguage}` : ''}`
        : '已保存'
      : kind === 'markdown'
        ? words > 0
          ? `${words} 字`
          : '已保存'
        : fileSize !== null
          ? formatBytes(fileSize)
          : '已保存'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={path}>
          {path}
        </span>
        {isNew && (
          <span className="shrink-0 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[11px] text-indigo-600 dark:text-indigo-300">
            <FilePlus2 className="mr-1 inline size-3" />
            新笔记
          </span>
        )}
        {draftRestored && <span className="shrink-0 text-[11px] text-amber-500 dark:text-amber-400">已恢复未保存草稿</span>}
        {dirty && !draftRestored && <span className="shrink-0 text-[11px] text-amber-500 dark:text-amber-400">未保存</span>}
        {!dirty && <span className="shrink-0 text-[11px] text-muted-foreground/70">{statsLabel}</span>}
        <div className="flex shrink-0 items-center gap-1">
          <ModeButton active={mode === 'read'} onClick={() => setMode('read')} title="阅读" icon={<BookOpen className="size-4" />} />
          {canEdit && <ModeButton active={mode === 'edit'} onClick={() => setMode('edit')} title="编辑" icon={<Pencil className="size-4" />} />}
          {canEdit && <ModeButton active={mode === 'split'} onClick={() => setMode('split')} title="分屏" icon={<Columns2 className="size-4" />} />}
          {(isMarkdownNote || isCodeKind) && (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              <ModeButton
                active={outlineOpen}
                onClick={() => setOutlineOpen((v) => !v)}
                title={isMarkdownNote ? '大纲导航' : '符号大纲'}
                icon={<ListTree className="size-4" />}
              />
            </>
          )}
          <span className="mx-1 h-4 w-px bg-border" />
          {!inTrash && <ModeButton active={false} onClick={() => path && onOpenHistory?.(path)} title="版本历史" icon={<History className="size-4" />} />}
          {inTrash ? (
            <ModeButton active={false} onClick={() => void restoreFile()} title="从回收站恢复" icon={<RotateCcw className="size-4" />} />
          ) : (
            <>
              <ModeButton active={false} onClick={() => void renameFile()} title="重命名" icon={<TypeIcon className="size-4" />} />
              <ModeButton active={false} onClick={() => void trashFile()} title="移入回收站" icon={<Trash2 className="size-4" />} />
            </>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="ml-2 flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="size-3.5" />
              {saving ? '保存中…' : '保存'}
            </button>
          )}
        </div>
      </div>

      {/* 编辑工具栏（仅 markdown 的编辑/分屏模式） */}
      {mode !== 'read' && isMarkdownNote && (
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
          <ToolButton title="双链笔记：[[笔记名]]（弹出补全）" onClick={() => insertWikiStub()}>
            <Brackets className="size-4" />
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

      {error && <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">{error}</p>}
      {aiApplyReady && (
        <div className="flex items-center gap-2 border-b border-indigo-500/40 bg-indigo-500/10 px-4 py-1.5 text-xs text-indigo-600 dark:text-indigo-300">
          <WandSparkles className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={lastAi?.text}>
            AI 已回复「{lastAi?.text.replace(/\s+/g, ' ').slice(0, 48)}…」，要应用到选区吗？
          </span>
          <button
            type="button"
            disabled={!aiReplaceValid}
            title={aiReplaceValid ? '用 AI 结果替换原选中文字' : '原文已改动，无法安全替换，可改用插入'}
            onClick={() => applyAiToSelection('replace')}
            className="shrink-0 rounded border border-indigo-500/50 px-2 py-0.5 hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-indigo-400/50"
          >
            替换选区
          </button>
          <button
            type="button"
            onClick={() => applyAiToSelection('insert')}
            className="shrink-0 rounded border border-border px-2 py-0.5 hover:bg-muted"
          >
            插入光标处
          </button>
          <button type="button" onClick={() => setPendingAi(null)} className="shrink-0 rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted">
            忽略
          </button>
        </div>
      )}
      {externalChanged && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">文件已被 AI 或外部程序修改</span>
          <button type="button" onClick={() => void reload(path).then(() => toast.info('已加载最新版本'))} className="shrink-0 rounded border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/15 dark:border-amber-700 dark:hover:bg-amber-900/40">
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
                onChange={(event) => {
                  updateDraft(event.target.value)
                  if (!composingRef.current) window.setTimeout(updateWikiMenu, 0)
                }}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={() => {
                  composingRef.current = false
                }}
                onKeyDown={(event) => {
                  if (wikiMenu && wikiMenu.candidates.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setWikiMenu((menu) => (menu ? { ...menu, selected: (menu.selected + 1) % menu.candidates.length } : menu))
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setWikiMenu((menu) => (menu ? { ...menu, selected: (menu.selected - 1 + menu.candidates.length) % menu.candidates.length } : menu))
                      return
                    }
                    if (event.key === 'Enter' || event.key === 'Tab') {
                      event.preventDefault()
                      applyWikiComplete(wikiMenu.candidates[wikiMenu.selected])
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setWikiMenu(null)
                      return
                    }
                  } else if (!isMarkdownNote && canEdit) {
                    handleCodeEditorKeys(event)
                  }
                }}
                onPaste={handlePaste}
                onDrop={handleDropImage}
                onDragOver={(event) => {
                  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
                }}
                onMouseDown={() => {
                  setAiMenu(null)
                  setWikiMenu(null)
                }}
                onMouseUp={(event) => {
                  lastPointerRef.current = { x: event.clientX, y: event.clientY }
                  window.setTimeout(updateAiMenu, 0)
                }}
                onKeyUp={(event) => {
                  if (event.shiftKey || event.key === 'Escape') updateAiMenu()
                  if (!composingRef.current && !['Shift', 'Meta', 'Alt', 'Control'].includes(event.key)) {
                    window.setTimeout(updateWikiMenu, 0)
                  }
                }}
                onScroll={() => {
                  setAiMenu(null)
                  setWikiMenu(null)
                }}
                onBlur={() => window.setTimeout(() => setWikiMenu(null), 120)}
                spellCheck={false}
                placeholder={isMarkdownNote ? '# 开始书写…' : ''}
                className={`h-full w-full resize-none bg-transparent p-6 font-mono text-[13.5px] leading-7 text-foreground outline-none ${
                  mode === 'split' ? 'w-1/2 border-r border-border' : ''
                }`}
              />
            )}
            {mode !== 'edit' && (
              <div className={`relative flex h-full min-w-0 flex-col ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
                <div className="min-h-0 flex-1 overflow-y-auto" ref={previewRef}>
                  {kind === 'image' ? (
                    <ImageReader projectId={projectId} path={path} />
                  ) : kind === 'html' ? (
                    <HtmlReader projectId={projectId} path={path} />
                  ) : kind === 'pdf' || kind === 'docx' || kind === 'excel' ? (
                    <DocumentReader projectId={projectId} path={path} format={kind} />
                  ) : kind === 'binary' ? (
                    <BinaryNotice path={path} size={fileSize} />
                  ) : isCodeKind ? (
                    <CodeReader path={path} content={previewContent} language={codeLanguage} />
                  ) : kind === 'markdown' ? (
                    <MarkdownReader
                      projectId={projectId}
                      path={path}
                      content={previewContent}
                      language={language}
                      mode="preview"
                      onOpenNote={handleOpenNoteLink}
                    />
                  ) : (
                    <MarkdownReader
                      projectId={projectId}
                      path={path}
                      content={previewContent}
                      language={language}
                      mode="source"
                      onOpenNote={handleOpenNoteLink}
                    />
                  )}
                </div>

                {/* 大纲导航：markdown 标题树 / 代码符号树（点击滚动定位） */}
                {outlineOpen && isMarkdownNote && outline.length > 0 && (
                  <div className="absolute right-0 top-0 z-10 flex h-full w-56 flex-col border-l border-border bg-background/95 shadow-sm backdrop-blur">
                    <p className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">大纲</p>
                    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                      {outline.map((item, index) => (
                        <button
                          key={`${item.level}-${index}`}
                          type="button"
                          style={{ paddingLeft: (item.level - 1) * 12 + 6 }}
                          onClick={() => scrollToHeading(index)}
                          className="block w-full truncate rounded py-1 pr-2 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          title={item.text}
                        >
                          {item.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {outlineOpen && isCodeKind && codeSymbols.length > 0 && (
                  <div className="absolute right-0 top-0 z-10 flex h-full w-56 flex-col border-l border-border bg-background/95 shadow-sm backdrop-blur">
                    <p className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">符号大纲</p>
                    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                      {codeSymbols.map((symbol, index) => (
                        <button
                          key={`${symbol.kind}-${symbol.name}-${symbol.line}-${index}`}
                          type="button"
                          style={{ paddingLeft: (symbol.level - 1) * 12 + 6 }}
                          onClick={() => scrollToCodeLine(symbol.line)}
                          className="flex w-full items-baseline gap-1.5 truncate rounded py-1 pr-2 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          title={`${symbol.kind} · 第 ${symbol.line} 行`}
                        >
                          <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground/50">{symbolKindGlyph(symbol.kind)}</span>
                          <span className="truncate font-mono">{symbol.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 反向链接：列出引用当前笔记的其它笔记 */}
                {isMarkdownNote && !inTrash && backlinks !== null && backlinks.length > 0 && (
                  <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border bg-muted/30 px-6 py-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => setBacklinksOpen((open) => !open)}
                      className="flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <CornerDownRight className="size-3 shrink-0" />
                      <span className="truncate">
                        反向链接 · {backlinks.length} 篇笔记引用了「{noteBaseName}」
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{backlinksOpen ? '收起 ▲' : '展开 ▼'}</span>
                    </button>
                    {backlinksOpen && (
                      <div className="mt-1.5 space-y-0.5">
                        {backlinks.map((item, index) => (
                          <button
                            key={`${item.path}-${item.line}-${index}`}
                            type="button"
                            onClick={() => onOpenPath?.(item.path)}
                            className="block w-full rounded px-2 py-1 text-left hover:bg-muted"
                            title={item.text}
                          >
                            <span className="text-foreground">{item.path}</span>
                            {item.line !== null && <span className="ml-1 text-[10px] text-muted-foreground/70">:{item.line}</span>}
                            <p className="truncate text-[11px] text-muted-foreground">{item.text.trim().slice(0, 88)}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 选中文字 AI 浮动菜单（fixed 定位跟随选区松开位置） */}
      {aiMenu && onAskAi && mode !== 'read' && (
        <div
          role="toolbar"
          style={{
            left: Math.max(8, Math.min(aiMenu.x - 160, window.innerWidth - 336)),
            top: aiMenu.y > 96 ? aiMenu.y - 88 : aiMenu.y + 28,
          }}
          className="fixed z-[90] w-80 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <p className="truncate px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground" title={aiMenu.text}>
            已选中：{aiMenu.text.replace(/\s+/g, ' ').slice(0, 60)}
            {aiMenu.text.length > 60 ? '…' : ''}
          </p>
          <div className="flex items-center gap-0.5">
            <AiMenuButton title="润色选中文字，结果发到右侧对话" icon={<WandSparkles className="size-3.5" />} label="润色" onClick={() => askAi('polish')} />
            <AiMenuButton title="翻译（中↔英自动判断）" icon={<Languages className="size-3.5" />} label="翻译" onClick={() => askAi('translate')} />
            <AiMenuButton title="解释含义" icon={<MessageSquareText className="size-3.5" />} label="解释" onClick={() => askAi('explain')} />
            <AiMenuButton title="扩写" icon={<Sparkles className="size-3.5" />} label="扩写" onClick={() => askAi('expand')} />
          </div>
        </div>
      )}
      {/* 双链 [[ 自动补全（等宽字体估算光标位置） */}
      {wikiMenu && wikiMenu.candidates.length > 0 && (
        <div
          style={{
            left: wikiMenu.x,
            top: Math.min(wikiMenu.y + 4, window.innerHeight - 236),
          }}
          className="fixed z-[95] w-64 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted-foreground">链接到笔记 · ↑↓ 选择 · Enter 插入</p>
          {wikiMenu.candidates.map((candidate, index) => {
            const base = candidate.split('/').pop() ?? candidate
            const dir = candidate.includes('/') ? candidate.slice(0, candidate.lastIndexOf('/')) : ''
            return (
              <button
                key={candidate}
                type="button"
                onMouseEnter={() => setWikiMenu((menu) => (menu && menu.selected !== index ? { ...menu, selected: index } : menu))}
                onMouseDown={(event) => {
                  event.preventDefault()
                  applyWikiComplete(candidate)
                }}
                className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-[12.5px] ${
                  wikiMenu.selected === index ? 'bg-accent text-foreground' : 'text-foreground hover:bg-muted'
                }`}
              >
                <span className="truncate">{base.replace(/\.(md|markdown)$/i, '')}</span>
                {dir && <span className="truncate text-[10.5px] text-muted-foreground/80">{dir}/</span>}
              </button>
            )
          })}
        </div>
      )}
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

function AiMenuButton({ title, icon, label, onClick }: { title: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
    >
      {icon}
      {label}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-muted" />
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** 符号大纲的紧凑字形（等宽、单字符宽度，避免挤占名称列）。 */
function symbolKindGlyph(kind: string): string {
  switch (kind) {
    case 'class':
      return 'C'
    case 'interface':
      return 'I'
    case 'type':
      return 'T'
    case 'enum':
      return 'E'
    case 'struct':
      return 'S'
    case 'trait':
      return 'R'
    case 'variable':
      return 'V'
    case 'method':
      return 'M'
    case 'table':
      return 'TB'
    case 'view':
      return 'VW'
    case 'rule':
      return '{ }'
    default:
      return 'ƒ'
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** 二进制文件占位卡：内容嗅探判定为 binary 时中栏不渲染乱码文本。 */
function BinaryNotice({ path, size }: { path: string; size: number | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <TriangleAlert className="size-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">二进制文件，暂不支持预览</p>
      <p className="break-all text-xs text-muted-foreground/60">
        {path}
        {size !== null ? ` · ${formatBytes(size)}` : ''}
      </p>
      <p className="text-xs text-muted-foreground/50">可通过上方按钮重命名或移入回收站；文本编辑请先转换为文本格式。</p>
    </div>
  )
}
