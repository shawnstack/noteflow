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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQuery('')
      setFiles([])
      setMatches([])
      setSearched(false)
      setMode('files')
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
      return
    }
    setLoading(true)
    setSearched(false)
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

  if (!open) return null

  const pick = (path: string) => {
    onSelect(path)
    onClose()
  }

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
              if (event.key === 'Enter') {
                if (mode === 'files' && files[0]) pick(files[0].type === 'file' ? files[0].path : files[0].path)
                if (mode === 'content' && matches[0]) pick(matches[0].path)
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

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <p className="px-3 py-2 text-xs text-muted-foreground">搜索中…</p>}
          {!loading && query.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70">输入至少 2 个字符开始搜索 · Enter 打开第一条 · Esc 关闭</p>
          )}
          {!loading && searched && query.trim().length >= 2 && mode === 'files' && files.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70">没有匹配的文件</p>
          )}
          {!loading && searched && query.trim().length >= 2 && mode === 'content' && matches.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground/70">没有匹配的内容</p>
          )}
          {!loading &&
            mode === 'files' &&
            files.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => pick(entry.path)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted"
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
                onClick={() => pick(match.path)}
                className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-muted"
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
