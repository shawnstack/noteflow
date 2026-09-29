import { useEffect, useRef, useState } from 'react'
import { FileText, Search, TextSearch } from 'lucide-react'
import { searchContent, searchFileNames, type GrepMatch } from '../lib/api'
import type { WorkspaceEntry } from '../lib/types'

type Mode = 'files' | 'content'

type Props = {
  open: boolean
  projectId: string
  onClose: () => void
  onSelect: (path: string) => void
}

export function SearchPalette({ open, projectId, onClose, onSelect }: Props) {
  const [mode, setMode] = useState<Mode>('files')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<WorkspaceEntry[]>([])
  const [matches, setMatches] = useState<GrepMatch[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQuery('')
      setFiles([])
      setMatches([])
      setSearched(false)
      setMode('files')
      setSelectedIndex(0)
    }
  }, [open])

  // 防抖搜索
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setFiles([])
      setMatches([])
      setSearched(false)
      setSelectedIndex(0)
      return
    }
    setLoading(true)
    setSearched(false)
    setSelectedIndex(0)
    const timer = window.setTimeout(async () => {
      try {
        if (mode === 'files') {
          setFiles(await searchFileNames(projectId, trimmed))
        } else {
          setMatches(await searchContent(projectId, trimmed))
        }
      } catch {
        setFiles([])
        setMatches([])
      } finally {
        setLoading(false)
        setSearched(true)
      }
    }, 260)
    return () => window.clearTimeout(timer)
  }, [open, query, mode, projectId])

  // 结果总数（键盘导航范围）
  const total = mode === 'files' ? files.length : matches.length

  const pathAt = (index: number): string | null => {
    if (mode === 'files') return files[index]?.type === 'file' ? files[index].path : files[index]?.path ?? null
    return matches[index]?.path ?? null
  }

  const pickIndex = (index: number) => {
    const path = pathAt(index)
    if (path) {
      onSelect(path)
      onClose()
    }
  }

  // 选中项滚动到可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
                if (total > 0) {
                  event.preventDefault()
                  setSelectedIndex((index) => (index + 1) % total)
                }
              } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
                if (total > 0) {
                  event.preventDefault()
                  setSelectedIndex((index) => (index - 1 + total) % total)
                }
              } else if (event.key === 'Enter') {
                pickIndex(selectedIndex)
              }
            }}
            placeholder={mode === 'files' ? '搜索文件名…（≥2 字符）' : '全文搜索内容…（≥2 字符）'}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex shrink-0 rounded-lg border border-border p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setMode('files')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 ${mode === 'files' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FileText className="size-3" />
              文件
            </button>
            <button
              type="button"
              onClick={() => setMode('content')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 ${mode === 'content' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <TextSearch className="size-3" />
              内容
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2" ref={listRef}>
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">搜索中…</p>}
          {!loading && query.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70">输入至少 2 个字符开始搜索 · ↑↓ 选择 · Enter 打开 · Esc 关闭</p>
          )}
          {!loading && searched && query.trim().length >= 2 && total === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70">没有匹配的{mode === 'files' ? '文件' : '内容'}</p>
          )}
          {!loading &&
            mode === 'files' &&
            files.map((entry, index) => (
              <button
                key={entry.path}
                type="button"
                data-index={index}
                onClick={() => pickIndex(index)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${
                  index === selectedIndex ? 'bg-accent text-foreground' : 'text-foreground hover:bg-muted'
                }`}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.path}</span>
              </button>
            ))}
          {!loading &&
            mode === 'content' &&
            matches.map((match, index) => (
              <button
                key={`${match.path}-${match.line}-${index}`}
                type="button"
                data-index={index}
                onClick={() => pickIndex(index)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left ${index === selectedIndex ? 'bg-accent' : 'hover:bg-muted'}`}
              >
                <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{match.path}</span>
                  {match.line !== null && <span className="shrink-0 text-[10px] text-muted-foreground/70">:{match.line}</span>}
                </span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{match.text}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
