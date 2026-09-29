import { SETTINGS_EVENT } from '../components/SettingsDialog'

export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_KEY = 'noteflow.theme'

/** 未设置过主题时的默认值：保持 NoteFlow 一贯的深色观感 */
export const DEFAULT_THEME: ThemePreference = 'dark'

export function normalizeTheme(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME
}

export function getThemePreference(): ThemePreference {
  return normalizeTheme(localStorage.getItem(THEME_KEY))
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 解析偏好得到实际生效的主题（system 时跟随系统） */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

/** Electron preload 注入；浏览器里不存在 */
function syncNativeTitleBar(theme: 'light' | 'dark') {
  const bridge = (window as Window & { noteflow?: { setTheme?: (theme: 'light' | 'dark') => void } }).noteflow
  bridge?.setTheme?.(theme)
}

/** 仅 Windows 桌面版启用标题栏覆盖（mac 有原生标题栏，浏览器无） */
function isWindowsOverlay(): boolean {
  const bridge = (window as Window & { noteflow?: { platform?: string; setTheme?: unknown } }).noteflow
  return bridge?.platform === 'win32' && typeof bridge.setTheme === 'function'
}

/** 把主题应用到 <html>：切换 .dark 类 + color-scheme（同步原生滚动条/表单控件） */
export function applyTheme(pref: ThemePreference) {
  const theme = resolveTheme(pref)
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('nf-win-titlebar', isWindowsOverlay())
  root.style.setProperty('color-scheme', theme)
  syncNativeTitleBar(theme)
}

let mediaListenerAttached = false

/**
 * 应用启动时调用：读 localStorage 应用主题；
 * system 模式下监听系统外观变化实时切换。
 */
export function initTheme() {
  const pref = getThemePreference()
  applyTheme(pref)

  if (!mediaListenerAttached) {
    mediaListenerAttached = true
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', () => {
      // 仅 system 模式跟随系统；用户显式选择的主题不受影响
      if (getThemePreference() === 'system') applyTheme('system')
    })
  }
}

/** 设置对话框用：持久化 + 应用 + 广播（与其他设置项一致的事件模式） */
export function setThemePreference(pref: ThemePreference) {
  localStorage.setItem(THEME_KEY, pref)
  applyTheme(pref)
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key: THEME_KEY, value: pref } }))
}
