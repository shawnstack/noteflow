// 注意：必须是 CommonJS —— 沙箱渲染进程（默认 sandbox:true）不支持 ESM preload
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('noteflow', {
  platform: process.platform,
  setTheme(theme) {
    ipcRenderer.send('noteflow:theme', theme === 'light' ? 'light' : 'dark')
  },
  /** 窗口标题跟随当前项目 */
  setWindowTitle(title) {
    ipcRenderer.send('noteflow:set-title', String(title))
  },
  /** 原生目录选择框（添加项目用），取消返回 null */
  selectDirectory() {
    return ipcRenderer.invoke('noteflow:select-directory')
  },
  /** 在新窗口打开项目（同项目已有窗口时主进程聚焦该窗口） */
  openProjectWindow(projectId) {
    ipcRenderer.send('noteflow:open-project-window', String(projectId))
  },
  /** 主进程推送“打开方式”传来的文件（同项目窗口已开时，无需重载直接定位）；返回解绑函数 */
  onOpenFile(cb) {
    const listener = (_event, relPath) => cb(relPath)
    ipcRenderer.on('noteflow:open-file', listener)
    return () => ipcRenderer.removeListener('noteflow:open-file', listener)
  },
  window: {
    minimize: () => ipcRenderer.send('noteflow:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('noteflow:window', 'toggle-maximize'),
    close: () => ipcRenderer.send('noteflow:window', 'close'),
    isMaximized: () => ipcRenderer.invoke('noteflow:is-maximized'),
    onMaximizedChange: (cb) => {
      const listener = (_event, value) => cb(value)
      ipcRenderer.on('noteflow:maximized-changed', listener)
      return () => ipcRenderer.removeListener('noteflow:maximized-changed', listener)
    },
  },
})
