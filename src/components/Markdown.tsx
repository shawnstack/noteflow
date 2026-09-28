import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { Check, Copy } from 'lucide-react'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-zinc max-w-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-code:before:content-none prose-code:after:content-none prose-headings:border-none prose-th:text-left prose-p:leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
          [rehypeKatex, { throwOnError: false, output: 'html' }],
        ]}
        components={{
          pre: PreBlock,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** 代码块：右上角复制按钮 */
function PreBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const node = document.createElement('div')
    node.innerHTML = ''
    const text = extractText(children)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // 剪贴板不可用时静默
    }
  }

  return (
    <div className="group relative">
      <pre>{children}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        title="复制代码"
        className="absolute right-2 top-2 rounded border border-zinc-700 bg-zinc-800/90 p-1.5 text-zinc-400 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}
