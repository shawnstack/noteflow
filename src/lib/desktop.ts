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
}

export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (window as Window & { noteflow?: DesktopBridge }).noteflow
  return bridge ?? null
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
