/**
 * QuickForge HTTP API 客户端。
 * 全部走相对路径 /api（dev: vite 代理；生产: server.mjs 反向代理）。
 */
import type { AgentMessage, ChildrenResponse, FileContentResponse, ModelLike, ProjectInfo, SessionSummary, WorkspaceEntry } from './types'

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status} ${path}`)
  }
  return payload as T
}

function post(path: string, body: unknown): Promise<unknown> {
  return jsonFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/* ---------- 项目 ---------- */

export async function getActiveProject(): Promise<ProjectInfo | null> {
  const payload = await jsonFetch<{ project: ProjectInfo | null }>('/api/project')
  return payload.project
}

/* ---------- 文件 ---------- */

export async function listChildren(projectId: string, path: string, cursor?: string | null): Promise<ChildrenResponse> {
  const params = new URLSearchParams({ projectId, path })
  if (cursor) params.set('cursor', cursor)
  return jsonFetch<ChildrenResponse>(`/api/workspace/children?${params}`)
}

export async function readFileContent(projectId: string, path: string): Promise<FileContentResponse> {
  const params = new URLSearchParams({ projectId, path })
  return jsonFetch<FileContentResponse>(`/api/workspace/file?${params}`)
}

/** 仅取元信息（mtime 检测外部变更用） */
export async function readFileMeta(projectId: string, path: string): Promise<FileContentResponse> {
  const params = new URLSearchParams({ projectId, path, meta: '1' })
  return jsonFetch<FileContentResponse>(`/api/workspace/file?${params}`)
}

/** 通过 QuickForge 工具直调路由写文件（自动创建父目录；需 agent-access-mode=full-access） */
export async function writeFileContent(projectId: string, path: string, content: string): Promise<void> {
  await post(`/api/projects/${encodeURIComponent(projectId)}/tools/write_file`, { path, content })
}

/** 执行 shell 命令（文件移动/删除/建目录等；工作区根内执行） */
export async function runCommand(projectId: string, command: string): Promise<unknown> {
  return post(`/api/projects/${encodeURIComponent(projectId)}/tools/run_command`, { command })
}

/** shell 单参数安全引用 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/* ---------- 图片素材（编辑器粘贴/拖入） ---------- */

/** 上传图片二进制到 notes/assets/<年-月>/，返回相对笔记根的路径（NoteFlow 自有端点，非 quickforge） */
export async function uploadImageAsset(file: Blob, ext: string): Promise<string> {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取图片数据失败'))
    reader.readAsDataURL(file)
  })
  const payload = await jsonFetch<{ path: string }>('/api/noteflow/asset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ext, dataBase64 }),
  })
  return payload.path
}

/** 计算从笔记所在目录指向素材的相对链接（MarkdownReader 按笔记目录解析相对路径） */
export function relativeAssetLink(notePath: string, assetPath: string): string {
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  const fromParts = noteDir ? noteDir.split('/') : []
  const toParts = assetPath.split('/')
  let common = 0
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) common++
  const ups = fromParts.length - common
  const downs = toParts.slice(common).join('/')
  return ups === 0 ? downs : `${'../'.repeat(ups)}${downs}`
}

/** 文件/目录名搜索（≥2 字符，ripgrep --files + 子串匹配） */
export async function searchFileNames(projectId: string, query: string): Promise<WorkspaceEntry[]> {
  const params = new URLSearchParams({ projectId, query })
  const payload = await jsonFetch<{ entries: WorkspaceEntry[] }>(`/api/workspace/search?${params}`)
  return payload.entries ?? []
}

/** 列出全部 markdown 笔记路径（双链解析/补全/反向链接用；排除回收站，cwd=notes/） */
export async function listNotePaths(projectId: string): Promise<string[]> {
  const payload = (await post(`/api/projects/${encodeURIComponent(projectId)}/tools/run_command`, {
    command: `find . -type f \\( -name '*.md' -o -name '*.markdown' \\) -not -path './.trash/*' | sed 's|^\\./||' | sort`,
  })) as { content?: string; error?: string; isError?: boolean }
  if (payload && (payload.isError || payload.error)) throw new Error(String(payload.error || '列出笔记失败'))
  const match = /\nSTDOUT[^\n]*:\n([\s\S]*?)\n\nSTDERR/.exec(String(payload?.content ?? ''))
  const stdout = match ? match[1] : ''
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export type GrepMatch = { path: string; line: number | null; text: string }

/** 全文内容搜索（grep_files 工具，返回按行解析的结果） */
export async function searchContent(projectId: string, query: string): Promise<GrepMatch[]> {
  const payload = (await post(`/api/projects/${encodeURIComponent(projectId)}/tools/grep_files`, {
    query,
    limit: 100,
  })) as { content?: string; output?: string; details?: { matches?: unknown[] } | string }
  const raw = typeof payload === 'string' ? payload : payload.content || payload.output || ''
  const matches: GrepMatch[] = []
  for (const line of String(raw).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = /^(.+?):(\d+):(.*)$/.exec(trimmed)
    if (parsed) {
      matches.push({ path: parsed[1].replace(/^\.\//, ''), line: Number(parsed[2]), text: parsed[3] })
    } else {
      matches.push({ path: trimmed.replace(/^\.\//, ''), line: null, text: trimmed })
    }
  }
  return matches.slice(0, 100)
}

/* ---------- 模型 / 配置 ---------- */

export async function getModelCatalog(refresh = false): Promise<ModelLike[]> {
  const payload = await jsonFetch<{ models: ModelLike[] }>(`/api/models/catalog${refresh ? '?refresh=true' : ''}`)
  return payload.models ?? []
}

export async function storageGet<T = unknown>(store: string, key: string): Promise<T | null> {
  const payload = await jsonFetch<{ value: T | null }>(`/api/storage/${store}/key/${encodeURIComponent(key)}`)
  return payload.value
}

export async function storagePut(store: string, key: string, value: unknown): Promise<void> {
  await jsonFetch(`/api/storage/${store}/key/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  })
}

export async function testConnection(model: unknown, apiKey: string): Promise<void> {
  await post('/api/models/test-connection', { model, apiKey })
}

/** 设置默认模型（settings['active-model']，结构对齐 quickforge 的 storedModelPreference） */
export async function setActiveModel(model: ModelLike): Promise<void> {
  const modelRef =
    model.quickforgeModelRef ?? {
      version: 1,
      source: 'legacy-custom',
      provider: model.provider,
      modelId: model.id,
      api: model.api,
      baseUrl: model.baseUrl,
    }
  await storagePut('settings', 'active-model', { modelRef, modelSnapshot: model })
}

export async function getActiveModel(): Promise<ModelLike | null> {
  const value = await storageGet<{ modelSnapshot?: ModelLike }>('settings', 'active-model')
  return value?.modelSnapshot ?? null
}

/** 配置一个 OpenAI 兼容 provider（写入 custom-providers + provider-keys），返回 catalog 中对应的模型 */
export async function saveOpenAICompatProvider(input: {
  providerName: string
  baseUrl: string
  apiKey: string
  modelId: string
  modelName: string
  reasoning: boolean
}): Promise<ModelLike> {
  const providerId = `noteflow-${input.providerName}`
  const customProvider = {
    id: providerId,
    name: input.providerName,
    type: 'openai-completions',
    baseUrl: input.baseUrl,
    models: [
      {
        id: input.modelId,
        provider: input.providerName,
        api: 'openai-completions',
        baseUrl: input.baseUrl,
        reasoning: input.reasoning,
        input: ['text'],
        output: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  }
  await storagePut('custom-providers', providerId, customProvider)
  await storagePut('provider-keys', input.providerName, input.apiKey)
  // 刷新 catalog 并定位到刚配置的模型
  const models = await getModelCatalog(true)
  const found = models.find(
    (m) => m.id === input.modelId && (m.quickforgeModelRef?.providerId === providerId || m.provider === input.providerName),
  )
  if (!found) {
    throw new Error('模型已保存，但未在目录中找到对应条目，请检查 baseUrl / modelId 是否正确')
  }
  return found
}

/* ---------- AI 会话 ---------- */

export async function createAgentSession(sessionId: string, projectId: string, title: string, accessMode: 'default' | 'full-access' = 'full-access'): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}`, {
    scope: 'project',
    projectId,
    title,
    accessMode,
    messages: [],
  })
}

export async function listSessions(): Promise<SessionSummary[]> {
  const payload = await jsonFetch<{ sessions: SessionSummary[] }>('/api/agents')
  return payload.sessions ?? []
}

export async function deleteSession(sessionId: string): Promise<void> {
  await jsonFetch(`/api/agents/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export async function setSessionAccessMode(sessionId: string, accessMode: 'default' | 'full-access'): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}/access-mode`, { accessMode })
}

export async function updateSessionModel(sessionId: string, model: ModelLike): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}/model`, { model })
}

export async function approveToolCall(sessionId: string, toolCallId: string): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}/approve-tool`, { toolCallId })
}

export async function rejectToolCall(sessionId: string, toolCallId: string): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}/reject-tool`, { toolCallId })
}

export type AgentStateSnapshot = {
  messages: AgentMessage[]
  isStreaming?: boolean
  status?: string
  title?: string
  accessMode?: string
  pendingToolApproval?: { toolCallId: string; toolName: string; args: Record<string, unknown> } | null
}

export async function getAgentState(sessionId: string): Promise<AgentStateSnapshot | null> {
  try {
    return await jsonFetch<AgentStateSnapshot>(`/api/agents/${encodeURIComponent(sessionId)}/state`)
  } catch {
    return null
  }
}

export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}/prompt`, {
    message: { role: 'user', content: text, timestamp: Date.now() },
  })
}

export async function abortGeneration(sessionId: string): Promise<void> {
  await post(`/api/agents/${encodeURIComponent(sessionId)}/abort`, {})
}
