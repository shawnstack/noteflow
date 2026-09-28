/**
 * 命令执行面板：监听 quickforge 原版 `quickforge:execute-markdown-command`
 * 窗口事件（聊天与中栏 markdown 的 ▶ 按钮都会派发），经确认后通过
 * QuickForge 的 run_command 工具直调执行，底部面板展示输出。
 * 与 quickforge 的差异：无终端 dock，输出以只读面板呈现。
 */
import { useEffect, useRef, useState } from 'react'
import { CircleStop, Play, Terminal, X } from 'lucide-react'
import { runCommand } from '../lib/api'
import { useDialog } from './Dialog'

type RunState =
  | { status: 'idle' }
  | { status: 'running'; command: string }
  | { status: 'done'; command: string; output: string; exit: number | null; error?: string }

type ExecuteDetail = { command: string; confirm?: boolean; dangerous?: boolean }

export function CommandRunner({ projectId }: { projectId: string }) {
  const [state, setState] = useState<RunState>({ status: 'idle' })
  const [open, setOpen] = useState(false)
  const dialog = useDialog()
  const outputRef = useRef<HTMLPreElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<ExecuteDetail>).detail
      const command = typeof detail?.command === 'string' ? detail.command.trim() : ''
      if (!command) return
      if (detail.confirm || detail.dangerous) {
        const confirmed = await dialog.confirm({
          title: '执行命令',
          message: detail.dangerous
            ? '该命令包含高风险操作（如 rm -rf / sudo / git push 等），确认执行？'
            : '即将执行多行命令，确认运行？',
          confirmText: '运行',
          danger: Boolean(detail.dangerous),
        })
        if (!confirmed) return
      }
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState({ status: 'running', command })
      setOpen(true)
      try {
        const result = (await runCommand(projectId, command)) as {
          content?: string
          output?: string
          isError?: boolean
          error?: string
          details?: { code?: number | string; stdout?: string; stderr?: string; stdout_preview?: string; stderr_preview?: string }
        }
        if (controller.signal.aborted) return
        const stdout = String(result?.details?.stdout ?? result?.details?.stdout_preview ?? result?.content ?? result?.output ?? '')
        const stderr = String(result?.details?.stderr ?? result?.details?.stderr_preview ?? '')
        const exitRaw = result?.details?.code
        const exit = exitRaw === undefined || exitRaw === null ? null : Number(exitRaw)
        setState({
          status: 'done',
          command,
          output: [stdout, stderr].filter(Boolean).join(stderr ? '\n--- stderr ---\n' : ''),
          exit,
          error: result?.isError || result?.error ? String(result?.error || result?.content || '命令执行失败') : undefined,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'done', command, output: '', exit: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
    window.addEventListener('quickforge:execute-markdown-command', handler as EventListener)
    return () => window.removeEventListener('quickforge:execute-markdown-command', handler as EventListener)
  }, [projectId, dialog])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [state])

  if (!open || state.status === 'idle') return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-h-[45vh] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Terminal className="size-3.5 shrink-0 text-emerald-500" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={state.command}>
          {state.command.split('\n')[0]}
          {state.command.includes('\n') ? ' …' : ''}
        </span>
        {state.status === 'running' && <span className="shrink-0 text-[10px] text-amber-500">运行中…</span>}
        {state.status === 'done' && (
          <span className={`shrink-0 text-[10px] ${state.exit === 0 || (state.exit === null && !state.error) ? 'text-emerald-500' : 'text-destructive'}`}>
            {state.error ? '失败' : state.exit === null ? '完成' : `退出码 ${state.exit}`}
          </span>
        )}
        <button
          type="button"
          title="停止"
          onClick={() => {
            abortRef.current?.abort()
            setState((prev) => (prev.status === 'running' ? { status: 'done', command: prev.command, output: '', exit: null, error: '已停止等待（命令可能仍在服务端执行）' } : prev))
          }}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CircleStop className="size-3.5" />
        </button>
        <button type="button" title="关闭" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <pre ref={outputRef} className="min-h-[72px] flex-1 overflow-auto whitespace-pre-wrap break-all bg-background/60 p-3 font-mono text-[11.5px] leading-5 text-foreground">
        {state.status === 'running' ? '…' : state.output || state.error || '（无输出）'}
      </pre>
    </div>
  )
}

export function CommandRunnerTrigger({ command, className }: { command: string; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      title="运行此命令"
      onClick={() => {
        window.dispatchEvent(new CustomEvent('quickforge:execute-markdown-command', { detail: { command, confirm: command.includes('\n'), dangerous: /\b(rm\s+-rf|sudo|git\s+push|chmod|chown)\b/i.test(command) } }))
      }}
    >
      <Play className="size-3.5" />
    </button>
  )
}
