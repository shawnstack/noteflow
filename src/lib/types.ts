/** 与 QuickForge 服务交互所需的类型定义（仅覆盖 noteflow 用到的子集） */

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
}

export type ChildrenResponse = {
  root: string
  path: string
  entries: WorkspaceEntry[]
  nextCursor: string | null
  truncated: boolean
}

export type FileContentResponse = {
  content: string
  size: number
  mtimeMs: number
  path: string
  language: string
  readonly: boolean
}

export type ProjectInfo = {
  id: string
  name: string
  path: string
  lastOpenedAt?: string
  sortOrder?: number
}

/** pi-agent-core 的 AgentMessage（noteflow 关心的字段子集） */
export type AgentMessage = {
  role: string
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  id?: string
  timestamp?: number
  [key: string]: unknown
}

/** 从 AgentMessage 提取纯文本（content 可能是字符串或 blocks 数组） */
export function messageText(message: AgentMessage | undefined | null): string {
  if (!message) return ''
  const { content } = message
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
  }
  return ''
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type ToolActivity = {
  toolCallId: string
  name: string
  status: 'running' | 'success' | 'error'
  detail?: string
}

export type PendingApproval = {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  /** 审批来源（subagent / MCP / Plugin 等），quickforge 原生审批卡用于来源徽章 */
  source?: { type?: string; label?: string; subagent?: string } | null
}

export type SessionSummary = {
  sessionId: string
  title?: string
  status?: string
  scope?: string
  accessMode?: string
  projectId?: string
}

export type ModelLike = {
  id: string
  provider: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  quickforgeModelRef?: { version: number; source: string; providerId?: string; modelId: string; provider?: string; api?: string; baseUrl?: string }
  [key: string]: unknown
}

/** 中文场景字数统计：中文字符数 + 英文单词数 */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const words = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length
  return cjk + words
}
