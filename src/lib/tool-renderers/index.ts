/**
 * QuickForge 工具渲染器（React）——NoteFlow 精简注册集。
 * 与 quickforge 原版相比移除了 ask-user / goal / todo-write / generate-image /
 * subagent 渲染器（依赖桌面版宿主），未注册的工具回落到默认渲染。
 */
export {
  LocalWorkspaceToolRenderer,
} from './local-workspace-tool-renderer'
export { McpToolRenderer, parseMcpToolName } from './mcp-tool-renderer'
export { elapsedMsFromTiming, formatDuration } from './shared'
export type { ToolResultLike, ToolStatusKey } from './shared'
