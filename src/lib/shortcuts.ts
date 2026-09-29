import { useEffect, useState } from 'react'

/** 可自定义的快捷键动作（均为 Cmd/Ctrl + 单字母） */
export type ShortcutActionId = 'save' | 'newNote' | 'dailyNote' | 'search' | 'closeTab'

export const SHORTCUT_ACTIONS: { id: ShortcutActionId; label: string; defaultKey: string; description: string }[] = [
  { id: 'save', label: '保存笔记', defaultKey: 's', description: '保存当前正在编辑的笔记' },
  { id: 'newNote', label: '新建笔记', defaultKey: 'n', description: '弹出输入框创建新笔记' },
  { id: 'dailyNote', label: '打开日记', defaultKey: 'd', description: '打开或创建今天的日记' },
  { id: 'search', label: '搜索', defaultKey: 'p', description: '打开文件名/全文搜索' },
  { id: 'closeTab', label: '关闭标签', defaultKey: 'w', description: '关闭当前打开的标签页' },
]

export const SHORTCUTS_KEY = 'noteflow.shortcuts'
export const SHORTCUTS_EVENT = 'noteflow:shortcuts'

export type Shortcuts = Record<ShortcutActionId, string>

function normalizeKey(key: string): string {
  const normalized = key.trim().toLowerCase()
  return /^[a-z]$/.test(normalized) ? normalized : ''
}

function withDefaults(stored: Partial<Record<ShortcutActionId, string>> | null): Shortcuts {
  const result = {} as Shortcuts
  for (const action of SHORTCUT_ACTIONS) {
    const key = stored?.[action.id] ? normalizeKey(stored[action.id]!) : ''
    result[action.id] = key || action.defaultKey
  }
  return result
}

export function getShortcuts(): Shortcuts {
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY)
    return withDefaults(raw ? (JSON.parse(raw) as Partial<Shortcuts>) : null)
  } catch {
    return withDefaults(null)
  }
}

export function saveShortcuts(next: Shortcuts) {
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT, { detail: { value: next } }))
}

export function resetShortcuts() {
  localStorage.removeItem(SHORTCUTS_KEY)
  const defaults = withDefaults(null)
  window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT, { detail: { value: defaults } }))
  return defaults
}

/** 修改单个快捷键；返回 null 表示与其它动作冲突（冲突动作 id 一并返回） */
export function shortcutConflict(next: Shortcuts, action: ShortcutActionId): ShortcutActionId | null {
  for (const item of SHORTCUT_ACTIONS) {
    if (item.id !== action && next[item.id] === next[action]) return item.id
  }
  return null
}

/** 键盘事件是否命中某动作（Cmd/Ctrl + 配置字母） */
export function matchesShortcut(event: KeyboardEvent, key: string): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false
  return event.key.toLowerCase() === key
}

/** 展示用文案：Mac 显示 ⌘X，其它平台显示 Ctrl+X */
export function formatShortcut(key: string): string {
  const isMac = /mac|iphone|ipad/i.test(navigator.userAgent)
  return `${isMac ? '⌘' : 'Ctrl+'}${key.toUpperCase()}`
}

/** 订阅快捷键配置（localStorage + 事件广播，变更即时生效） */
export function useShortcuts(): Shortcuts {
  const [shortcuts, setShortcutsState] = useState<Shortcuts>(() => getShortcuts())
  useEffect(() => {
    const refresh = () => setShortcutsState(getShortcuts())
    window.addEventListener(SHORTCUTS_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(SHORTCUTS_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return shortcuts
}
