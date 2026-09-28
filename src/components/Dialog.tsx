/**
 * useDialog：NoteFlow 的确认/输入弹窗统一入口。
 * 直接复用 quickforge 的 showConfirm / showPrompt（命令式 API，自带 portal 渲染，
 * 样式与交互与 quickforge 完全一致，无需 Provider）。
 */
import { useCallback } from 'react'
import { showConfirm } from './ui/confirm-dialog'
import { showPrompt } from './ui/prompt-dialog'

type ConfirmOptions = {
  title: string
  message?: string
  confirmText?: string
  danger?: boolean
}

type PromptOptions = {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
}

export function useDialog() {
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      showConfirm({
        title: options.title,
        description: options.message ?? '',
        confirmLabel: options.confirmText,
        variant: options.danger ? 'destructive' : 'default',
      }),
    [],
  )

  const prompt = useCallback(
    (options: PromptOptions) =>
      showPrompt({
        title: options.title,
        description: options.message,
        placeholder: options.placeholder,
        defaultValue: options.defaultValue,
        confirmLabel: options.confirmText,
      }),
    [],
  )

  return { confirm, prompt }
}
