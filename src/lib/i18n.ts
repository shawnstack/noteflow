/**
 * 极简双语翻译（中/英）。由原 QuickForge 快照精简而来：
 * 只保留笔记阅读器（代码块 / Mermaid / 文档预览 / 工作区文件树）
 * 仍在使用的 key，跟随浏览器语言自动选择。
 */

export type AppLanguage = 'en' | 'zh'

export const appTranslations = {
  en: {
    copyCode: 'Copy code',
    copiedBang: 'Copied!',
    svgPreviewMode: 'Preview',
    svgSourceMode: 'Source',
    mermaidPreviewLabel: 'Mermaid diagram preview',
    mermaidRendering: 'Rendering Mermaid diagram...',
    mermaidRenderFailed: 'Could not render this Mermaid diagram. Source is shown instead.',
    retry: 'Retry',
    attachmentPreviewLoading: 'Loading preview…',
    attachmentPreviewPage: 'Page {page}',
    attachmentExcelRowsTruncated: 'Showing the first {count} rows.',
    attachmentExcelColumnsTruncated: 'Showing the first {count} columns.',
    workspaceNoFilesToDisplay: 'No files to display.',
    workspaceEmptyDirectory: 'Empty directory',
    workspaceLoadMore: 'Load more',
    workspaceLoading: 'Loading workspace...',
    workspaceLoadFailed: 'Failed to load workspace.',
    openPreview: 'Open',
  },
  zh: {
    copyCode: '复制代码',
    copiedBang: '已复制！',
    svgPreviewMode: '预览',
    svgSourceMode: '源码',
    mermaidPreviewLabel: 'Mermaid 图表预览',
    mermaidRendering: '正在渲染 Mermaid 图表...',
    mermaidRenderFailed: '无法渲染此 Mermaid 图表，已保留源码。',
    retry: '重试',
    attachmentPreviewLoading: '正在加载预览…',
    attachmentPreviewPage: '第 {page} 页',
    attachmentExcelRowsTruncated: '仅显示前 {count} 行。',
    attachmentExcelColumnsTruncated: '仅显示前 {count} 列。',
    workspaceNoFilesToDisplay: '没有可显示的文件。',
    workspaceEmptyDirectory: '空目录',
    workspaceLoadMore: '加载更多',
    workspaceLoading: '正在加载工作空间...',
    workspaceLoadFailed: '加载工作空间失败。',
    openPreview: '打开',
  },
} as const

export type AppTextKey = keyof typeof appTranslations.en

function browserDefaultLanguage(): AppLanguage {
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh'
  }
  return 'en'
}

function setDocumentLanguage(language: AppLanguage) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  document.documentElement.dir = 'ltr'
}

let currentLanguage: AppLanguage = browserDefaultLanguage()
setDocumentLanguage(currentLanguage)

export function getAppLanguage(): AppLanguage {
  return currentLanguage
}

export function t(key: AppTextKey, params?: Record<string, string | number>) {
  let text: string = appTranslations[getAppLanguage()][key] ?? appTranslations.en[key]
  if (!params) return text
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}
