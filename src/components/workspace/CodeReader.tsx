import { useMemo, useState } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import { HIGHLIGHT_TOKEN_CLASSES, highlightCode, type CodeHighlightSegment } from '@/lib/code-highlight'
import { copyTextToClipboard } from '@/lib/message-utils'
import { cn } from '@/lib/utils'

/**
 * 中栏代码阅读器（区别于聊天 `CodeBlock`：无高度上限、带行号）。
 *
 * 设计原则：纯阅读——常驻元素只有行号与高亮；语言/行数信息由主工具栏
 * 状态区显示，复制/换行收进 hover 浮现的幽灵按钮（零常驻视觉成本）。
 *
 * - 复用自研高亮器 `code-highlight.ts`（>200KB 自动降级纯文本）；
 * - 行号逐行渲染，`data-line` 供大纲导航定位；超过 LINE_NUMBER_LIMIT 行
 *   关闭行号改整块渲染（顶部内联小字提示），避免超长文件 DOM 行数失控；
 * - 自动换行开关持久化到 localStorage；行号列 `select-none`，选中复制不混入行号。
 */

type CodeReaderProps = {
  path: string
  content: string
  /** 高亮语言（后端判定优先，前端 file-kind 补充） */
  language: string
}

const LINE_NUMBER_LIMIT = 20000
const COPY_FEEDBACK_MS = 2000
const WRAP_STORAGE_KEY = 'noteflow.codeWrap'

function readWrapPreference(): boolean {
  try {
    return localStorage.getItem(WRAP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 将整段高亮结果按行拆分（保持 token 类别），供逐行渲染。 */
function splitSegmentsByLine(segments: CodeHighlightSegment[]): CodeHighlightSegment[][] {
  const lines: CodeHighlightSegment[][] = [[]]
  for (const segment of segments) {
    const parts = segment.text.split('\n')
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) lines.push([])
      if (parts[index]) lines[lines.length - 1].push({ text: parts[index], token: segment.token })
    }
  }
  return lines
}

export function CodeReader({ content, language }: CodeReaderProps) {
  const [wrap, setWrap] = useState(readWrapPreference)
  const [copied, setCopied] = useState(false)

  const lines = useMemo(() => splitSegmentsByLine(highlightCode(content, language)), [content, language])
  const lineCount = lines.length
  const useLineNumbers = lineCount <= LINE_NUMBER_LIMIT

  const toggleWrap = () => {
    setWrap((value) => {
      const next = !value
      try {
        localStorage.setItem(WRAP_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* 隐私模式等场景静默 */
      }
      return next
    })
  }

  const copyAll = async () => {
    try {
      await copyTextToClipboard(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    } catch {
      /* 剪贴板被占用时静默 */
    }
  }

  return (
    <div className="group relative h-full min-h-0 bg-background">
      {/* hover 浮现的阅读操作（不常驻） */}
      <div className="absolute right-3 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          title={wrap ? '自动换行：开（点击关闭）' : '自动换行：关（点击开启）'}
          onClick={toggleWrap}
          className={cn(
            'rounded border border-border/60 bg-background/90 p-1.5 shadow-sm backdrop-blur transition-colors',
            wrap ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <WrapText className="size-3.5" />
        </button>
        <button
          type="button"
          title="复制全文"
          onClick={() => void copyAll()}
          className="rounded border border-border/60 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      {/* 代码区 */}
      <div className="h-full min-h-0 overflow-auto">
        {content === '' ? (
          <p className="p-6 text-sm text-muted-foreground/70">此文件为空。</p>
        ) : useLineNumbers ? (
          <div className={cn('py-2 font-mono text-[12.5px] leading-6', wrap ? '' : 'min-w-max')}>
            {lines.map((segments, lineIndex) => (
              <div key={lineIndex} data-line={lineIndex + 1} className="flex hover:bg-muted/40">
                <span className="sticky left-0 w-12 shrink-0 select-none bg-background pr-3 text-right text-[11px] leading-6 text-muted-foreground/45">
                  {lineIndex + 1}
                </span>
                <span className={cn('pr-6', wrap ? 'min-w-0 flex-1 whitespace-pre-wrap break-words' : 'whitespace-pre')}>
                  {segments.map((segment, segmentIndex) => (
                    <span key={segmentIndex} className={HIGHLIGHT_TOKEN_CLASSES[segment.token]}>
                      {segment.text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <p className="px-4 pt-3 text-[11px] text-muted-foreground/50">
              文件过长（{lineCount.toLocaleString()} 行），已关闭行号
            </p>
            <pre className={cn('p-4 font-mono text-[12.5px] leading-6', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>
              {lines.map((segments, lineIndex) => (
                <span key={lineIndex}>
                  {segments.map((segment, segmentIndex) => (
                    <span key={segmentIndex} className={HIGHLIGHT_TOKEN_CLASSES[segment.token]}>
                      {segment.text}
                    </span>
                  ))}
                  {lineIndex < lines.length - 1 ? '\n' : null}
                </span>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
