import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { t } from '@/lib/i18n'
import { HIGHLIGHT_TOKEN_CLASSES, highlightCode } from '@/lib/code-highlight'
import { copyTextToClipboard, cn } from '@/lib/utils'

/**
 * 中栏 Markdown 源码模式使用的整块代码渲染：标题栏（语言 + 复制按钮）+
 * 自研高亮器（`src/lib/code-highlight.ts`）。
 * 不提供 SVG/Mermaid 预览、灯箱与终端运行按钮（笔记渲染不需要这些能力）。
 */

/** 围栏语言标记为 shell 类（MarkdownReader 的「▶ 运行」按钮据此显示）。 */
const SHELL_CODE_LANGUAGES = new Set([
  'bash', 'sh', 'shell', 'zsh', 'fish', 'cmd', 'bat', 'batch', 'powershell', 'ps1', 'terminal', 'console',
])

/** 标题栏复制按钮的「已复制」反馈时长。 */
const COPY_BUTTON_FEEDBACK_MS = 2000

/** 标题栏语言标签：无语言信息时显示 plaintext。 */
export function codeBlockLanguageLabel(language: string | undefined) {
  return (language ?? '').trim() || 'plaintext'
}

export function isShellCodeLanguage(language: string | undefined) {
  return SHELL_CODE_LANGUAGES.has((language ?? '').trim().toLowerCase())
}

/** 标题栏复制按钮：成功后图标换成 ✓ 并追加「Copied!」文字（2000ms）。 */
function CodeBlockCopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      data-qf-action="copy-code"
      className={cn(
        'pointer-events-auto inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground',
        copied ? 'h-7 gap-1 px-1.5 text-xs text-emerald-600 hover:text-emerald-600' : 'size-7',
      )}
      title={t('copyCode')}
      aria-label={t('copyCode')}
      onClick={onCopy}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? <span>{t('copiedBang')}</span> : null}
    </button>
  )
}

export type CodeBlockProps = {
  language?: string
  source: string
}

/** 整块代码（源码查看模式）：memo 化避免父级重渲染重复走高亮路径。 */
export const CodeBlock = memo(function CodeBlock({ language, source }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPY_BUTTON_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = useCallback(() => {
    void copyTextToClipboard(source)
      .then(() => setCopied(true))
      .catch(() => {})
  }, [source])

  const label = codeBlockLanguageLabel(language)
  // 高亮分段按 source 记忆；plain 段渲染为裸文本节点，保证复制/选中的是原文。
  const highlightSegments = useMemo(() => highlightCode(source, language), [source, language])

  return (
    <div className="qf-code-block my-2 block overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs text-muted-foreground font-mono">{label}</span>
        <CodeBlockCopyButton copied={copied} onCopy={copy} />
      </div>
      <div className="overflow-auto max-h-96">
        <pre className="!bg-transparent !border-0 !rounded-none m-0 px-4 pb-4 text-xs text-foreground font-mono">
          <code className={`language-${label}`}>
            {highlightSegments.map((segment, index) =>
              segment.token === 'plain'
                ? segment.text
                : <span key={index} className={HIGHLIGHT_TOKEN_CLASSES[segment.token]}>{segment.text}</span>,
            )}
          </code>
        </pre>
      </div>
    </div>
  )
})
