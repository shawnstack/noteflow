/**
 * SurfaceAgentAdapter：把 NoteFlow 的 QuickForge HTTP/SSE 客户端包装成
 * quickforge ChatSurface 期望的 pi-agent-core `Agent` 表面。
 *
 * 只实现 ChatSurface 实际使用的成员（state / subscribe / prompt / abort），
 * 通过 `as unknown as Agent` 传入（Agent class 含私有字段，结构类型不兼容）。
 */
import type { Agent, AgentEvent, AgentMessage, AgentState, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { registerToolRenderer } from './tool-renderer-registry'
import { LocalWorkspaceToolRenderer, McpToolRenderer } from './tool-renderers'
import { upsertMessage, upsertToolResult } from './tool-execution-events'
import type { AgentSseEvent } from './agent-sse'
import type { Attachment } from '@/components/chat/surface/ChatTypes'
import type { ModelLike, PendingApproval } from './types'

const NOTE_CONTEXT_LIMIT = 8000

/* 工具渲染器注册（一次性，import 时执行） */
let renderersRegistered = false
function ensureRenderers() {
  if (renderersRegistered) return
  renderersRegistered = true
  for (const [name, labelKey] of [
    ['manage_global_memory', 'manageGlobalMemory'],
    ['read_file', 'readFile'],
    ['grep_files', 'searchFiles'],
    ['write_file', 'writeFile'],
    ['edit_file', 'editFile'],
    ['run_command', 'runCommand'],
    ['present_files', 'presentFiles'],
    ['activate_skill', 'activateSkill'],
    ['read_skill_resource', 'readSkillResource'],
  ] as Array<[string, never]>) {
    registerToolRenderer(name, new LocalWorkspaceToolRenderer(name, labelKey))
  }
  registerToolRenderer('mcp_tool', new McpToolRenderer('mcp_tool'))
}

type AdapterState = Omit<AgentState, 'isStreaming' | 'pendingToolCalls' | 'streamingMessage' | 'errorMessage' | 'model'> & {
  model: Model<Api>
  isStreaming: boolean
  streamingMessage?: AgentMessage
  pendingToolCalls: Set<string>
  errorMessage?: string
}

export type AdapterHooks = {
  /** SSE 收到/清除待审批工具时回调（宿主渲染审批卡） */
  onPendingApproval?: (approval: PendingApproval | null) => void
  /** prompt HTTP 失败时回调 */
  onSendError?: (message: string) => void
  /** 发送时附带当前笔记（宿主控制开关与内容） */
  getNoteContext?: () => { path: string; content: string } | null
}

/** 发送载荷的宽松形状（SSE/HTTP 边界上的消息为 JSON，结构由服务端保证） */
type LooseMessage = { role: string; content: unknown; timestamp?: number; attachments?: Attachment[] }

export class SurfaceAgentAdapter {
  state: AdapterState
  private listeners = new Set<(event: AgentEvent) => void>()
  private hooks: AdapterHooks
  private sessionId: string | null = null

  constructor(initialModel: ModelLike | null, hooks: AdapterHooks = {}) {
    ensureRenderers()
    this.hooks = hooks
    this.state = {
      systemPrompt: '',
      model: (initialModel ?? { id: 'default', provider: 'default', api: 'openai-completions', baseUrl: '' }) as unknown as Model<Api>,
      thinkingLevel: 'off' as ThinkingLevel,
      tools: [],
      messages: [],
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    }
  }

  /* ---------- Agent 表面 ---------- */

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(type: string) {
    for (const listener of this.listeners) {
      listener({ type } as AgentEvent)
    }
  }

  async prompt(message: AgentMessage | string): Promise<void> {
    if (!this.sessionId) {
      this.hooks.onSendError?.('会话尚未就绪')
      return
    }
    const payload = (typeof message === 'string' ? { role: 'user', content: message, timestamp: Date.now() } : toUserMessage(message)) as LooseMessage
    // 注入当前笔记上下文（宿主开关控制）
    const note = this.hooks.getNoteContext?.() ?? null
    if (note && typeof payload.content === 'string' && payload.content.trim()) {
      const clipped = note.content.length > NOTE_CONTEXT_LIMIT ? `${note.content.slice(0, NOTE_CONTEXT_LIMIT)}\n…（已截断）` : note.content
      payload.content = `[当前正在查看笔记 ${note.path}，内容如下]\n\n\`\`\`\n${clipped}\n\`\`\`\n\n${payload.content}`
    }
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(this.sessionId)}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: { role: payload.role, content: payload.content, timestamp: Date.now() } }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null
        if (body?.code === 'GENERATION_ALREADY_RUNNING') {
          this.hooks.onSendError?.('上一条回复还在生成中，请稍候或点击停止')
          throw new Error('generation running')
        }
        throw new Error(body?.error || `HTTP ${response.status}`)
      }
      this.state.isStreaming = true
      this.emit('agent_start')
    } catch (error) {
      if (error instanceof Error && error.message === 'generation running') throw error
      this.hooks.onSendError?.(`发送失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  abort(): void {
    if (!this.sessionId) return
    void fetch(`/api/agents/${encodeURIComponent(this.sessionId)}/abort`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  }

  /* ---------- 会话与状态管理（宿主调用） ---------- */

  bindSession(sessionId: string) {
    this.sessionId = sessionId
  }

  setModel(model: ModelLike) {
    this.state.model = model as unknown as Model<Api>
  }

  resetState() {
    this.state.messages = []
    this.state.streamingMessage = undefined
    this.state.isStreaming = false
    this.state.pendingToolCalls = new Set()
    this.state.errorMessage = undefined
    this.emit('messages_replaced')
  }

  restoreMessages(messages: unknown[], isStreaming: boolean) {
    this.state.messages = messages as AgentMessage[]
    this.state.isStreaming = isStreaming
    this.state.streamingMessage = undefined
    this.state.pendingToolCalls = new Set()
    this.emit('messages_replaced')
  }

  /* ---------- SSE 事件入口（宿主分发） ---------- */

  handleSseEvent(event: AgentSseEvent) {
    if (!this.sessionId || event.sessionId !== this.sessionId) return
    const message = event.message as AgentMessage | undefined
    switch (event.type) {
      case 'agent_start': {
        this.state.isStreaming = true
        this.state.errorMessage = undefined
        this.emit('agent_start')
        break
      }
      case 'message_start': {
        this.emit('message_start')
        break
      }
      case 'message_update': {
        if (message) {
          this.state.isStreaming = true
          this.state.streamingMessage = message
        }
        this.emit('message_update')
        break
      }
      case 'message_end': {
        if (message) {
          this.state.messages = upsertMessage(this.state.messages, message)
        }
        this.state.streamingMessage = undefined
        this.emit('message_end')
        break
      }
      case 'tool_execution_start': {
        const toolCall = (event.toolCall ?? {}) as { id?: string }
        const toolCallId = String(event.toolCallId || toolCall.id || '')
        if (toolCallId) this.state.pendingToolCalls.add(toolCallId)
        this.hooks.onPendingApproval?.(null)
        this.emit('tool_execution_start')
        break
      }
      case 'tool_execution_end': {
        this.state.messages = upsertToolResult(this.state.messages, event as never, true)
        const toolCall = (event.toolCall ?? {}) as { id?: string }
        const toolCallId = String(event.toolCallId || toolCall.id || '')
        this.state.pendingToolCalls.delete(toolCallId)
        this.emit('tool_execution_end')
        break
      }
      case 'agent_end': {
        this.state.isStreaming = false
        this.state.streamingMessage = undefined
        this.state.pendingToolCalls = new Set()
        if (event.errorMessage) this.state.errorMessage = event.errorMessage
        this.emit('agent_end')
        break
      }
      case 'error': {
        this.state.errorMessage = String(event.errorMessage || event.error || '未知错误')
        this.state.isStreaming = false
        this.emit('agent_end')
        break
      }
      default:
        break
    }
  }
}

/** 把 ChatSurface 发出的 user / user-with-attachments 消息转为 HTTP payload */
function toUserMessage(message: AgentMessage): LooseMessage {
  const loose = message as unknown as LooseMessage
  const attachments = loose.attachments ?? []
  const imageBlocks = attachments
    .filter((attachment) => attachment.type === 'image' && attachment.content)
    .map((attachment) => ({ type: 'image', data: attachment.content, mimeType: attachment.mimeType || 'image/png' }))
  const documentText = attachments
    .filter((attachment) => attachment.type === 'document' && attachment.extractedText)
    .map((attachment) => `\n\n--- 附件 ${attachment.fileName} ---\n${attachment.extractedText}`)
    .join('')
  const baseText = typeof loose.content === 'string' ? loose.content : ''
  if (imageBlocks.length === 0) {
    return { role: 'user', content: baseText + documentText }
  }
  return {
    role: 'user',
    content: [{ type: 'text', text: baseText + documentText }, ...imageBlocks],
  }
}

/** 传给 ChatSurface 的强转出口 */
export function asAgent(adapter: SurfaceAgentAdapter): Agent {
  return adapter as unknown as Agent
}
