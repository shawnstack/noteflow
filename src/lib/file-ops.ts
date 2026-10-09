/**
 * 共享文件操作：重命名 / 移动 / 回收站 / 在系统文件管理器中定位。
 * 中栏工具栏与文件树右键菜单共用，走 NoteFlow 自有端点 POST /api/noteflow/fs
 * （Node fs 实现，macOS / Windows / Linux 通用；不再经 run_command 拼 POSIX 命令）。
 * 回收站同名冲突由服务端自动追加时间戳后缀，保证不覆盖。
 */
import { post } from './api'

export const TRASH_DIR = '.trash'

type FsPayload = { ok?: boolean; path?: string }

async function fsOp(projectId: string, op: string, extra: Record<string, unknown> = {}): Promise<FsPayload> {
  const payload = (await post('/api/noteflow/fs', { projectId, op, ...extra })) as FsPayload & { error?: string }
  return payload
}

/** 重命名（保留所在目录），返回新完整路径；目标已存在时报错，不覆盖 */
export async function renamePath(projectId: string, path: string, rawName: string): Promise<string> {
  const name = rawName.trim()
  if (!name) throw new Error('名称不能为空')
  if (name.includes('/') || name.includes('\\')) throw new Error('名称不能包含 / 或 \\')
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const target = parent ? `${parent}/${name}` : name
  if (target !== path) {
    await fsOp(projectId, 'move', { from: path, to: target })
  }
  return target
}

/** 移入回收站（同名冲突自动加时间戳后缀），文件与整文件夹均支持 */
export async function moveToTrash(projectId: string, path: string): Promise<void> {
  await fsOp(projectId, 'trash', { path })
}

/** 从回收站恢复到根目录（根目录同名冲突时加时间戳后缀），返回恢复后的路径 */
export async function restoreFromTrash(projectId: string, path: string): Promise<string> {
  const payload = await fsOp(projectId, 'restore', { path })
  return payload.path ?? path.split('/').pop() ?? path
}

/** 彻底删除（不可恢复；回收站内条目与普通文件均可用） */
export async function deletePermanently(projectId: string, path: string): Promise<void> {
  await fsOp(projectId, 'delete', { path })
}

/** 清空回收站（删除 .trash/ 内全部内容，保留目录本身） */
export async function emptyTrash(projectId: string): Promise<void> {
  await fsOp(projectId, 'emptyTrash')
}

/** 在系统文件管理器中定位：文件定位并高亮，文件夹 / 根目录直接打开新窗口（Win / Mac 通用） */
export async function revealInFileManager(projectId: string, path: string, kind: 'file' | 'directory' | 'root'): Promise<void> {
  await fsOp(projectId, 'reveal', { path, kind })
}

/** 递归创建文件夹（右键「新建文件夹」） */
export async function createDirectory(projectId: string, path: string): Promise<void> {
  await fsOp(projectId, 'mkdir', { path })
}

/**
 * 移动文件/文件夹到目标目录（文件树拖拽），返回新完整路径。
 * - 目标已存在同名条目时报错（不覆盖）
 * - 目标为 .trash/ 时走回收站逻辑（同名冲突自动加时间戳）
 */
export async function movePath(projectId: string, src: string, destDir: string): Promise<string> {
  if (destDir !== '.' && (destDir === src || destDir.startsWith(`${src}/`))) {
    throw new Error('不能移动到自身内部')
  }
  const name = src.split('/').pop() ?? src
  if (destDir === TRASH_DIR) {
    const payload = await fsOp(projectId, 'trash', { path: src })
    return payload.path ?? `${TRASH_DIR}/${name}`
  }
  const currentDir = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : ''
  const nextDir = destDir === '.' ? '' : destDir
  if (currentDir === nextDir) {
    throw new Error('已在该目录中')
  }
  const target = nextDir ? `${nextDir}/${name}` : name
  if (target === src) return target
  try {
    await fsOp(projectId, 'move', { from: src, to: target })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('已存在')) throw new Error(`目标目录已存在同名「${name}」，未移动`)
    throw error
  }
  return target
}
