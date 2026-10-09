/**
 * Electron preload 注入的桌面能力桥（Web 模式下不存在，全部可选）。
 * 集中收敛类型声明，组件内不直接 as 断言。
 */

export type DesktopBridge = {
  platform?: string
  /** 更新原生窗口标题 */
  setWindowTitle?: (title: string) => void
  /** 原生目录选择框，取消返回 null */
  selectDirectory?: () => Promise<string | null>
  /** 在新窗口打开指定项目（同项目已有窗口时主进程聚焦该窗口） */
  openProjectWindow?: (projectId: string) => void
  /** 主进程推送右键“打开方式”传入的文件相对路径（同项目窗口已开时定位到该文件）；返回解绑函数 */
  onOpenFile?: (cb: (relPath: string) => void) => () => void
}

export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (window as Window & { noteflow?: DesktopBridge }).noteflow
  return bridge ?? null
}

export type AppPlatform = 'win32' | 'darwin' | 'linux'

/**
 * 当前运行平台（文案 / 行为差异用）：
 * Electron 用 preload 注入的 process.platform；Web 退化为 UA 推断（服务通常同机）。
 */
export function getPlatform(): AppPlatform {
  const injected = getDesktopBridge()?.platform || ''
  const ua = navigator.userAgent
  const raw = injected || (/mac|iphone|ipad/i.test(ua) ? 'darwin' : /win/i.test(ua) ? 'win32' : 'linux')
  if (raw.startsWith('win')) return 'win32'
  if (raw === 'darwin') return 'darwin'
  return 'linux'
}

/** 是否运行在 Electron 桌面环境 */
export function isDesktop(): boolean {
  return getDesktopBridge() !== null
}

/**
 * 在独立窗口打开项目：
 * - Electron：走主进程（同项目已有窗口则聚焦，一项目一窗口）；
 * - Web：退化为新浏览器标签页打开同应用并带 ?project= 参数。
 */
export function openProjectInNewWindow(projectId: string): void {
  const bridge = getDesktopBridge()
  if (bridge?.openProjectWindow) {
    bridge.openProjectWindow(projectId)
    return
  }
  const url = new URL(window.location.href)
  url.searchParams.set('project', projectId)
  window.open(url.toString(), '_blank')
}
