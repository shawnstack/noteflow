/**
 * process-folding stub：quickforge 桌面版的 DOM 分组装饰在 NoteFlow 中未启用，
 * 仅保留 ChatSurface 引用的 releaseProcessGroups 接口（无操作，恒返回 0 组）。
 */
export interface ProcessGroupReleaseStats {
  groups: number
  restored: number
  dropped: number
}

export function releaseProcessGroups(_root: HTMLElement, _streamingOnly = false): ProcessGroupReleaseStats {
  return { groups: 0, restored: 0, dropped: 0 }
}
