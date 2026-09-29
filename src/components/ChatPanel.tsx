import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import { ChevronDown, MessageSquarePlus, Paperclip, Shield, Trash2 } from 'lucide-react'
import type { Agent } from '@earendil-works/pi-agent-core'
import {
  approveToolCall,
  createAgentSession,
  deleteSession,
  getAgentState,
  getModelCatalog,
  listSessions,
  rejectToolCall,
  setActiveModel,
  setSessionAccessMode,
  updateSessionModel,
} from '../lib/api'
import { subscribeAgentEvents } from '../lib/agent-sse'
import type { AgentMessage, ModelLike, PendingApproval, SessionSummary } from '../lib/types'
import { asAgent, SurfaceAgentAdapter } from '../lib/surface-agent'
import { assistantText } from '../lib/message-utils'
import { ChatSurface } from './chat/surface'
import type { SurfaceEditorBridgeElement } from './chat/surface/ChatTypes'
import { setupAgentAccessMenu } from './chat/panel-decoration/agent-access-menu'
import { decorateModelButtonLabel } from './chat/panel-decoration/model-controls'
import { closeComposerModelMenu, openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import { ATTACH_NOTE_KEY, PROTECTED_KEY, SETTINGS_EVENT } from './SettingsDialog'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

const SESSION_KEY_PREFIX = 'noteflow.agent.sessionId'
/** 旧版单项目时代的 key（仅读取兼容） */
const LEGACY_SESSION_KEY = 'noteflow.agent.sessionId'

export type ChatPanelHandle = {
  /** 编程式发送消息（选中文字 AI 操作等入口），走 ChatSurface 的编辑器 DOM 桥 */
  ask: (text: string) => void
}

type Props = {
  projectId: string
  noteContext: { path: string; content: string } | null
  onOpenSetup: () => void
  model: ModelLike | null
  onModelChange: (model: ModelLike) => void
  /** 一次 AI 回复结束（可能改过笔记文件，宿主据此触发 git 自动提交）；参数为最后一条回复正文 */
  onAgentEnd?: (lastAssistantText: string) => void
}

/**
 * 右栏对话：主体 100% 是 quickforge 的 ChatSurface（原版组件与样式）。
 * 笔记应用特有功能收敛到顶部纤细工具条（会话管理 / 附带笔记 / 写保护），
 * 模型切换用输入框自带的模型按钮 + quickforge 原版样式的模型菜单。
 */
export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel({ projectId, noteContext, onOpenSetup, model, onModelChange, onAgentEnd }: Props, ref) {
  const sessionKey = `${SESSION_KEY_PREFIX}:${projectId}`
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [booted, setBooted] = useState(false)
  const [catalog, setCatalog] = useState<ModelLike[]>([])
  const [protectedMode, setProtectedMode] = useState(() => localStorage.getItem(PROTECTED_KEY) === '1')
  const [attachNote, setAttachNote] = useState(() => localStorage.getItem(ATTACH_NOTE_KEY) !== '0')
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [revision, setRevision] = useState(0)
  const [adapter, setAdapter] = useState<SurfaceAgentAdapter | null>(null)
  const attachNoteRef = useRef(attachNote)
  const noteContextRef = useRef(noteContext)
  const sessionIdRef = useRef<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const onAgentEndRef = useRef(onAgentEnd)
  const dialog = useDialog()
  const toast = useToast()

  /** agent_end 时从适配器消息里取最后一条 assistant 正文（选中文字 AI 的"应用回选区"用） */
  const lastAssistantText = useCallback((): string => {
    if (!adapter) return ''
    for (let index = adapter.state.messages.length - 1; index >= 0; index--) {
      const message = adapter.state.messages[index]
      if (message?.role === 'assistant') {
        const text = assistantText(message)
        if (text) return text
      }
    }
    return ''
  }, [adapter])

  useEffect(() => {
    onAgentEndRef.current = onAgentEnd
  }, [onAgentEnd])

  /* ---------- 编程式发送（选中文字 AI 操作） ---------- */
  const ask = useCallback(
    (text: string) => {
      // 右栏刚从折叠展开 / 会话恢复中时编辑器可能尚未挂载，短暂重试
      const attempt = (remaining: number) => {
        const editor = hostRef.current?.querySelector<HTMLElement>('.qf-message-editor') as SurfaceEditorBridgeElement | null
        if (editor?.onSend) {
          editor.onSend(text, [])
          return
        }
        if (remaining > 0) {
          window.setTimeout(() => attempt(remaining - 1), 250)
          return
        }
        toast.error('对话面板尚未就绪，请稍后重试')
      }
      attempt(20)
    },
    [toast],
  )

  useImperativeHandle(ref, () => ({ ask }), [ask])

  useEffect(() => {
    attachNoteRef.current = attachNote
  }, [attachNote])
  useEffect(() => {
    noteContextRef.current = noteContext
  }, [noteContext])
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  /* ---------- 适配器（一次创建） ---------- */
  useEffect(() => {
    const created = new SurfaceAgentAdapter(model, {
      onPendingApproval: (pending) => setApproval(pending),
      onSendError: (message) => toast.error(message),
      getNoteContext: () => (attachNoteRef.current ? noteContextRef.current : null),
    })
    setAdapter(created)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (adapter && model) {
      adapter.setModel(model)
      setRevision((r) => r + 1)
    }
  }, [adapter, model])

  const surfaceAgent: Agent | null = useMemo(() => (adapter ? asAgent(adapter) : null), [adapter])

  /* ---------- 会话管理 ---------- */
  const newSession = useCallback(
    async (quiet = false) => {
      if (!adapter) return
      const id = crypto.randomUUID()
      try {
        await createAgentSession(id, projectId, 'NoteFlow 对话', protectedMode ? 'default' : 'full-access')
        localStorage.setItem(sessionKey, id)
        adapter.bindSession(id)
        adapter.resetState()
        setSessionId(id)
        setApproval(null)
        if (!quiet) toast.success('已开启新对话')
      } catch (err) {
        toast.error(`创建会话失败：${err instanceof Error ? err.message : String(err)}`)
      }
      setBooted(true)
    },
    [adapter, projectId, protectedMode, sessionKey, toast],
  )

  const restoreSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (!adapter) return false
      const state = await getAgentState(id)
      if (!state) return false
      // 项目不匹配的会话（旧数据/别的项目）不在本窗口恢复
      if (state.projectId && state.projectId !== projectId) return false
      localStorage.setItem(sessionKey, id)
      adapter.bindSession(id)
      const messages = (state.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      adapter.restoreMessages(messages as AgentMessage[], Boolean(state.isStreaming))
      setSessionId(id)
      setApproval(state.pendingToolApproval ?? null)
      return true
    },
    [adapter, projectId, sessionKey],
  )

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      // 会话按项目隔离持久化；兼容旧版全局 key（restoreSession 会校验会话归属项目）
      const stored = localStorage.getItem(sessionKey) ?? localStorage.getItem(LEGACY_SESSION_KEY)
      const [catalogModels] = await Promise.all([getModelCatalog().catch(() => [])])
      if (cancelled) return
      setCatalog(catalogModels)
      if (stored && adapter && (await restoreSession(stored))) {
        setBooted(true)
        return
      }
      if (!cancelled) await newSession(true)
    }
    if (adapter) void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter])

  const openSessions = useCallback(async () => {
    setSessionsOpen((prev) => !prev)
    try {
      // 只展示当前项目的会话（多项目互不串台）
      setSessions((await listSessions()).filter((s) => s.projectId === projectId))
    } catch {
      /* 打开失败保留旧列表 */
    }
  }, [projectId])

  const switchSession = async (id: string) => {
    if (id === sessionIdRef.current) {
      setSessionsOpen(false)
      return
    }
    if (await restoreSession(id)) setSessionsOpen(false)
  }

  const removeSession = async (id: string) => {
    const confirmed = await dialog.confirm({ title: '删除该对话？', message: '对话记录将从服务端删除，不可恢复。', danger: true, confirmText: '删除' })
    if (!confirmed) return
    try {
      await deleteSession(id)
      if (id === sessionIdRef.current) await newSession(true)
      setSessions((await listSessions().catch(() => [])).filter((s) => s.projectId === projectId))
      toast.success('已删除对话')
    } catch (err) {
      toast.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /* ---------- SSE 订阅（分发到适配器 + 审批） ---------- */
  useEffect(() => {
    if (!adapter) return
    const unsubscribe = subscribeAgentEvents((event) => {
      const current = sessionIdRef.current
      if (!current || event.sessionId !== current) return
      if (event.type === 'tool_approval_required') {
        const toolCallId = String(event.toolCallId || '')
        if (toolCallId) {
          setApproval({ toolCallId, toolName: String(event.toolName || 'tool'), args: (event.args as Record<string, unknown>) ?? {} })
          return
        }
      }
      adapter.handleSseEvent(event)
      if (event.type === 'agent_end') onAgentEndRef.current?.(lastAssistantText())
    })
    return unsubscribe
  }, [adapter])

  /* ---------- 响应设置面板的偏好变更 ---------- */
  useEffect(() => {
    const onSettings = () => {
      setProtectedMode(localStorage.getItem(PROTECTED_KEY) === '1')
      setAttachNote(localStorage.getItem(ATTACH_NOTE_KEY) !== '0')
    }
    window.addEventListener(SETTINGS_EVENT, onSettings)
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings)
  }, [])

  /* ---------- 审批 ---------- */
  const resolveApproval = async (approved: boolean) => {
    const current = sessionIdRef.current
    if (!current || !approval) return
    const { toolCallId, toolName } = approval
    setApproval(null)
    try {
      if (approved) await approveToolCall(current, toolCallId)
      else {
        await rejectToolCall(current, toolCallId)
        toast.info(`已拒绝 ${toolName}`)
      }
    } catch (err) {
      toast.error(`审批操作失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /* ---------- 模型切换（quickforge 原版模型菜单） ---------- */
  const switchModel = async (next: ModelLike) => {
    onModelChange(next)
    setRevision((r) => r + 1)
    const current = sessionIdRef.current
    if (!current) return
    try {
      await Promise.all([updateSessionModel(current, next), setActiveModel(next)])
      toast.success(`已切换到 ${next.provider} / ${next.id}`)
    } catch (err) {
      toast.error(`切换模型失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const activeModelKey = model ? `${model.provider}/${model.id}` : ''
  /* ---------- quickforge 原版 decoration 挂载（模型按钮 label + 输入框写保护按钮） ---------- */
  useEffect(() => {
    if (!surfaceAgent || !booted) return
    const frame = requestAnimationFrame(() => {
      const panel = hostRef.current
      if (!panel) return
      const editor = panel.querySelector<HTMLElement>('.qf-message-editor')
      const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
      const leftControls = editorRows?.[0]
      const rightControls = editorRows?.[editorRows.length - 1]
      if (editor && rightControls) decorateModelButtonLabel(editor as never, rightControls)
      if (leftControls) {
        setupAgentAccessMenu({
          panel,
          leftControls,
          agentAccessMode: protectedMode ? 'default' : 'full-access',
          onAccessModeChange: (mode) => {
            const next = mode === 'default'
            setProtectedMode(next)
            localStorage.setItem(PROTECTED_KEY, next ? '1' : '0')
            const current = sessionIdRef.current
            if (current) {
              void setSessionAccessMode(current, mode).then(
                () => toast.success(next ? '已开启写保护：AI 修改笔记前需你批准' : '已关闭写保护：AI 可直接修改笔记'),
                (err) => toast.error(`切换失败：${err instanceof Error ? err.message : String(err)}`),
              )
            }
          },
          dismissComposerMenus: () => closeComposerModelMenu(),
        })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [surfaceAgent, booted, protectedMode, toast])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 笔记特有工具条（纤细，融入 quickforge 面板） */}
      <div className="relative flex h-8 shrink-0 items-center gap-0.5 border-b border-border/60 px-2">
        <span className="mr-1 text-[11px] text-muted-foreground/60">对话</span>
        <button
          type="button"
          title={attachNote ? '发送时附带当前笔记，点击关闭' : '发送时不附带笔记，点击开启'}
          onClick={() => {
            const next = !attachNote
            setAttachNote(next)
            localStorage.setItem(ATTACH_NOTE_KEY, next ? '1' : '0')
          }}
          className={`rounded p-1 ${attachNote ? 'text-primary' : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground'}`}
        >
          <Paperclip className="size-3.5" />
        </button>
        <button type="button" title="历史对话" onClick={() => void openSessions()} className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground">
          <ChevronDown className="size-3.5" />
        </button>
        <button type="button" title="新对话" onClick={() => void newSession()} className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground">
          <MessageSquarePlus className="size-3.5" />
        </button>

        {/* 会话列表下拉 */}
        {sessionsOpen && (
          <div className="absolute left-2 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl">
            {sessions.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">暂无历史对话</p>}
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                className={`group flex items-center gap-1 rounded px-2 py-1.5 text-[13px] ${
                  session.sessionId === sessionId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                }`}
              >
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void switchSession(session.sessionId)}>
                  {session.title || session.sessionId.slice(0, 8)}
                </button>
                <button type="button" title="删除对话" onClick={() => void removeSession(session.sessionId)} className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* quickforge ChatSurface 原样 */}
      <div ref={hostRef} className="quickforge-chat-panel-host relative min-h-0 flex-1">
        {surfaceAgent && booted ? (
          <ChatSurface
            agent={surfaceAgent}
            enableAttachments
            enableModelSelector
            enableThinkingSelector={false}
            chatPanelRevision={revision}
            onModelSelect={() => {
              // quickforge 原版模型菜单（DOM 版，含键盘导航/定位/外点关闭）
              openCustomOnlyModelSelector(
                (model ?? undefined) as never,
                catalog as never,
                (selected) => {
                  const next = selected as unknown as ModelLike
                  if (`${next.provider}/${next.id}` !== activeModelKey) void switchModel(next)
                },
                undefined,
                { anchor: hostRef.current?.querySelector<HTMLElement>('.quickforge-model-trigger') ?? undefined },
              )
            }}
            onApiKeyRequired={async () => {
              onOpenSetup()
              return false
            }}
          />
        ) : (
          <p className="p-4 text-xs text-muted-foreground">连接服务中…</p>
        )}

        {/* 审批卡（浮层） */}
        {approval && (
          <div className="absolute bottom-4 left-1/2 z-20 w-[calc(100%-24px)] max-w-md -translate-x-1/2 rounded-xl border border-amber-600/70 bg-card/95 p-3 shadow-2xl backdrop-blur">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-amber-500">
              <Shield className="size-3.5" />
              AI 请求使用工具：<span className="font-mono">{approval.toolName}</span>
            </p>
            {approval.args && Object.keys(approval.args).length > 0 && (
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] leading-5 text-muted-foreground">
                {JSON.stringify(approval.args, null, 2).slice(0, 2000)}
              </pre>
            )}
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => void resolveApproval(true)} className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90">
                批准
              </button>
              <button type="button" onClick={() => void resolveApproval(false)} className="rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-muted">
                拒绝
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
