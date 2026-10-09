/**
 * 跨平台文件操作端点（POST /api/noteflow/fs）
 *
 * 服务对象：右键菜单（重命名 / 回收站 / 在系统文件管理器中定位）、文件树新建文件夹与
 * 拖拽移动、双链笔记列举、git 版本历史。全部用 Node fs / spawn(args 数组) 实现、不经
 * shell——旧实现经 quickforge run_command 拼 POSIX 命令（open -R / mv / mkdir -p /
 * rm -rf / find / printf），Windows cmd.exe 下全部失效。
 *
 * 挂载方式与 asset-endpoint 相同：server-core.mjs（生产 + Electron）与 vite dev
 * middleware（Web dev）。路径一律为项目根内相对路径（'/' 分隔），服务端负责越界校验
 * 与平台分支，前端无需感知服务端操作系统。
 *
 * 请求体：JSON { projectId, op, ... }，响应 { ok: true, ... } 或 { error }
 * op：
 *   mkdir      { path }                                  递归创建文件夹
 *   move       { from, to }                              移动 / 重命名（目标存在则报错，不覆盖）
 *   trash      { path }                                  移入 .trash/（同名自动加时间戳后缀）
 *   restore    { path }                                  从 .trash/ 恢复到根目录（同名加时间戳后缀）
 *   delete     { path }                                  彻底删除（递归，不可恢复）
 *   emptyTrash { }                                       清空 .trash/（保留目录本身）
 *   reveal     { path, kind: 'file'|'directory'|'root' } 在系统文件管理器中打开 / 定位高亮
 *   listNotes  { }                                       递归列出全部 markdown 笔记（排除 .trash/）
 *   git        { action: 'ensure'|'commit'|'log'|'show'|'checkout', ... }
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const TRASH_DIR = '.trash'
const MAX_BODY_BYTES = 1024 * 1024

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function httpError(status, message) {
  const error = new Error(message)
  error.statusCode = status
  return error
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw httpError(413, '请求体过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** abs 是否位于 root 内（含 root 本身）；用 path.relative 判断，win（\）与 POSIX（/）通用 */
export function isPathWithin(root, abs) {
  const rel = relative(resolve(root), resolve(abs))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function pathExists(abs) {
  return Boolean(await stat(abs).catch(() => null))
}

/** 项目根内相对路径 → 绝对路径；空路径 / 越界 / 根目录本身一律拒绝 */
function safeJoin(root, relPath) {
  const rel = String(relPath ?? '').trim()
  if (!rel || rel === '.') throw httpError(400, '路径不能为空')
  if (rel.includes('\0')) throw httpError(400, '非法路径')
  const abs = resolve(join(root, rel))
  if (!isPathWithin(root, abs) || relative(resolve(root), abs) === '') {
    throw httpError(403, '路径超出项目范围')
  }
  return abs
}

function timestamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 目标已存在时追加时间戳后缀（与旧 mv 实现同格式），仍冲突则再加序号 */
async function uniqueTarget(root, relTarget) {
  const stamp = timestamp()
  const candidates = [relTarget, `${relTarget}.${stamp}`]
  for (let i = 2; i <= 9; i += 1) candidates.push(`${relTarget}.${stamp}-${i}`)
  for (const candidate of candidates) {
    if (!(await pathExists(join(root, candidate)))) return candidate
  }
  throw httpError(409, '目标路径冲突，请稍后重试')
}

/* ---------- 文件操作 ---------- */

async function opMkdir(root, body) {
  await mkdir(safeJoin(root, body.path), { recursive: true })
  return { ok: true }
}

async function opMove(root, body) {
  const fromRel = String(body.from ?? '')
  const toRel = String(body.to ?? '')
  const from = safeJoin(root, fromRel)
  const to = safeJoin(root, toRel)
  if (from !== to) {
    if (!(await pathExists(from))) throw httpError(404, `源路径不存在：${fromRel}`)
    if (await pathExists(to)) throw httpError(409, `目标已存在同名条目：${toRel}`)
    try {
      await rename(from, to)
    } catch (err) {
      if (err?.code === 'ENOENT') throw httpError(404, `目标目录不存在：${dirname(toRel) || '根目录'}`)
      throw err
    }
  }
  return { ok: true, path: toRel }
}

async function opTrash(root, body) {
  const from = safeJoin(root, body.path)
  if (!(await pathExists(from))) throw httpError(404, `路径不存在：${body.path}`)
  await mkdir(join(root, TRASH_DIR), { recursive: true })
  const destRel = await uniqueTarget(root, `${TRASH_DIR}/${basename(from)}`)
  await rename(from, join(root, destRel))
  return { ok: true, path: destRel }
}

async function opRestore(root, body) {
  const from = safeJoin(root, body.path)
  const trashAbs = resolve(join(root, TRASH_DIR))
  if (from === trashAbs || !isPathWithin(trashAbs, from)) {
    throw httpError(400, '仅回收站内的条目可恢复')
  }
  if (!(await pathExists(from))) throw httpError(404, `路径不存在：${body.path}`)
  const destRel = await uniqueTarget(root, basename(from))
  await rename(from, join(root, destRel))
  return { ok: true, path: destRel }
}

async function opDelete(root, body) {
  await rm(safeJoin(root, body.path), { recursive: true, force: true })
  return { ok: true }
}

async function opEmptyTrash(root) {
  const trashAbs = join(root, TRASH_DIR)
  await mkdir(trashAbs, { recursive: true })
  for (const entry of await readdir(trashAbs, { withFileTypes: true })) {
    await rm(join(trashAbs, entry.name), { recursive: true, force: true })
  }
  return { ok: true }
}

/** 平台分支：win explorer.exe（/select, 定位并高亮文件）、mac open -R、linux 打开父目录 */
function revealCommand(abs, isDirectory) {
  if (process.platform === 'win32') {
    return isDirectory ? ['explorer.exe', [abs]] : ['explorer.exe', [`/select,${abs}`]]
  }
  if (process.platform === 'darwin') {
    return isDirectory ? ['open', [abs]] : ['open', ['-R', abs]]
  }
  return ['xdg-open', [isDirectory ? abs : dirname(abs)]]
}

async function opReveal(root, body) {
  const kind = body.kind === 'root' ? 'root' : body.kind === 'file' ? 'file' : 'directory'
  const abs = kind === 'root' ? resolve(root) : safeJoin(root, body.path)
  const info = kind === 'root' ? { isDirectory: () => true } : await stat(abs).catch(() => null)
  if (!info) throw httpError(404, `路径不存在：${body.path}`)
  const isDirectory = kind === 'root' || info.isDirectory()
  const [command, args] = revealCommand(abs, isDirectory)
  await new Promise((resolveSpawn, rejectSpawn) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
    child.once('error', (err) => rejectSpawn(httpError(500, `无法打开文件管理器：${err.message}`)))
    child.once('spawn', () => {
      child.unref()
      resolveSpawn()
    })
  })
  return { ok: true }
}

/** 递归列出 *.md / *.markdown（与旧 find 实现同为大小写敏感），排除根下 .trash/ */
async function opListNotes(root) {
  const paths = []
  const walk = async (relDir) => {
    const entries = await readdir(join(root, relDir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!relDir && entry.name === TRASH_DIR) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(rel)
      else if (entry.isFile() && /\.(md|markdown)$/.test(entry.name)) paths.push(rel)
    }
  }
  await walk('')
  paths.sort()
  return { ok: true, paths }
}

/* ---------- git（spawn git + args 数组，不经 shell，双平台引号语义统一） ---------- */

function runGit(root, args) {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (err) => rejectGit(httpError(500, `git 不可用：${err.message}`)))
    child.on('close', (code) => resolveGit({ code, stdout, stderr }))
  })
}

function assertGitHash(value) {
  if (!/^[0-9a-f]{4,40}$/i.test(String(value || ''))) throw httpError(400, '非法的版本号')
}

async function gitEnsure(root) {
  if (!existsSync(join(root, '.git'))) {
    const init = await runGit(root, ['init'])
    if (init.code !== 0) throw httpError(500, `git init 失败：${init.stderr.trim()}`)
  }
  if (!existsSync(join(root, '.gitignore'))) {
    await writeFile(join(root, '.gitignore'), `${TRASH_DIR}/\n.DS_Store\n`, 'utf8')
  }
  return { ok: true }
}

async function opGit(root, body) {
  const action = String(body.action || '')

  if (action === 'ensure') return gitEnsure(root)

  if (action === 'commit') {
    await gitEnsure(root)
    const reason = String(body.reason || '').trim() || '保存'
    const status = await runGit(root, ['status', '--porcelain'])
    if (status.code !== 0) throw httpError(500, `git status 失败：${status.stderr.trim()}`)
    if (!status.stdout.trim()) return { ok: true, committed: false }
    const count = status.stdout.trim().split('\n').length
    const message = `NoteFlow 自动保存 · ${reason}（${count} 个文件变更）`
    const add = await runGit(root, ['add', '-A'])
    if (add.code !== 0) throw httpError(500, `git add 失败：${add.stderr.trim()}`)
    const commit = await runGit(root, ['commit', '-m', message])
    if (commit.code !== 0) throw httpError(500, `git commit 失败：${commit.stderr.trim()}`)
    return { ok: true, committed: true }
  }

  if (action === 'log' || action === 'show' || action === 'checkout') {
    const abs = safeJoin(root, body.path)
    if (action !== 'log') assertGitHash(body.hash)
    const argsByAction = {
      log: ['log', '--follow', '--no-color', '--format=%H%x1f%h%x1f%aI%x1f%s', '--', abs],
      show: ['show', '--no-color', '--format=', String(body.hash), '--', abs],
      checkout: ['checkout', String(body.hash), '--', abs],
    }
    const out = await runGit(root, argsByAction[action])
    if (out.code !== 0) throw httpError(500, `git ${action} 失败：${out.stderr.trim()}`)
    return action === 'checkout' ? { ok: true } : { ok: true, output: out.stdout }
  }

  throw httpError(400, `未知的 git action：${action}`)
}

/* ---------- 端点 ---------- */

/** 查 quickforge 项目注册表：projectId → 绝对路径（实时查，注册 / 移除即时生效） */
async function resolveProjectRoot(qfBase, projectId) {
  try {
    const res = await fetch(`${qfBase}/api/project`)
    if (!res.ok) return null
    const payload = await res.json().catch(() => null)
    const projects = Array.isArray(payload?.projects) ? payload.projects : []
    const hit = projects.find((project) => project?.id === projectId)
    return hit?.path ? resolve(hit.path) : null
  } catch {
    return null
  }
}

export function createFsEndpoint({ qfBase }) {
  return async function handleFsApi(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    try {
      // CSRF 硬化：跨源页面无法以 application/json 直发(会触发预检)，本端点只接受 JSON
      if (!String(req.headers['content-type'] || '').includes('application/json')) {
        throw httpError(415, 'content-type 必须为 application/json')
      }
      const body = await readJsonBody(req)
      const projectId = String(body?.projectId || '')
      if (!projectId) throw httpError(400, 'projectId 不能为空')
      const root = await resolveProjectRoot(qfBase, projectId)
      if (!root) throw httpError(404, '项目不存在或未注册')

      const handlers = {
        mkdir: () => opMkdir(root, body),
        move: () => opMove(root, body),
        trash: () => opTrash(root, body),
        restore: () => opRestore(root, body),
        delete: () => opDelete(root, body),
        emptyTrash: () => opEmptyTrash(root),
        reveal: () => opReveal(root, body),
        listNotes: () => opListNotes(root),
        git: () => opGit(root, body),
      }
      const handler = handlers[String(body?.op || '')]
      if (!handler) throw httpError(400, `未知的 op：${body?.op}`)
      sendJson(res, 200, await handler())
    } catch (error) {
      const status = Number(error?.statusCode) || 500
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
