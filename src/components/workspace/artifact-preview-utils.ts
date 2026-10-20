import { fileKindFromPath } from '@/lib/file-kind'

export type ArtifactKind = 'html' | 'image' | 'markdown' | 'code' | 'pdf' | 'docx' | 'excel' | 'unknown'
export type DocumentFormat = 'pdf' | 'docx' | 'excel'

export function artifactFileName(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || normalized || 'artifact'
}

/**
 * 扩展名 → 产物 kind。规则唯一来源是 `src/lib/file-kind.ts`
 * （`binary`/`unknown` 对产物列表统一折叠为 `unknown`——产物预览不支持二进制）。
 * 注意：`.mdx` 按 code 处理（file-kind 统一裁定）。
 */
export function inferArtifactKind(path: string): ArtifactKind {
  const kind = fileKindFromPath(path)
  return kind === 'binary' || kind === 'unknown' ? 'unknown' : kind
}

export function documentFormatFromPath(path: string): DocumentFormat | undefined {
  const kind = inferArtifactKind(path)
  if (kind === 'pdf' || kind === 'docx' || kind === 'excel') return kind
  return undefined
}

export function isDocumentPreviewablePath(path: string) {
  return documentFormatFromPath(path) !== undefined
}

// 「可自动展示」的文件类型：所有已有 Browser/Reader 类型，以及本期支持的文档类型。
// Browser、Reader 与 Document 的具体分流由 artifactPreviewMode 统一决定。
export function isPreviewablePath(path: string) {
  const kind = inferArtifactKind(path)
  return kind !== 'unknown'
}

// Browser iframe 仅支持 HTML 与可直接显示的图片类型。
// 与 server 的 PREVIEW_ALLOWED_EXTENSIONS 图片子集对齐（不含 .bmp）。
const BROWSER_PREVIEWABLE_IMAGE_RE = /\.(svg|png|jpe?g|webp|gif|ico)$/i

export function isBrowserPreviewablePath(path: string) {
  return inferArtifactKind(path) === 'html' || BROWSER_PREVIEWABLE_IMAGE_RE.test(path)
}

export function artifactPreviewMode(path: string, kind: ArtifactKind = inferArtifactKind(path)): 'browser' | 'reader' | 'document' | undefined {
  if (kind === 'markdown' || kind === 'code') return 'reader'
  if (kind === 'pdf' || kind === 'docx' || kind === 'excel') return 'document'
  if ((kind === 'html' || kind === 'image') && isBrowserPreviewablePath(path)) return 'browser'
  return undefined
}

export function workspaceArtifactDiskPath(workspaceRoot: string | undefined, artifactPath: string) {
  const normalizedArtifactPath = artifactPath.replace(/\\/g, '/')
  if (!workspaceRoot?.trim() || normalizedArtifactPath.startsWith('/') || /^[a-zA-Z]:\//.test(normalizedArtifactPath)) return artifactPath

  const normalizedRoot = workspaceRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const relativePath = normalizedArtifactPath.replace(/^\/+/, '')
  return `${normalizedRoot}/${relativePath}`
}

export function workspacePreviewUrl(projectId: string, path: string, reloadToken?: number) {
  const normalizedPath = path.replace(/\\/g, '/')
  const leadingSlashes = normalizedPath.match(/^\/+/)?.[0] ?? ''
  const encodedPath = leadingSlashes + normalizedPath
    .slice(leadingSlashes.length)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')
  const base = `/api/workspace/preview/${encodeURIComponent(projectId)}/${encodedPath}`
  return reloadToken ? `${base}?r=${reloadToken}` : base
}
