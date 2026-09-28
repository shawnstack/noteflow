/**
 * 全局 Agent SSE 订阅：一条 EventSource 连接服务所有会话，
 * 按 data.sessionId 过滤分发（与 quickforge 前端同款模式）。
 */
import type { AgentMessage } from './types'

export type AgentSseEvent = {
  type: string
  sessionId?: string
  message?: AgentMessage
  messages?: AgentMessage[]
  errorMessage?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  [key: string]: unknown
}

const EVENT_TYPES = [
  'agent_start',
  'message_start',
  'message_update',
  'message_end',
  'turn_start',
  'turn_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'agent_end',
  'error',
  'state',
  'title_updated',
  'messages_replaced',
  'tool_approval_required',
  'ask_user_required',
]

export function subscribeAgentEvents(onEvent: (event: AgentSseEvent) => void): () => void {
  const source = new EventSource('/api/agents/events')
  const handler = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as AgentSseEvent
      if (data && typeof data === 'object') onEvent(data)
    } catch {
      // 忽略无法解析的帧
    }
  }
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, handler as EventListener)
  }
  return () => source.close()
}
