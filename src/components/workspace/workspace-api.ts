import type { WorkspaceChildrenResponse } from './workspace-types'

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }
  return payload as T
}

export function getWorkspaceChildren(projectId: string, path = '.', cursor?: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ projectId, path })
  if (cursor) params.set('cursor', cursor)
  return fetchJson<WorkspaceChildrenResponse>(`/api/workspace/children?${params}`, signal)
}
