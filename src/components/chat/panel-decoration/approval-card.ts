/**
 * quickforge 原生工具审批卡（DOM 装饰层移植版）。
 *
 * 结构、类名、文案 key 均对齐 quickforge v2.2.0 官方宿主的审批装饰
 * （`.quickforge-approval-card` 系列样式见 quickforge-surface.css）。
 * 渲染目标：ChatSurface 的 `.qf-message-list` 底部（与官方一致，非浮层）。
 */
import { t } from '@/lib/i18n'
import type { AppTextKey } from '@/lib/i18n'
import type { PendingApproval } from '@/lib/types'

type ApprovalSource = PendingApproval['source']

type ImpactRow = { label: string; value: string }

type ApprovalCopy = {
  tone: 'warning' | 'info'
  status: string
  title: string
  risk: string
  approveLabel: string
  rejectLabel: string
  badges: string[]
  criticalParameters: ImpactRow[]
  keySummary: string
  details: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const TOOL_NAME_KEYS: Record<string, AppTextKey> = {
  manage_global_memory: 'manageGlobalMemory',
  read_file: 'readFile',
  grep_files: 'searchFiles',
  write_file: 'writeFile',
  edit_file: 'editFile',
  run_command: 'runCommand',
  present_files: 'presentFiles',
  activate_skill: 'activateSkill',
  read_skill_resource: 'readSkillResource',
  run_subagent: 'runSubagent',
  generate_image: 'generateImage',
}

function parseMcpTool(name: string): { serverName: string; toolName: string } | null {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const idx = rest.indexOf('__')
  if (idx <= 0 || idx >= rest.length - 2) return null
  return { serverName: rest.slice(0, idx), toolName: rest.slice(idx + 2) }
}

function parsePluginTool(name: string): { pluginName: string; toolName: string } | null {
  if (typeof name !== 'string' || !name.startsWith('plugin__')) return null
  const rest = name.slice(8)
  const idx = rest.indexOf('__')
  if (idx <= 0 || idx >= rest.length - 2) return null
  return { pluginName: rest.slice(0, idx), toolName: rest.slice(idx + 2) }
}

function toolDisplayName(name: string): string {
  const key = TOOL_NAME_KEYS[name]
  if (key) return t(key)
  const mcp = parseMcpTool(name)
  if (mcp) return `MCP · ${mcp.serverName} · ${mcp.toolName}`
  const plugin = parsePluginTool(name)
  if (plugin) return `Plugin · ${plugin.pluginName} · ${plugin.toolName}`
  return name
}

function summarizeKeyArgs(toolName: string, args: Record<string, unknown>): string {
  if (typeof args.summary === 'string') return args.summary
  if (toolName === 'run_command' && typeof args.command === 'string') return args.command
  if (toolName === 'activate_skill' && typeof args.name === 'string') return args.name
  if (typeof args.path === 'string') return args.path
  if (typeof args.query === 'string') return args.query
  if (typeof args.name === 'string') return args.name
  return ''
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildCopy(toolName: string, args: Record<string, unknown>, source: ApprovalSource): ApprovalCopy {
  const mcp = parseMcpTool(toolName)
  const plugin = parsePluginTool(toolName)
  const badges: string[] = []
  const criticalParameters: ImpactRow[] = []
  if (mcp) {
    criticalParameters.push(
      { label: t('toolApprovalSource'), value: 'MCP' },
      { label: t('toolApprovalServer'), value: mcp.serverName },
      { label: t('toolApprovalTool'), value: mcp.toolName },
    )
    badges.push('MCP')
  } else if (plugin) {
    criticalParameters.push(
      { label: t('toolApprovalSource'), value: 'Plugin' },
      { label: t('toolApprovalPlugin'), value: plugin.pluginName },
      { label: t('toolApprovalTool'), value: plugin.toolName },
    )
    badges.push('Plugin')
  }
  const subagent = source?.type === 'subagent' ? source.label || source.subagent || 'Subagent' : ''
  if (subagent) badges.push(subagent)
  if (typeof args.path === 'string' && args.path) criticalParameters.push({ label: t('toolApprovalPath'), value: args.path })
  if (typeof args.command === 'string' && args.command) criticalParameters.push({ label: t('toolApprovalCommand'), value: args.command })

  const risk =
    toolName === 'run_command'
      ? t('toolApprovalRiskCommand')
      : toolName === 'write_file' || toolName === 'edit_file'
        ? t('toolApprovalRiskFileChange')
        : mcp || plugin
          ? t('toolApprovalRiskExternal')
          : t('toolApprovalRiskGeneric')

  return {
    tone: 'warning',
    status: t('toolApprovalNeedsConfirmation'),
    title: toolDisplayName(toolName),
    risk,
    approveLabel: t('toolApprovalAccept'),
    rejectLabel: t('toolApprovalReject'),
    badges,
    criticalParameters,
    keySummary: summarizeKeyArgs(toolName, args),
    details: safeStringify(args),
  }
}

function diffHtml(oldText: string, newText: string): string {
  const lines: string[] = []
  for (const line of oldText.split('\n')) {
    lines.push(`<span style="color:rgb(153 27 27);background:rgba(239,68,68,.12);display:block;">- ${escapeHtml(line)}</span>`)
  }
  for (const line of newText.split('\n')) {
    lines.push(`<span style="color:rgb(22 101 52);background:rgba(34,197,94,.14);display:block;">+ ${escapeHtml(line)}</span>`)
  }
  return lines.join('\n')
}

function buildImpactHtml(toolName: string, args: Record<string, unknown>, copy: ApprovalCopy): string {
  const rows = copy.criticalParameters
    .map(({ label, value }) =>
      toolName === 'run_command' && value === args.command
        ? '' /* 命令已由下方命令预览展示，避免重复 */
        : `<div class="quickforge-approval-impact-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('')
  let preview = ''
  if (toolName === 'run_command' && typeof args.command === 'string') {
    preview = `<pre class="quickforge-approval-code"><span class="quickforge-approval-prompt">$</span> ${escapeHtml(args.command)}</pre>`
  } else if (toolName === 'edit_file') {
    preview = `<pre class="quickforge-approval-code">${diffHtml(String(args.oldText ?? ''), String(args.newText ?? ''))}</pre>`
  } else if (toolName === 'write_file' && typeof args.content === 'string') {
    const truncated = args.content.length > 800
    preview = `<pre class="quickforge-approval-code">${escapeHtml(args.content.slice(0, 800))}${truncated ? `\n${escapeHtml(t('toolApprovalTruncated'))}` : ''}</pre>`
  } else if (copy.keySummary && !copy.criticalParameters.some(({ value }) => value === copy.keySummary)) {
    preview = `<pre class="quickforge-approval-code">${escapeHtml(copy.keySummary)}</pre>`
  }
  return rows || preview ? `<div class="quickforge-approval-impact">${rows}${preview}</div>` : ''
}

const WARNING_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`
const INFO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>`

/** 清空面板内的审批卡（approval 变化 / tool_execution_start 时调用） */
export function clearToolApprovalCards(panel: HTMLElement) {
  panel.querySelectorAll('.quickforge-approval-card').forEach((card) => card.remove())
}

/**
 * 渲染工具审批卡（quickforge 原生样式）。
 * onApprove / onReject 抛错时卡片保留并显示错误 + 重试。
 */
export function renderToolApprovalCard(
  options: { panel: HTMLElement; onApprove: () => Promise<void>; onReject: () => Promise<void> },
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  source?: ApprovalSource,
) {
  const { panel, onApprove, onReject } = options
  const copy = buildCopy(toolName, args, source)
  const signature = JSON.stringify({ toolName, toolCallId, tone: copy.tone, status: copy.status, title: copy.title })
  const existing = panel.querySelector(`.quickforge-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
  if ((existing as HTMLElement | null)?.dataset.displaySignature === signature) return
  clearToolApprovalCards(panel)

  const card = document.createElement('section')
  card.className = `quickforge-approval-card quickforge-approval-card--${copy.tone}`
  card.dataset.toolCallId = toolCallId
  card.dataset.displaySignature = signature

  const body = document.createElement('div')
  body.className = 'quickforge-approval-body'
  body.innerHTML = `
    <div class="quickforge-approval-status-row">
      <div class="quickforge-approval-status">${copy.tone === 'info' ? INFO_ICON : WARNING_ICON}<span>${escapeHtml(copy.status)}</span></div>
      ${copy.badges.length ? `<div class="quickforge-approval-badges">${copy.badges.map((badge) => `<span class="quickforge-approval-badge">${escapeHtml(badge)}</span>`).join('')}</div>` : ''}
    </div>
    <h3 class="quickforge-approval-title">${escapeHtml(copy.title)}</h3>
    <p class="quickforge-approval-risk">${escapeHtml(copy.risk)}</p>
    ${buildImpactHtml(toolName, args, copy)}
  `

  /* 完整参数折叠 */
  const details = document.createElement('div')
  details.className = 'quickforge-approval-details'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'quickforge-approval-details-toggle'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`
  const toggleLabel = document.createElement('span')
  toggleLabel.textContent = t('toolApprovalViewDetails')
  toggle.append(toggleLabel)
  const detailsContent = document.createElement('div')
  detailsContent.className = 'quickforge-approval-details-content'
  detailsContent.innerHTML = `<pre class="quickforge-approval-code">${escapeHtml(copy.details)}</pre>`
  toggle.addEventListener('click', (event) => {
    event.stopPropagation()
    const open = details.classList.toggle('quickforge-approval-details--open')
    toggle.setAttribute('aria-expanded', String(open))
    toggleLabel.textContent = t(open ? 'toolApprovalHideDetails' : 'toolApprovalViewDetails')
  })
  details.append(toggle, detailsContent)
  body.append(details)

  /* 错误/状态消息 */
  const message = document.createElement('div')
  message.className = 'quickforge-approval-message'
  message.hidden = true

  /* 操作按钮（官方顺序：拒绝在左、批准在右） */
  const actions = document.createElement('div')
  actions.className = 'quickforge-approval-actions'
  const approveButton = document.createElement('button')
  approveButton.type = 'button'
  approveButton.className = 'quickforge-approval-button quickforge-approval-button--primary'
  approveButton.textContent = copy.approveLabel
  const rejectButton = document.createElement('button')
  rejectButton.type = 'button'
  rejectButton.className = 'quickforge-approval-button quickforge-approval-button--reject'
  rejectButton.textContent = copy.rejectLabel

  const setBusy = (busy: boolean, target?: HTMLButtonElement) => {
    approveButton.disabled = busy
    rejectButton.disabled = busy
    approveButton.classList.toggle('quickforge-approval-button--loading', busy && target === approveButton)
    rejectButton.classList.toggle('quickforge-approval-button--loading', busy && target === rejectButton)
    if (busy && target) target.textContent = t('toolApprovalSubmitting')
  }

  const run = async (action: () => Promise<void>, target: HTMLButtonElement, doneLabel: string) => {
    message.hidden = true
    message.textContent = ''
    setBusy(true, target)
    try {
      await action()
    } catch (error) {
      message.textContent = error instanceof Error && error.message ? error.message : t('toolApprovalFailed')
      message.hidden = false
      setBusy(false)
      target.textContent = t('toolApprovalRetry')
      const other = target === approveButton ? rejectButton : approveButton
      other.textContent = target === approveButton ? copy.rejectLabel : copy.approveLabel
      return
    }
    target.textContent = doneLabel
  }

  approveButton.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    void run(onApprove, approveButton, copy.approveLabel)
  })
  rejectButton.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    void run(onReject, rejectButton, copy.rejectLabel)
  })
  actions.append(rejectButton, approveButton)
  body.append(message, actions)
  card.append(body)

  /* 挂载到消息流底部（官方行为），随后平滑滚动入视野 */
  const messageList = panel.querySelector('.qf-message-list')
  const surfaceRoot = panel.querySelector('.qf-chat-panel')
  if (messageList) messageList.append(card)
  else if (surfaceRoot) surfaceRoot.append(card)
  else panel.append(card)
  card.scrollIntoView({ behavior: 'smooth', block: 'end' })
}
