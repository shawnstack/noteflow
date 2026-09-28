import { useState } from 'react'
import { PlugZap, X } from 'lucide-react'
import { saveOpenAICompatProvider, setActiveModel, testConnection } from '../lib/api'
import type { ModelLike } from '../lib/types'

type Preset = { label: string; providerName: string; baseUrl: string; modelId: string }

const PRESETS: Preset[] = [
  { label: 'DeepSeek', providerName: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat' },
  { label: 'OpenAI', providerName: 'openai', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini' },
  { label: 'OpenRouter', providerName: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'anthropic/claude-sonnet-4' },
  { label: 'Kimi', providerName: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', modelId: 'kimi-k2-0905-preview' },
  { label: '通义千问', providerName: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus' },
  { label: '智谱', providerName: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelId: 'glm-4-plus' },
]

type Props = {
  open: boolean
  onClose: () => void
  onConfigured: (model: ModelLike) => void
}

export function SetupDialog({ open, onClose, onConfigured }: Props) {
  const [providerName, setProviderName] = useState('deepseek')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('deepseek-chat')
  const [reasoning, setReasoning] = useState(false)
  const [status, setStatus] = useState<'idle' | 'testing' | 'saving' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const applyPreset = (preset: Preset) => {
    setProviderName(preset.providerName)
    setBaseUrl(preset.baseUrl)
    setModelId(preset.modelId)
  }

  const buildModel = (): ModelLike => ({
    id: modelId.trim(),
    provider: providerName.trim(),
    api: 'openai-completions',
    baseUrl: baseUrl.trim(),
    reasoning,
    input: ['text'],
    output: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  })

  const handleTest = async () => {
    setStatus('testing')
    setError(null)
    try {
      await testConnection(buildModel(), apiKey.trim())
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(`连接失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSave = async () => {
    if (!apiKey.trim() || !modelId.trim() || !baseUrl.trim() || !providerName.trim()) {
      setStatus('error')
      setError('请完整填写服务商名称、Base URL、API Key 与模型 ID')
      return
    }
    setStatus('saving')
    setError(null)
    try {
      const model = await saveOpenAICompatProvider({
        providerName: providerName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelId: modelId.trim(),
        modelName: modelId.trim(),
        reasoning,
      })
      await setActiveModel(model)
      setStatus('idle')
      onConfigured(model)
      onClose()
    } catch (err) {
      setStatus('error')
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <PlugZap className="size-4 text-indigo-400" />
            配置 AI 模型（OpenAI 兼容）
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <p className="mb-1.5 text-[11px] text-muted-foreground">快速预设</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    providerName === preset.providerName
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                      : 'border-border text-muted-foreground hover:border-ring hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="服务商名称（英文小写）" value={providerName} onChange={setProviderName} placeholder="deepseek" />
          <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.deepseek.com/v1" />
          <Field label="API Key" value={apiKey} onChange={setApiKey} placeholder="sk-…" password />
          <Field label="模型 ID" value={modelId} onChange={setModelId} placeholder="deepseek-chat" />

          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={reasoning} onChange={(event) => setReasoning(event.target.checked)} className="accent-indigo-500" />
            推理模型（DeepSeek R1 / QwQ 等思考型模型）
          </label>

          {error && <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-400">{error}</p>}

          <p className="text-[11px] leading-5 text-muted-foreground/70">
            配置保存在本机 QuickForge 服务的数据目录中（~/.noteflow），仅用于NoteFlow的对话与写作辅助。
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={status === 'testing' || status === 'saving'}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:border-ring disabled:opacity-40"
          >
            {status === 'testing' ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={status === 'testing' || status === 'saving'}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {status === 'saving' ? '保存中…' : '保存并启用'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  password,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  password?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted-foreground">{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
      />
    </label>
  )
}
