import { useEffect, useState } from 'react'
import { Info, Keyboard, Palette, Settings2, X } from 'lucide-react'
import { getThemePreference, setThemePreference, type ThemePreference } from '../lib/theme'
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  formatShortcut,
  getShortcuts,
  resetShortcuts,
  saveShortcuts,
  shortcutConflict,
  type Shortcuts,
} from '../lib/shortcuts'
import { useToast } from './Toast'

type Props = {
  open: boolean
  onClose: () => void
  notesDir?: string
}

export function SettingsDialog({ open, onClose, notesDir }: Props) {
  const [theme, setTheme] = useState<ThemePreference>('dark')
  const [shortcuts, setShortcutsState] = useState<Shortcuts>(() => getShortcuts())
  const [recordingAction, setRecordingAction] = useState<ShortcutActionId | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (!open) return
    setTheme(getThemePreference())
    setShortcutsState(getShortcuts())
    setRecordingAction(null)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Settings2 className="size-4" />
            设置
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* 快捷键 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Keyboard className="size-3.5" />
              快捷键
              <button
                type="button"
                onClick={() => {
                  const defaults = resetShortcuts()
                  setShortcutsState(defaults)
                  toast.success('快捷键已恢复默认')
                }}
                className="ml-auto text-[11px] font-normal text-muted-foreground/70 hover:text-foreground"
              >
                恢复默认
              </button>
            </h3>
            <div className="space-y-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <ShortcutRow
                key={recordingAction ?? 'none'}
                shortcuts={shortcuts}
                recordingAction={recordingAction}
                onRecord={(action) => setRecordingAction((current) => (current === action ? null : action))}
                onKey={(action, key) => {
                  const next = { ...shortcuts, [action]: key }
                  const conflict = shortcutConflict(next, action)
                  if (conflict) {
                    const label = SHORTCUT_ACTIONS.find((item) => item.id === conflict)?.label ?? conflict
                    toast.error(`与「${label}」冲突，请换一个按键`)
                    return
                  }
                  setShortcutsState(next)
                  saveShortcuts(next)
                  setRecordingAction(null)
                }}
              />
              <p className="pt-1 text-[11px] text-muted-foreground/70">均为 Cmd/Ctrl + 字母组合；点击按键后直接按新字母键修改，Esc 取消。</p>
            </div>
          </section>

          {/* 外观 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Palette className="size-3.5" />
              外观
            </h3>
            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <span className="text-[13px] text-foreground">主题</span>
              <div className="flex gap-1">
                {(
                  [
                    ['light', '浅色'],
                    ['dark', '深色'],
                    ['system', '跟随系统'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setTheme(value)
                      setThemePreference(value)
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      theme === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 关于 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Info className="size-3.5" />
              关于
            </h3>
            <dl className="space-y-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-[12px]">
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">版本</dt>
                <dd className="truncate text-foreground">NoteFlow v1.3 · 基于 @shawnstack/quickforge</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">笔记目录</dt>
                <dd className="truncate text-foreground" title={notesDir}>
                  {notesDir ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">数据目录</dt>
                <dd className="truncate text-foreground">~/.noteflow</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

/** 快捷键行：展示 + 点击录入新字母键（Cmd/Ctrl 前缀固定） */
function ShortcutRow({
  shortcuts,
  recordingAction,
  onRecord,
  onKey,
}: {
  shortcuts: Shortcuts
  recordingAction: ShortcutActionId | null
  onRecord: (action: ShortcutActionId) => void
  onKey: (action: ShortcutActionId, key: string) => void
}) {
  useEffect(() => {
    if (!recordingAction) return
    const onCapture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        onRecord(recordingAction)
        return
      }
      const key = event.key.trim().toLowerCase()
      if (/^[a-z]$/.test(key)) onKey(recordingAction, key)
    }
    window.addEventListener('keydown', onCapture, true)
    return () => window.removeEventListener('keydown', onCapture, true)
  }, [recordingAction, onRecord, onKey])

  return (
    <>
      {SHORTCUT_ACTIONS.map((action) => {
        const recording = recordingAction === action.id
        return (
          <div key={action.id} className="flex items-center justify-between gap-4">
            <span title={action.description}>
              <span className="block text-[13px] text-foreground">{action.label}</span>
              <span className="block text-[11px] text-muted-foreground/70">{action.description}</span>
            </span>
            <button
              type="button"
              onClick={() => onRecord(action.id)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs tabular-nums ${
                recording
                  ? 'animate-pulse border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-border hover:text-foreground'
              }`}
              title={recording ? '按下新字母键（Esc 取消）' : '点击修改'}
            >
              {recording ? '按下按键…' : formatShortcut(shortcuts[action.id])}
            </button>
          </div>
        )
      })}
    </>
  )
}
