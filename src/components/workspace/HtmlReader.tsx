import { workspacePreviewUrl } from './artifact-preview-utils'

/**
 * HTML 阅读器：沙箱 iframe 渲染（`sandbox=""` 完全限制——禁脚本/表单/同源），
 * 防止本地文件里的恶意脚本借预览执行。需要脚本的页面请用编辑模式看源码。
 */

type HtmlReaderProps = {
  projectId: string
  path: string
}

export function HtmlReader({ projectId, path }: HtmlReaderProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border px-4 py-1 text-[11px] text-muted-foreground/70">
        预览已禁用脚本（sandbox）· 切到「编辑」查看源码
      </div>
      <iframe
        title={path}
        src={workspacePreviewUrl(projectId, path)}
        sandbox=""
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  )
}
