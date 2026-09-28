/**
 * 极简 storage stub（对接 QuickForge HTTP storage /api/storage/*）。
 * quickforge 聊天渲染层闭包只用到了 settings.get/set 与 providerKeys.get，
 * 这里提供结构兼容的 AppStorage 实现，不引入 quickforge 的完整 storage 层。
 */

type StoreName = string

async function httpGet<T>(store: StoreName, key: string): Promise<T | null> {
  try {
    const response = await fetch(`/api/storage/${store}/key/${encodeURIComponent(key)}`, { cache: 'no-store' })
    if (!response.ok) return null
    const payload = (await response.json().catch(() => null)) as { value: T | null } | null
    return payload?.value ?? null
  } catch {
    return null
  }
}

async function httpSet(store: StoreName, key: string, value: unknown): Promise<void> {
  await fetch(`/api/storage/${store}/key/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value }),
  })
}

export type KVStore = {
  get: <T = unknown>(key: string) => Promise<T | null>
  set: (key: string, value: unknown) => Promise<void>
}

export type AppStorage = {
  settings: KVStore
  providerKeys: KVStore
}

function createStore(store: StoreName): KVStore {
  return {
    get: <T,>(key: string) => httpGet<T>(store, key),
    set: (key: string, value: unknown) => httpSet(store, key, value),
  }
}

const appStorage: AppStorage = {
  settings: createStore('settings'),
  providerKeys: createStore('provider-keys'),
}

export function getAppStorage(): AppStorage {
  return appStorage
}
