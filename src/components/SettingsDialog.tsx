import { useEffect, useMemo, useState } from 'react'
import { Bot, Info, Keyboard, Palette, Settings2, SlidersHorizontal, X } from 'lucide-react'
import { getActiveModel, getModelCatalog, setActiveModel } from '../lib/api'
import type { ModelLike } from '../lib/types'
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

export const PROTECTED_KEY = 'noteflow.chat.protected'
export const ATTACH_NOTE_KEY = 'noteflow.chat.attachNote'
export const FONT_SIZE_KEY = 'noteflow.messageFontSize'
export const SETTINGS_EVENT = 'noteflow:settings'

type Props = {
  open: boolean
  onClose: () => void
  onOpenSetup: () => void
  notesDir?: string
}

export function SettingsDialog({ open, onClose, onOpenSetup, notesDir }: Props) {
  const [catalog, setCatalog] = useState<ModelLike[]>([])
  const [activeModel, setActiveModelState] = useState<ModelLike | null>(null)
  const [protectedDefault, setProtectedDefault] = useState(false)
  const [attachNoteDefault, setAttachNoteDefault] = useState(true)
  const [fontSize, setFontSize] = useState(15)
  const [theme, setTheme] = useState<ThemePreference>('dark')
  const [shortcuts, setShortcutsState] = useState<Shortcuts>(() => getShortcuts())
  const [recordingAction, setRecordingAction] = useState<ShortcutActionId | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [models, active] = await Promise.all([getModelCatalog().catch(() => []), getActiveModel()])
      setCatalog(models)
      setActiveModelState(active)
    })()
    setProtectedDefault(localStorage.getItem(PROTECTED_KEY) === '1')
    setAttachNoteDefault(localStorage.getItem(ATTACH_NOTE_KEY) !== '0')
    setFontSize(Number(localStorage.getItem(FONT_SIZE_KEY)) || 15)
    setTheme(getThemePreference())
    setShortcutsState(getShortcuts())
    setRecordingAction(null)
  }, [open])

  const modelGroups = useMemo(
    () =>
      catalog.reduce<Record<string, ModelLike[]>>((acc, m) => {
        ;(acc[m.provider] ??= []).push(m)
        return acc
      }, {}),
    [catalog],
  )

  const applySetting = (key: string, value: string) => {
    localStorage.setItem(key, value)
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key, value } }))
  }

  const switchDefaultModel = async (next: ModelLike) => {
    setActiveModelState(next)
    try {
      await setActiveModel(next)
      toast.success(`默认模型已设为 ${next.provider} / ${next.id}（新对话生效）`)
    } catch (error) {
      toast.error(`设置失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

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
          {/* 默认模型 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Bot className="size-3.5" />
              默认模型
            </h3>
            <select
              value={activeModel ? `${activeModel.provider}/${activeModel.id}` : ''}
              onChange={(event) => {
                const found = catalog.find((m) => `${m.provider}/${m.id}` === event.target.value)
                if (found) void switchDefaultModel(found)
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {!activeModel && <option value="">未配置</option>}
              {Object.entries(modelGroups).map(([provider, models]) => (
                <optgroup key={provider} label={provider}>
                  {models.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                      {m.id}
                      {m.reasoning ? '（推理）' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/70">
              <span>新对话与重启后使用该模型</span>
              <button type="button" onClick={onOpenSetup} className="text-primary hover:underline">
                配置服务商（API Key）→
              </button>
            </p>
          </section>

          {/* 对话偏好 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <SlidersHorizontal className="size-3.5" />
              对话偏好
            </h3>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <input
                type="checkbox"
                checked={protectedDefault}
                onChange={(event) => {
                  setProtectedDefault(event.target.checked)
                  applySetting(PROTECTED_KEY, event.target.checked ? '1' : '0')
                }}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block text-[13px] text-foreground">默认开启写保护</span>
                <span className="block text-[11px] text-muted-foreground/70">新对话中 AI 修改笔记前需你批准（对话中可随时切换）</span>
              </span>
            </label>
            <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <input
                type="checkbox"
                checked={attachNoteDefault}
                onChange={(event) => {
                  setAttachNoteDefault(event.target.checked)
                  applySetting(ATTACH_NOTE_KEY, event.target.checked ? '1' : '0')
                }}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block text-[13px] text-foreground">默认附带当前笔记</span>
                <span className="block text-[11px] text-muted-foreground/70">发送消息时把正在查看的笔记内容注入上下文</span>
              </span>
            </label>
          </section>

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
            <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <span className="text-[13px] text-foreground">消息字号</span>
              <div className="flex gap-1">
                {[14, 15, 16, 17].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setFontSize(size)
                      localStorage.setItem(FONT_SIZE_KEY, String(size))
                      document.documentElement.style.setProperty('--quickforge-message-font-size', `${size}px`)
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      fontSize === size ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {size}
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
                <dd className="truncate text-foreground">NoteFlow v1.2 · 基于 @shawnstack/quickforge</dd>
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

/** 初始化持久化设置（字号等），App 启动时调用一次 */
export function initPersistedSettings() {
  const size = Number(localStorage.getItem(FONT_SIZE_KEY)) || 15
  document.documentElement.style.setProperty('--quickforge-message-font-size', `${size}px`)
}
