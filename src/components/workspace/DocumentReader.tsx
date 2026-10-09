import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { DocxAttachmentPreview, ExcelAttachmentPreview, PdfAttachmentPreview } from '@/components/chat/surface/AttachmentPreview'
import { workspacePreviewUrl, type DocumentFormat } from './artifact-preview-utils'

/**
 * 中栏文档阅读器（PDF / DOCX / Excel）：
 * 经 workspace 预览接口按路径取二进制（该接口对这些扩展名在白名单内），
 * 复用聊天附件的渲染管线（pdfjs / docx-preview / xlsx，含 docx XSS 净化）。
 */

type DocumentReaderProps = {
  projectId: string
  path: string
  format: DocumentFormat
}

export function DocumentReader({ projectId, path, format }: DocumentReaderProps) {
  const [bytes, setBytes] = useState<Uint8Array>()
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setBytes(undefined)
    setError('')
    fetch(workspacePreviewUrl(projectId, path, reloadToken))
      .then(async (response) => {
        if (!response.ok) throw new Error(`无法加载文件（HTTP ${response.status}）`)
        return new Uint8Array(await response.arrayBuffer())
      })
      .then((data) => {
        if (!cancelled) setBytes(data)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, path, reloadToken])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-muted-foreground/70">
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="rounded border border-border px-3 py-1 text-xs hover:bg-muted"
        >
          重新加载
        </button>
      </div>
    )
  }
  if (!bytes) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        文档加载中…
      </div>
    )
  }
  if (format === 'pdf') return <PdfAttachmentPreview bytes={bytes} />
  if (format === 'docx') return <DocxAttachmentPreview bytes={bytes} />
  return <ExcelAttachmentPreview bytes={bytes} />
}
