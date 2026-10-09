/**
 * 统一文件类型识别（中栏预览分发 / AI 产物列表共用，单一来源）。
 *
 * 三层检测：
 *  L1 扩展名 → kind（已知扩展名表，覆盖最广）
 *  L2 特殊文件名（dockerfile / makefile / dotfiles …）→ code
 *  L3 内容嗅探（L1/L2 未命中，或扩展名疑似误标时）：
 *     - 首部含 NUL 或密集 UTF-8 替换符 → binary
 *     - `#!` shebang → code（并解析出解释器语言）
 *     - 其余 → code（plaintext 阅读）
 *
 * 历史教训：`artifact-preview-utils.ts` 与 `tool-artifacts.ts` 各维护一份规则时
 * `.mdx` 曾在一处算 markdown、另一处不算。此模块是唯一规则来源：
 * `.mdx` 统一按 code 处理（react-markdown `skipHtml` 无法渲染 JSX，
 * 富预览必然残缺，源码视图更诚实）。
 */

export type FileKind = 'markdown' | 'code' | 'image' | 'html' | 'pdf' | 'docx' | 'excel' | 'binary' | 'unknown'

/** 可作为文本读写的 kind（决定中栏「编辑/分屏/保存」按钮与草稿能力）。 */
export const TEXT_EDITABLE_KINDS: ReadonlySet<FileKind> = new Set(['markdown', 'code', 'html'])

export function isTextEditableKind(kind: FileKind): boolean {
  return TEXT_EDITABLE_KINDS.has(kind)
}

const MARKDOWN_RE = /\.(md|markdown)$/i
const HTML_RE = /\.(html?|xhtml)$/i
const IMAGE_RE = /\.(svg|png|jpe?g|webp|gif|ico)$/i
const EXCEL_RE = /\.(xls|xlsx)$/i
// 与后端 quickforge 文本接口兼容的代码/文本扩展名（UTF-8 读写均安全）。
const CODE_EXT_RE =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|scss|less|json|jsonc|txt|csv|tsv|log|sql|xml|yml|yaml|toml|ini|env|example|py|pyi|rb|go|rs|java|swift|kt|kts|c|h|cpp|hpp|cc|hh|cs|php|sh|bash|zsh|fish|ps1|psm1|bat|cmd|lua|pl|pm|r|m|mm|dart|scala|gradle|proto|graphql|gql|vue|svelte|astro|diff|patch|conf|properties|htaccess|mdx)$/i

/** 无扩展名但有明确代码语义的文件名（大小写不敏感）。 */
const SPECIAL_CODE_NAMES = new Set([
  'dockerfile',
  'makefile',
  'gnumakefile',
  'rakefile',
  'gemfile',
  'justfile',
  'procfile',
  'cmakelists.txt',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.dockerignore',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.browserslistrc',
  '.prettierrc',
  '.eslintrc',
  '.babelrc',
])

/** 仅凭路径判定 kind（不含内容嗅探；产物列表等无内容场景使用）。 */
export function fileKindFromPath(path: string): FileKind {
  const normalized = path.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  const fileName = lower.split('/').filter(Boolean).pop() ?? ''
  if (!fileName) return 'unknown'
  if (HTML_RE.test(lower)) return 'html'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (EXCEL_RE.test(lower)) return 'excel'
  if (IMAGE_RE.test(lower)) return 'image'
  if (MARKDOWN_RE.test(lower)) return 'markdown'
  if (SPECIAL_CODE_NAMES.has(fileName) || fileName.endsWith('.dockerfile')) return 'code'
  if (CODE_EXT_RE.test(lower)) return 'code'
  return 'unknown'
}

/* ------------------------------------------------------------------ */
/* 内容嗅探（内容已由文本接口拉到前端，检查零额外开销）                 */
/* ------------------------------------------------------------------ */

const SNIFF_WINDOW = 8192
const SHEBANG_RE = /^#![^\r\n]{0,200}/

/** shebang 解释器 → 自研高亮器（code-highlight.ts）的语言名。 */
const SHEBANG_LANGUAGES: Record<string, string> = {
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  dash: 'bash',
  ksh: 'bash',
  ash: 'bash',
  fish: 'bash',
  python: 'python',
  python3: 'python',
  node: 'javascript',
  nodejs: 'javascript',
  deno: 'javascript',
  ruby: 'ruby',
  rbx: 'ruby',
  perl: 'perl',
  php: 'php',
  lua: 'lua',
  r: 'r',
  rscript: 'r',
  pwsh: 'powershell',
  powershell: 'powershell',
}

/** shebang 解释器名 → 语言（带版本后缀的如 python3.12 / node20 归一到主名）。 */
function lookupShebangLanguage(name: string): string | undefined {
  const key = name.toLowerCase()
  if (SHEBANG_LANGUAGES[key]) return SHEBANG_LANGUAGES[key]
  return SHEBANG_LANGUAGES[key.replace(/[\d.]+$/, '')]
}

/** 从 `#!/usr/bin/env python3 -u` 一类首行解析高亮语言；无法识别返回 undefined。 */
export function languageFromShebang(shebangLine: string): string | undefined {
  const match = /^#!\s*(.*)$/.exec(shebangLine.trim())
  if (!match) return undefined
  const tokens = match[1].trim().split(/\s+/)
  const program = tokens[0]?.split('/').pop()
  if (!program) return undefined
  if (program.toLowerCase() === 'env') {
    // `/usr/bin/env python3` 或 `/usr/bin/env -S python3 -u`
    const first = tokens[1]
    const target = first && !first.startsWith('-') ? first : tokens[2]
    return target ? lookupShebangLanguage(target) : undefined
  }
  return lookupShebangLanguage(program)
}

/**
 * 文本内容是否疑似二进制：NUL 字节是强信号；UTF-8 解码失败产生的
 * 替换符（U+FFFD）密集出现（>4 个）作为弱信号兜底（部分二进制
 * 偶然不含 NUL，但几乎必然解码出大量替换符）。
 */
export function looksBinaryText(content: string): boolean {
  const head = content.slice(0, SNIFF_WINDOW)
  if (head.includes('\u0000')) return true
  let replacements = 0
  for (let index = 0; index < head.length && replacements <= 4; index += 1) {
    if (head.charCodeAt(index) === 0xfffd) replacements += 1
  }
  return replacements > 4
}

/**
 * 路径 + 内容联合判定（中栏打开文件时的主入口）：
 * - 已知扩展名直接采信，但 markdown/code（文本类）会做一次二进制复核，
 *   拦截「.txt 其实是 exe」这类误标；
 * - 未知扩展名走 shebang / 二进制嗅探。
 */
export function refineFileKind(path: string, content: string): FileKind {
  const fromPath = fileKindFromPath(path)
  if (fromPath === 'unknown') {
    if (!content) return 'unknown'
    return looksBinaryText(content) ? 'binary' : 'code'
  }
  if (fromPath === 'markdown' || fromPath === 'code') {
    if (content && looksBinaryText(content)) return 'binary'
  }
  return fromPath
}

/** 无扩展名/未知扩展名脚本经 shebang 判定后的语言补充（供阅读器展示）。 */
export function languageFromShebangContent(content: string): string | undefined {
  const head = content.slice(0, SNIFF_WINDOW)
  const shebang = SHEBANG_RE.exec(head)
  return shebang ? languageFromShebang(shebang[0]) : undefined
}

/* ------------------------------------------------------------------ */
/* 扩展名 → 高亮语言（后端返回 plaintext 时的前端补充）                */
/* ------------------------------------------------------------------ */

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  xml: 'xml',
  svg: 'svg',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  env: 'ini',
  properties: 'ini',
  conf: 'nginx',
  htaccess: 'apache',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  mdx: 'markdown',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  dart: 'dart',
  scala: 'scala',
  gradle: 'groovy',
  r: 'r',
  m: 'objc',
  mm: 'objc',
  csv: 'plaintext',
  tsv: 'plaintext',
  log: 'plaintext',
  txt: 'plaintext',
  diff: 'diff',
  patch: 'diff',
}

/** 特殊文件名 → 高亮语言。 */
const SPECIAL_NAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.dockerignore': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.nvmrc': 'plaintext',
  '.browserslistrc': 'plaintext',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  '.babelrc': 'json',
  cmakelists: 'plaintext',
}

/** 从路径推断高亮语言；未知返回 undefined（调用方回退到后端 language 或 plaintext）。 */
export function languageFromPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/')
  const fileName = (normalized.split('/').filter(Boolean).pop() ?? '').toLowerCase()
  if (!fileName) return undefined
  if (SPECIAL_NAME_LANGUAGES[fileName]) return SPECIAL_NAME_LANGUAGES[fileName]
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return undefined
  return EXTENSION_LANGUAGES[fileName.slice(dot + 1)]
}
