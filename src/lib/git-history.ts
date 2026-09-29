/**
 * notes/ 目录的 git 版本历史（notes 为独立仓库，与代码仓库隔离）。
 *
 * 全部经 quickforge 的 run_command 工具执行（cwd = notes/），
 * 输出需从 formatCommandOutput 的文本（Command/Exit code/STDOUT preview...）中剥离 stdout 段。
 * 自动 commit：保存笔记 / AI 回复结束 / 文件移动后由 App 防抖触发。
 */
import { runCommand, shQuote } from './api'

type CommandResult = { isError?: boolean; content?: string; error?: string }

async function execCommand(projectId: string, command: string): Promise<void> {
  const result = (await runCommand(projectId, command)) as CommandResult
  if (result && (result.isError || result.error)) {
    throw new Error(String(result.error || result.content || '命令执行失败'))
  }
}

/** run_command 的 content 是 formatCommandOutput 文本，这里取出 STDOUT 段 */
function extractStdout(content: string): string {
  const match = /\nSTDOUT[^\n]*:\n([\s\S]*?)\n\nSTDERR/.exec(content)
  const stdout = match ? match[1] : ''
  return stdout === '(empty)' ? '' : stdout
}

async function gitOutput(projectId: string, gitArgs: string): Promise<string> {
  const result = (await runCommand(projectId, `git ${gitArgs}`)) as CommandResult
  if (result && (result.isError || result.error)) {
    throw new Error(String(result.error || result.content || 'git 命令执行失败'))
  }
  return extractStdout(String(result?.content || ''))
}

/** 确保 notes/ 是独立 git 仓库（不存在 .git 则 init），并排除回收站 */
export async function ensureGitRepo(projectId: string): Promise<void> {
  await execCommand(projectId, `[ -d .git ] || git init -q`)
  await execCommand(projectId, `if [ ! -f .gitignore ]; then printf '.trash/\\n.DS_Store\\n' > .gitignore; fi`)
}

/** 有变更则 add -A + commit；返回是否产生了新提交 */
export async function gitAutoCommit(projectId: string, reason: string): Promise<boolean> {
  await ensureGitRepo(projectId)
  const status = await gitOutput(projectId, `status --porcelain`)
  if (!status.trim()) return false
  const count = status.trim().split('\n').length
  const message = `NoteFlow 自动保存 · ${reason}（${count} 个文件变更）`
  await execCommand(projectId, `git add -A && git commit -q -m ${shQuote(message)}`)
  return true
}

export type HistoryEntry = { hash: string; shortHash: string; date: string; subject: string }

/** 单文件的版本历史（--follow 跟随重命名） */
export async function listFileHistory(projectId: string, path: string): Promise<HistoryEntry[]> {
  await ensureGitRepo(projectId)
  const out = await gitOutput(projectId, `log --follow --format='%H%x1f%h%x1f%aI%x1f%s' -- ${shQuote(path)}`)
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', shortHash = '', date = '', subject = ''] = line.split('\x1f')
      return { hash, shortHash, date, subject }
    })
}

/** 某版本相对其父版本的 unified diff（首提交则展示全文新增） */
export async function getRevisionDiff(projectId: string, path: string, hash: string): Promise<string> {
  return gitOutput(projectId, `show --format= ${shQuote(hash)} -- ${shQuote(path)}`)
}

/** 把文件恢复到指定版本（工作区与暂存区一起还原） */
export async function restoreRevision(projectId: string, path: string, hash: string): Promise<void> {
  await execCommand(projectId, `git checkout ${shQuote(hash)} -- ${shQuote(path)}`)
}
