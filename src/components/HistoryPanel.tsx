/**
 * 笔记版本历史（覆盖中栏的浮层）：
 * 左列该文件的 git 提交历史（打开时先把工作区变更自动 commit，保证版本完整），
 * 右侧展示选中版本相对父版本的 diff，支持一键回滚（git checkout <sha> -- path）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import { gitAutoCommit, listFileHistory, getRevisionDiff, restoreRevision, type HistoryEntry } from '../lib/git-history'
import { parseDiffRows, type DiffRow } from '../lib/diff-view'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

type Props = {
  open: boolean
  projectId: string
  path: string
  onClose: () => void
  /** 回滚成功后通知宿主（刷新编辑器与文件树） */
  onRestored: (path: string) => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function DiffLines({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="overflow-auto font-mono text-[12px] leading-6">
      {rows.map((row, index) =>
        row.kind === 'gap' ? (
          <div key={`gap-${index}`} className="select-none border-y border-border/60 bg-muted/30 px-3 py-0.5 text-center text-[11px] text-muted-foreground">
            {row.first ? `省略前 ${row.count} 行` : `⋯ 未变更的 ${row.count} 行 ⋯`}
          </div>
        ) : (
          <div
            key={`line-${index}`}
            className={`flex whitespace-pre-wrap break-all ${
              row.kind === 'add' ? 'bg-emerald-500/10' : row.kind === 'del' ? 'bg-destructive/10' : ''
            }`}
          >
            <span className="w-10 shrink-0 select-none pr-2 text-right text-[10px] text-muted-foreground/60">{row.oldNo ?? row.newNo ?? ''}</span>
            <span className={`w-3 shrink-0 select-none ${row.kind === 'add' ? 'text-emerald-600 dark:text-emerald-400' : row.kind === 'del' ? 'text-destructive' : 'text-muted-foreground/50'}`}>
              {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
            </span>
            <span className={`min-w-0 flex-1 pr-3 ${row.kind === 'del' ? 'text-muted-foreground' : 'text-foreground'}`}>{row.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  )
}

export function HistoryPanel({ open, projectId, path, onClose, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState<HistoryEntry | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const toast = useToast()
  const dialog = useDialog()
  const reloadRef = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelected(null)
    setDiff(null)
    try {
      // 打开历史前先把当前工作区变更提交（含未保存的自动 commit 兜底），保证版本列表完整
      await gitAutoCommit(projectId, '查看历史')
      const list = await listFileHistory(projectId, path)
      setEntries(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId, path])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setDiffLoading(true)
    setDiff(null)
    getRevisionDiff(projectId, path, selected.hash)
      .then((text) => {
        if (!cancelled) setDiff(text)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, path, selected])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const rollback = async () => {
    if (!selected || restoring) return
    const confirmed = await dialog.confirm({
      title: '回滚到此版本？',
      message: `「${path.split('/').pop()}」将恢复为 ${formatTime(selected.date)} 的版本，当前未保存内容会被覆盖。`,
      confirmText: '回滚',
      danger: true,
    })
    if (!confirmed) return
    setRestoring(true)
    try {
      await restoreRevision(projectId, path, selected.hash)
      await gitAutoCommit(projectId, '版本回滚')
      toast.success(`已回滚到 ${formatTime(selected.date)} 的版本`)
      reloadRef.current += 1
      onRestored(path)
      onClose()
    } catch (err) {
      toast.error(`回滚失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      {/* 头部 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <History className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-medium">版本历史</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground" title={path}>
          {path}
        </span>
        {selected && (
          <button
            type="button"
            onClick={() => void rollback()}
            disabled={restoring}
            className="flex items-center gap-1.5 rounded border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" />
            {restoring ? '回滚中…' : `回滚到 ${formatTime(selected.date)}`}
          </button>
        )}
        <button type="button" title="关闭 (Esc)" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      {error && <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">{error}</p>}

      <div className="flex min-h-0 flex-1">
        {/* 版本列表 */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border p-2">
          {loading ? (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> 加载历史…
            </p>
          ) : entries.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">暂无历史版本。保存笔记后将自动生成版本记录。</p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.hash}
                type="button"
                onClick={() => setSelected(entry)}
                className={`mb-1 block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                  selected?.hash === entry.hash ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                }`}
              >
                <span className="block text-[12px] font-medium">{formatTime(entry.date)}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={entry.subject}>
                  {entry.subject}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/60">{entry.shortHash}</span>
              </button>
            ))
          )}
        </div>

        {/* diff 区 */}
        <div className="min-w-0 flex-1 overflow-auto">
          {diffLoading ? (
            <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> 生成对比…
            </p>
          ) : !selected ? (
            <p className="p-4 text-xs text-muted-foreground">选择左侧版本查看该次变更内容</p>
          ) : diff === null || diff.trim() === '' ? (
            <p className="p-4 text-xs text-muted-foreground">此版本未修改该文件内容（可能是重命名或模式变更）</p>
          ) : (
            <DiffLines rows={parseDiffRows(diff)} />
          )}
        </div>
      </div>
    </div>
  )
}
