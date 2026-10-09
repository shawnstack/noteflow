/**
 * 代码符号大纲提取（中栏「大纲导航」在代码文件下的数据源）。
 *
 * 逐行单遍正则，覆盖常用语言家族的顶层声明（函数/类/接口/结构体等）；
 * Python / 缩进型语言按缩进推导层级。正确性取舍：宁可漏报也不误报——
 * 大纲只用于导航，不是解析器。超过 MAX_SYMBOLS 行后停止扫描。
 */

export type CodeSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'variable'
  | 'rule'
  | 'table'
  | 'view'

export type CodeSymbol = {
  name: string
  kind: CodeSymbolKind
  /** 1 起始行号 */
  line: number
  /** 展示层级（1 = 顶层） */
  level: number
}

export const MAX_CODE_SYMBOLS = 300

type SymbolFamily =
  | 'js-like'
  | 'python'
  | 'go'
  | 'rust'
  | 'java-like'
  | 'sql'
  | 'shell'
  | 'css'

const JS_LIKE = new Set(['javascript', 'typescript', 'jsx', 'tsx', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'astro', 'json'])
const JAVA_LIKE = new Set(['java', 'kotlin', 'kts', 'swift', 'csharp', 'c', 'cpp', 'objc', 'dart', 'scala'])
const SHELL_LIKE = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'powershell', 'batch', 'cmd'])
const CSS_LIKE = new Set(['css', 'scss', 'less'])

function familyOf(language: string): SymbolFamily | undefined {
  const name = (language ?? '').trim().toLowerCase()
  if (!name || name === 'plaintext' || name === 'text' || name === 'txt') return undefined
  if (JS_LIKE.has(name)) return 'js-like'
  if (name === 'python') return 'python'
  if (name === 'go') return 'go'
  if (name === 'rust') return 'rust'
  if (JAVA_LIKE.has(name)) return 'java-like'
  if (name === 'sql') return 'sql'
  if (SHELL_LIKE.has(name)) return 'shell'
  if (CSS_LIKE.has(name)) return 'css'
  return undefined
}

const NAME = '[A-Za-z_$][\\w$]*'

/** js-like 顶层声明：function / class / interface / type / enum / 顶层 const-let。 */
const JS_PATTERNS: { pattern: RegExp; kind: CodeSymbolKind; group: number }[] = [
  { pattern: new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${NAME})`), kind: 'function', group: 1 },
  { pattern: new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${NAME})`), kind: 'class', group: 1 },
  { pattern: new RegExp(`^(?:export\\s+)?interface\\s+(${NAME})`), kind: 'interface', group: 1 },
  { pattern: new RegExp(`^(?:export\\s+)?type\\s+(${NAME})\\s*[=<]`), kind: 'type', group: 1 },
  { pattern: new RegExp(`^(?:export\\s+)?(?:declare\\s+)?enum\\s+(${NAME})`), kind: 'enum', group: 1 },
  { pattern: new RegExp(`^(?:export\\s+)?(?:declare\\s+)?const\\s+(${NAME})\\s*[:=]`), kind: 'variable', group: 1 },
]

const PY_FUNCTION = /^(async\s+)?def\s+(\w+)/
const PY_CLASS = /^class\s+(\w+)/

const GO_FUNCTION = /^func\s+(?:\([^)]*\)\s*)?(\w+)/
const GO_TYPE = /^type\s+(\w+)\s+(struct|interface)\b/

const RUST_FUNCTION = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/
const RUST_ITEM = /^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+(\w+)/

/** java-like：修饰符 + class/interface/enum/struct/object 声明；swift/kotlin 的 func/fun。 */
const JAVA_LIKE_TYPE = /^(?:public|private|protected|internal|static|final|abstract|sealed|open|override|data|inline|partial|async|\s)*\b(class|interface|enum|struct|object)\s+(\w+)/
const SWIFT_KOTLIN_FUNCTION = /^\s*(?:@[\w:]+\s+)*(?:public|private|internal|open|override|suspend|fun|func|static|\s)*\b(?:fun|func)\s+(\w+)/
/** java/c#/c/c++ 方法签名：[修饰符] 类型 名称(参数) { —— 控制流语句靠「名称前必须还有类型词」与排除关键字过滤。 */
const JAVA_METHOD = /^\s*(?:@[\w.]+\s+)*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|default|override|sealed|async|virtual|extern|unsafe|const|inline)\s+)*[\w<>\[\],.?:&\s]+?\s+(\w+)\s*\([^;{]*\)\s*(?:throws\s+[\w.,\s]+)?\{?\s*\}?\s*$/
const JAVA_METHOD_EXCLUDE = /^\s*(?:new|return|throw|else|do|try|case|default)\b/

const SQL_OBJECT = /^\s*create\s+(?:or\s+replace\s+)?(?:temporary\s+)?(table|view|function|procedure|index|trigger)\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w$.]+)[`"\]]?/i

const SHELL_FUNCTION = /^(\w+)\s*\(\)\s*\{?/

const CSS_RULE = /^([.#@:[]?[^{}@/]*?)\{\s*\}?\s*$/

/** 提取代码符号（按行扫描）。不认识的语言返回空数组（调用方隐藏大纲按钮）。 */
export function extractCodeSymbols(content: string, language: string): CodeSymbol[] {
  const family = familyOf(language)
  if (!family) return []
  const symbols: CodeSymbol[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (symbols.length >= MAX_CODE_SYMBOLS) break
    const raw = lines[index]
    // 同行截断正则输入，防止超长行（如压缩产物）拖慢首屏
    const line = raw.length > 500 ? raw.slice(0, 500) : raw
    const found = matchLine(line, raw, family)
    if (found) symbols.push({ ...found, line: index + 1 })
  }
  return symbols
}

function matchLine(line: string, rawLine: string, family: SymbolFamily): Omit<CodeSymbol, 'line'> | undefined {
  switch (family) {
    case 'js-like': {
      if (line.startsWith(' ') || line.startsWith('\t')) return undefined
      for (const { pattern, kind, group } of JS_PATTERNS) {
        const match = pattern.exec(line)
        if (match) return { name: match[group], kind, level: 1 }
      }
      return undefined
    }
    case 'python': {
      const text = line.trimStart()
      const indent = rawLine.length - rawLine.trimStart().length
      if (indent > 0) {
        const fn = PY_FUNCTION.exec(text)
        return fn ? { name: fn[2], kind: 'method', level: 2 } : undefined
      }
      const fn = PY_FUNCTION.exec(text)
      if (fn) return { name: fn[2], kind: 'function', level: 1 }
      const cls = PY_CLASS.exec(text)
      return cls ? { name: cls[1], kind: 'class', level: 1 } : undefined
    }
    case 'go': {
      const fn = GO_FUNCTION.exec(line)
      if (fn) return { name: fn[1], kind: 'function', level: 1 }
      const type = GO_TYPE.exec(line)
      return type ? { name: type[1], kind: type[2] === 'struct' ? 'struct' : 'interface', level: 1 } : undefined
    }
    case 'rust': {
      const fn = RUST_FUNCTION.exec(line)
      if (fn) {
        const indent = rawLine.length - rawLine.trimStart().length
        return { name: fn[1], kind: indent > 0 ? 'method' : 'function', level: indent > 0 ? 2 : 1 }
      }
      const item = RUST_ITEM.exec(line)
      if (item) {
        const kind = item[1] === 'trait' ? 'trait' : item[1] === 'enum' ? 'enum' : 'struct'
        return { name: item[2], kind, level: 1 }
      }
      return undefined
    }
    case 'java-like': {
      const type = JAVA_LIKE_TYPE.exec(line)
      if (type) {
        const kind = type[1] === 'object' ? 'class' : (type[1] as CodeSymbolKind)
        return { name: type[2], kind, level: 1 }
      }
      const fn = SWIFT_KOTLIN_FUNCTION.exec(line)
      if (fn) {
        const indent = rawLine.length - rawLine.trimStart().length
        return { name: fn[1], kind: indent > 0 ? 'method' : 'function', level: indent > 0 ? 2 : 1 }
      }
      const method = JAVA_METHOD.exec(line)
      if (method && !JAVA_METHOD_EXCLUDE.test(line) && method[1] !== 'if' && method[1] !== 'while' && method[1] !== 'for' && method[1] !== 'switch' && method[1] !== 'catch') {
        const indent = rawLine.length - rawLine.trimStart().length
        return { name: method[1], kind: indent > 0 ? 'method' : 'function', level: indent > 0 ? 2 : 1 }
      }
      return undefined
    }
    case 'sql': {
      const match = SQL_OBJECT.exec(line)
      if (!match) return undefined
      const kind = match[1].toLowerCase() === 'view' ? 'view' : match[1].toLowerCase() === 'table' ? 'table' : 'function'
      const name = match[2].split(/[.:]/).pop() ?? match[2]
      return { name, kind, level: 1 }
    }
    case 'shell': {
      const match = SHELL_FUNCTION.exec(line)
      return match ? { name: match[1], kind: 'function', level: 1 } : undefined
    }
    case 'css': {
      if (line.trim().startsWith('@') && !line.trim().startsWith('@media') && !line.trim().startsWith('@supports')) return undefined
      const match = CSS_RULE.exec(line)
      if (!match) return undefined
      const selector = match[1].trim()
      if (!selector || selector.length > 80) return undefined
      return { name: selector, kind: 'rule', level: 1 }
    }
    default:
      return undefined
  }
}
