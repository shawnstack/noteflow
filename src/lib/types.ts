/** 与 QuickForge 服务交互所需的类型定义（仅覆盖 noteflow 用到的子集） */

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
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

/** 中文场景字数统计：中文字符数 + 英文单词数 */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const words = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length
  return cjk + words
}
