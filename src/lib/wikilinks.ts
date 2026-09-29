/**
 * 双链笔记（wiki links）核心逻辑。
 *
 * 语法：`[[笔记名]]` / `[[目录/笔记名]]` / `[[目录/笔记名|显示别名]]`
 * 解析优先级：精确路径 → 精确 basename → 路径后缀匹配；均不中则视为"未创建"。
 */

/** 从一段文本中提取全部 wiki 链接目标（target 部分，`|` 之前） */
export function extractWikiTargets(text: string): string[] {
  const targets: string[] = []
  const re = /\[\[([^\[\]]+?)\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const inner = match[1]
    const bar = inner.indexOf('|')
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
    if (target) targets.push(target)
  }
  return targets
}

/** 解析 wiki 目标到实际笔记路径；未命中返回 null */
export function resolveWikiTarget(target: string, notePaths: string[]): string | null {
  const clean = target.trim().replace(/^\.?\//, '')
  if (!clean) return null
  const withMd = clean.toLowerCase().endsWith('.md') || clean.toLowerCase().endsWith('.markdown') ? clean : `${clean}.md`
  // 1. 精确路径（含省略扩展名的情况）
  const exact = notePaths.find((p) => p === withMd || p === clean)
  if (exact) return exact
  // 2. 精确 basename（大小写不敏感，最常用的短链接写法）
  const lower = withMd.toLowerCase()
  const byBase = notePaths.filter((p) => (p.split('/').pop() ?? '').toLowerCase() === lower)
  if (byBase.length === 1) return byBase[0]
  if (byBase.length > 1) return byBase[0] // 歧义时取第一个，避免解析失败
  // 3. 路径后缀匹配（目录名省略前缀的写法）
  const bySuffix = notePaths.filter((p) => p === withMd || p.toLowerCase().endsWith(`/${lower}`))
  if (bySuffix.length >= 1) return bySuffix[0]
  return null
}

/** wiki 链接转标准 markdown 链接后的特殊 scheme（阅读渲染层拦截点击） */
export const NOTE_LINK_SCHEME = 'noteflow-note:'
export const NOTE_LINK_MISSING_SCHEME = 'noteflow-note-missing:'

/** 目标转 href（存在 / 不存在两种 scheme，用于差异化样式与点击行为） */
export function noteLinkHref(target: string, exists: boolean): string {
  return `${exists ? NOTE_LINK_SCHEME : NOTE_LINK_MISSING_SCHEME}${encodeURIComponent(target)}`
}

/** 从 href 还原目标文本；非本应用链接返回 null */
export function parseNoteLinkHref(href: string): { target: string; exists: boolean } | null {
  for (const [scheme, exists] of [
    [NOTE_LINK_SCHEME, true],
    [NOTE_LINK_MISSING_SCHEME, false],
  ] as const) {
    if (href.startsWith(scheme)) {
      try {
        return { target: decodeURIComponent(href.slice(scheme.length)), exists }
      } catch {
        return { target: href.slice(scheme.length), exists }
      }
    }
  }
  return null
}

/**
 * 把 markdown 文本中的 `[[target]]` / `[[target|alias]]` 预处理成
 * `[alias](noteflow-note:...)` 标准链接（阅读渲染层无需自定义 remark 插件）。
 * 跳过 fenced code block 与行内代码 span。
 */
export function transformWikiLinks(content: string, notePaths: string[]): string {
  if (!content.includes('[[')) return content
  const lines = content.split('\n')
  let inFence = false
  let fenceMark = ''
  return lines
    .map((line) => {
      const fence = /^\s{0,3}(```|~~~)/.exec(line)
      if (fence) {
        if (!inFence) {
          inFence = true
          fenceMark = fence[1]
        } else if (fence[1] === fenceMark) {
          inFence = false
          fenceMark = ''
        }
        return line
      }
      if (inFence) return line
      // 行内代码 span（反引号段）不参与替换
      const segments = line.split('`')
      return segments
        .map((segment, index) => (index % 2 === 1 ? segment : replaceSegment(segment, notePaths)))
        .join('`')
    })
    .join('\n')
}

function replaceSegment(segment: string, notePaths: string[]): string {
  return segment.replace(/\[\[([^\[\]]+?)\]\]/g, (_all, inner: string) => {
    const bar = inner.indexOf('|')
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
    const alias = (bar === -1 ? '' : inner.slice(bar + 1)).trim() || target
    if (!target) return _all
    const exists = resolveWikiTarget(target, notePaths) !== null
    return `[${alias}](${noteLinkHref(target, exists)})`
  })
}

/** 过滤出候选补全项：basename / 路径包含关键词（不区分大小写） */
export function wikiCompleteCandidates(query: string, notePaths: string[], limit = 8): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return notePaths.slice(0, limit)
  const scored: { path: string; score: number }[] = []
  for (const p of notePaths) {
    const base = (p.split('/').pop() ?? p).toLowerCase()
    if (base.includes(q)) {
      scored.push({ path: p, score: base.startsWith(q) ? 0 : 1 })
      continue
    }
    if (p.toLowerCase().includes(q)) scored.push({ path: p, score: 2 })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) => item.path)
}
