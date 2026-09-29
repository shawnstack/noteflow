/**
 * 共享文件操作：重命名 / 移入回收站 / 从回收站恢复。
 * 中栏工具栏与文件树右键菜单共用，全部基于 quickforge 的 run_command（mv / mkdir）。
 * 回收站同名冲突时自动追加时间戳后缀，避免 mv 静默覆盖。
 */
import { runCommand, shQuote } from './api'

export const TRASH_DIR = '.trash'

async function exec(projectId: string, command: string): Promise<void> {
  const result = (await runCommand(projectId, command)) as { isError?: boolean; content?: string; error?: string }
  if (result && (result.isError || result.error)) {
    throw new Error(String(result.error || result.content || '命令执行失败'))
  }
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 重命名（保留所在目录），返回新完整路径；目标已存在时报错，不覆盖 */
export async function renamePath(projectId: string, path: string, rawName: string): Promise<string> {
  const name = rawName.trim()
  if (!name) throw new Error('名称不能为空')
  if (name.includes('/')) throw new Error('名称不能包含 /')
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const target = parent ? `${parent}/${name}` : name
  if (target !== path) {
    await exec(projectId, `[ ! -e ${shQuote(target)} ] && mv ${shQuote(path)} ${shQuote(target)}`)
  }
  return target
}

/** 移入回收站（同名冲突自动加时间戳后缀），文件与整文件夹均支持 */
export async function moveToTrash(projectId: string, path: string): Promise<void> {
  const name = path.split('/').pop() ?? path
  const dest = `${TRASH_DIR}/${name}`
  const alt = `${dest}.${timestamp()}`
  await exec(
    projectId,
    `mkdir -p ${shQuote(TRASH_DIR)} && if [ -e ${shQuote(dest)} ]; then mv ${shQuote(path)} ${shQuote(alt)}; else mv ${shQuote(path)} ${shQuote(dest)}; fi`,
  )
}

/** 从回收站恢复到根目录（根目录同名冲突时加时间戳后缀），返回恢复后的路径 */
export async function restoreFromTrash(projectId: string, path: string): Promise<string> {
  const name = path.split('/').pop() ?? path
  const alt = `${name}.${timestamp()}`
  await exec(
    projectId,
    `if [ -e ${shQuote(name)} ]; then mv ${shQuote(path)} ${shQuote(alt)}; else mv ${shQuote(path)} ${shQuote(name)}; fi`,
  )
  return name
}

/** 彻底删除（不可恢复；回收站内条目与普通文件均可用） */
export async function deletePermanently(projectId: string, path: string): Promise<void> {
  await exec(projectId, `rm -rf ${shQuote(path)}`)
}

/** 清空回收站（删除 .trash/ 内全部内容，保留目录本身） */
export async function emptyTrash(projectId: string): Promise<void> {
  await exec(projectId, `mkdir -p ${shQuote(TRASH_DIR)} && find ${shQuote(TRASH_DIR)} -mindepth 1 -delete`)
}

/** 在 macOS Finder 中显示：文件定位并高亮，文件夹/根目录直接打开新窗口 */
export async function revealInFinder(projectId: string, path: string, kind: 'file' | 'directory' | 'root'): Promise<void> {
  if (kind === 'file') {
    await exec(projectId, `open -R ${shQuote(path)}`)
  } else {
    await exec(projectId, `open ${shQuote(kind === 'root' ? '.' : path)}`)
  }
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
    await moveToTrash(projectId, src)
    return `${TRASH_DIR}/${name}`
  }
  const currentDir = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : ''
  const nextDir = destDir === '.' ? '' : destDir
  if (currentDir === nextDir) {
    throw new Error('已在该目录中')
  }
  const target = nextDir ? `${nextDir}/${name}` : name
  if (target === src) return target
  try {
    await exec(projectId, `[ ! -e ${shQuote(target)} ] && mv ${shQuote(src)} ${shQuote(target)}`)
  } catch {
    throw new Error(`目标目录已存在同名「${name}」，未移动`)
  }
  return target
}
