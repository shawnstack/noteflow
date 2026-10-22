import { fileKindFromPath } from '@/lib/file-kind'

export type ArtifactKind = 'html' | 'image' | 'markdown' | 'code' | 'pdf' | 'docx' | 'excel' | 'unknown'
export type DocumentFormat = 'pdf' | 'docx' | 'excel'

/**
 * 扩展名 → 预览 kind。规则唯一来源是 `src/lib/file-kind.ts`
 * （`binary`/`unknown` 统一折叠为 `unknown`——预览不支持二进制）。
 * 注意：`.mdx` 按 code 处理（file-kind 统一裁定）。
 */
export function inferArtifactKind(path: string): ArtifactKind {
  const kind = fileKindFromPath(path)
  return kind === 'binary' || kind === 'unknown' ? 'unknown' : kind
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
