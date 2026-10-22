/**
 * QuickForge HTTP API 客户端。
 * 全部走相对路径 /api（dev: vite 代理；生产: server.mjs 反向代理）。
 */
import type { FileContentResponse, ProjectInfo, WorkspaceEntry } from './types'

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status} ${path}`)
  }
  return payload as T
}

/** 供 file-ops / git-history 等模块调用 NoteFlow 自有端点（/api/noteflow/*） */
export async function post(path: string, body: unknown): Promise<unknown> {
  return jsonFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/* ---------- 项目 ---------- */

export type ProjectBundle = { project: ProjectInfo | null; projects: ProjectInfo[] }

/** 全量项目信息：激活项目 + 最近项目列表（服务端注册表，最多 20 个） */
export async function getProjectBundle(): Promise<ProjectBundle> {
  return jsonFetch<ProjectBundle>('/api/project')
}

/** 切换激活项目（同时刷新 lastOpenedAt，用于"最近项目"排序） */
export async function activateProject(id: string): Promise<ProjectBundle> {
  const payload = await post('/api/project/active', { id })
  return payload as ProjectBundle
}

/** 按路径注册项目（幂等：同一路径返回同一 projectId）并激活 */
export async function registerProjectPath(path: string): Promise<ProjectBundle> {
  const payload = await post('/api/project/path', { path })
  return payload as ProjectBundle
}

/** 服务端弹出目录选择框并注册所选目录（Web 模式用；Electron 走原生 IPC） */
export async function selectProjectDirectory(): Promise<{ cancelled: boolean; project?: ProjectInfo }> {
  const payload = (await post('/api/project/select-directory', {})) as { cancelled?: boolean; project?: ProjectInfo }
  return { cancelled: Boolean(payload?.cancelled), project: payload?.project }
}

/** 从注册表移除项目（不动磁盘文件）；若移除的是激活项目，服务端自动切到列表第一个 */
export async function removeProject(id: string): Promise<ProjectBundle> {
  return jsonFetch<ProjectBundle>(`/api/project/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ---------- 文件 ---------- */

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

/** 执行 shell 命令（用户自输入命令面板用；工作区根内执行） */
export async function runCommand(projectId: string, command: string): Promise<unknown> {
  return post(`/api/projects/${encodeURIComponent(projectId)}/tools/run_command`, { command })
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

/** 列出全部 markdown 笔记路径（双链解析/补全/反向链接用；排除回收站；Node fs 实现，双平台通用） */
export async function listNotePaths(projectId: string): Promise<string[]> {
  const payload = (await post('/api/noteflow/fs', { projectId, op: 'listNotes' })) as { paths?: string[] }
  return payload.paths ?? []
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
