/**
 * notes/ 目录的 git 版本历史（notes 为独立仓库，与代码仓库隔离）。
 *
 * 走 NoteFlow 自有端点 POST /api/noteflow/fs 的 git op：服务端以 args 数组 spawn git、
 * 不经 shell —— macOS/Windows 引号语义统一（旧实现拼 shell 命令 + POSIX 单引号，
 * Windows cmd.exe 下引号原样传给 git、printf/[ -d ] 等语法均失效）。
 * 自动 commit：保存笔记 / AI 回复结束 / 文件移动后由 App 防抖触发。
 */
import { post } from './api'

type GitPayload = { committed?: boolean; output?: string }

async function gitFs(projectId: string, action: string, extra: Record<string, unknown> = {}): Promise<GitPayload> {
  return (await post('/api/noteflow/fs', { projectId, op: 'git', action, ...extra })) as GitPayload
}

/** 确保 notes/ 是独立 git 仓库（不存在 .git 则 init），并排除回收站 */
export async function ensureGitRepo(projectId: string): Promise<void> {
  await gitFs(projectId, 'ensure')
}

/** 有变更则 add -A + commit；返回是否产生了新提交 */
export async function gitAutoCommit(projectId: string, reason: string): Promise<boolean> {
  const payload = await gitFs(projectId, 'commit', { reason })
  return Boolean(payload.committed)
}

export type HistoryEntry = { hash: string; shortHash: string; date: string; subject: string }

/** 单文件的版本历史（--follow 跟随重命名） */
export async function listFileHistory(projectId: string, path: string): Promise<HistoryEntry[]> {
  await ensureGitRepo(projectId)
  const payload = await gitFs(projectId, 'log', { path })
  return String(payload.output || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', shortHash = '', date = '', subject = ''] = line.split('\x1f')
      return { hash, shortHash, date, subject }
    })
}

/** 某版本相对其父版本的 unified diff（首提交则展示全文新增） */
export async function getRevisionDiff(projectId: string, path: string, hash: string): Promise<string> {
  const payload = await gitFs(projectId, 'show', { path, hash })
  return String(payload.output || '')
}

/** 把文件恢复到指定版本（工作区与暂存区一起还原） */
export async function restoreRevision(projectId: string, path: string, hash: string): Promise<void> {
  await gitFs(projectId, 'checkout', { path, hash })
}
