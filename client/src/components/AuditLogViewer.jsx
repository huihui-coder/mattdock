import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ScrollText, Search, RefreshCw, ChevronLeft, ChevronRight,
  LogIn, MessageSquare, Image, Download, Plane, Shield,
} from 'lucide-react'

const CATEGORY_TABS = [
  { key: '', label: '全部' },
  { key: 'auth', label: '登录' },
  { key: 'ai', label: 'AI 操作' },
  { key: 'flight', label: '飞行记录' },
]

const CATEGORY_ICONS = {
  auth: LogIn,
  ai: MessageSquare,
  flight: Plane,
  device: Shield,
  user: Shield,
  other: ScrollText,
}

const ACTION_ICONS = {
  'auth.login': LogIn,
  'auth.login_failed': LogIn,
  'auth.logout': LogIn,
  'ai.assistant.chat': MessageSquare,
  'ai.image.generate': Image,
  'ai.image.edit': Image,
  'ai.image.download': Download,
  'flight.export.records': Download,
  'flight.export.ranking': Download,
}

const STATUS_STYLES = {
  success: 'bg-emerald-50 text-emerald-700',
  denied: 'bg-amber-50 text-amber-700',
  error: 'bg-red-50 text-red-700',
}

const STATUS_LABELS = { success: '成功', denied: '拒绝', error: '失败' }

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() } })
}

function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { hour12: false })
}

function formatDetail(entry, actionLabels) {
  const d = entry.detail
  if (!d || typeof d !== 'object') return '—'
  if (d.promptPreview) {
    const extra = []
    if (d.hasImage) extra.push('含图片')
    if (d.historyCount) extra.push(`上下文 ${d.historyCount} 条`)
    if (d.promptLength) extra.push(`${d.promptLength} 字`)
    return `"${d.promptPreview}"${extra.length ? ` · ${extra.join(' · ')}` : ''}`
  }
  if (d.tabLabel) {
    const parts = [d.tabLabel]
    if (d.recordCount != null) parts.push(`${d.recordCount} 条记录`)
    if (d.rankCount != null) parts.push(`${d.rankCount} 台设备`)
    if (d.filename) parts.push(d.filename)
    return parts.join(' · ')
  }
  if (d.filename) return d.filename
  if (d.username && entry.action === 'auth.login_failed') return `尝试账号：${d.username}`
  if (d.model) {
    const parts = []
    if (d.promptPreview) parts.push(`"${d.promptPreview}"`)
    parts.push(d.model)
    if (d.n) parts.push(`${d.n} 张`)
    if (d.resolution) parts.push(d.resolution)
    if (d.resultCount) parts.push(`成功 ${d.resultCount} 张`)
    if (d.runtimeMs) parts.push(`${(d.runtimeMs / 1000).toFixed(1)}s`)
    return parts.join(' · ')
  }
  return Object.keys(d).length ? JSON.stringify(d).slice(0, 120) : '—'
}

function StatCard({ label, value, sub }) {
  return (
    <div className="ui-card px-4 py-3 min-w-[120px]">
      <p className="text-xs text-dji-muted">{label}</p>
      <p className="text-xl font-semibold text-dji-black tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-dji-subtle mt-0.5">{sub}</p>}
    </div>
  )
}

export default function AuditLogViewer() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [actionLabels, setActionLabels] = useState({})
  const [stats, setStats] = useState(null)
  const [category, setCategory] = useState('')
  const [username, setUsername] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [action, setAction] = useState('')
  const limit = 50

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (category) params.set('category', category)
      if (username) params.set('username', username)
      if (action) params.set('action', action)
      const res = await apiFetch(`/api/audit-logs?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载日志失败')
      setItems(data.items || [])
      setTotal(data.total || 0)
      setActionLabels(data.actionLabels || {})
      setStats(data.stats || null)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [offset, category, username, action])

  useEffect(() => { loadLogs() }, [loadLogs])

  useEffect(() => {
    const timer = setInterval(() => loadLogs(), 30000)
    return () => clearInterval(timer)
  }, [loadLogs])

  const page = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const statCards = useMemo(() => {
    if (!stats) return []
    const ai = (stats.byAction?.['ai.assistant.chat'] || 0)
      + (stats.byAction?.['ai.image.generate'] || 0)
      + (stats.byAction?.['ai.image.edit'] || 0)
      + (stats.byAction?.['ai.image.download'] || 0)
    const flight = (stats.byAction?.['flight.export.records'] || 0)
      + (stats.byAction?.['flight.export.ranking'] || 0)
    return [
      { label: '24h 操作', value: stats.total, sub: '近 24 小时' },
      { label: 'AI 相关', value: ai, sub: '对话 / 生图 / 下载' },
      { label: '导出操作', value: flight, sub: '飞行记录 / 排名' },
      { label: '活跃用户', value: Object.keys(stats.byUser || {}).length, sub: '有操作记录的账号' },
    ]
  }, [stats])

  const applyUsername = (e) => {
    e.preventDefault()
    setOffset(0)
    setUsername(usernameInput.trim())
  }

  const getActionIcon = (actionKey) => {
    const Icon = ACTION_ICONS[actionKey] || CATEGORY_ICONS.auth
    return Icon
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
            <ScrollText size={20} className="text-slate-600" aria-hidden />
            操作日志
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            记录各账号的登录、AI 对话、生图、飞行记录导出等操作，最多保留 2000 条
          </p>
        </div>
        <button
          type="button"
          onClick={loadLogs}
          disabled={loading}
          className="ui-btn-secondary shrink-0 cursor-pointer transition-colors duration-200"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
          刷新
        </button>
      </div>

      {statCards.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {statCards.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      )}

      <div className="ui-card p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setCategory(tab.key); setOffset(0) }}
              className={`px-3 py-1.5 rounded-lg text-sm border cursor-pointer transition-colors duration-200 ${
                category === tab.key
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-dji-ink border-dji-border hover:bg-dji-page'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form onSubmit={applyUsername} className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dji-muted" aria-hidden />
            <input
              type="search"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="按账号筛选"
              className="ui-input w-full pl-9"
            />
          </form>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setOffset(0) }}
            className="ui-input max-w-[220px] cursor-pointer"
            aria-label="操作类型"
          >
            <option value="">全部操作类型</option>
            {Object.entries(actionLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-dji-border text-dji-muted">
                <th className="text-left py-2.5 font-medium w-[160px]">时间</th>
                <th className="text-left py-2.5 font-medium w-[100px]">账号</th>
                <th className="text-left py-2.5 font-medium w-[140px]">操作</th>
                <th className="text-left py-2.5 font-medium">详情</th>
                <th className="text-left py-2.5 font-medium w-[80px]">状态</th>
                <th className="text-left py-2.5 font-medium w-[100px]">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-dji-muted">
                    暂无操作记录
                  </td>
                </tr>
              )}
              {items.map((entry) => {
                const Icon = getActionIcon(entry.action)
                const label = actionLabels[entry.action] || entry.action
                return (
                  <tr key={entry.id} className="border-b border-dji-border/50 hover:bg-dji-page transition-colors duration-200">
                    <td className="py-2.5 text-dji-muted tabular-nums text-xs whitespace-nowrap">
                      {formatTime(entry.timestamp)}
                    </td>
                    <td className="py-2.5 font-medium text-dji-black">
                      {entry.actor?.username || '—'}
                      {entry.actor?.role === 'admin' && (
                        <span className="ml-1 text-[10px] text-violet-600">管理员</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-dji-ink">
                        <Icon size={14} className="text-dji-muted shrink-0" aria-hidden />
                        {label}
                      </span>
                    </td>
                    <td className="py-2.5 text-dji-muted max-w-[360px] truncate" title={formatDetail(entry, actionLabels)}>
                      {formatDetail(entry, actionLabels)}
                    </td>
                    <td className="py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs ${STATUS_STYLES[entry.status] || STATUS_STYLES.success}`}>
                        {STATUS_LABELS[entry.status] || entry.status}
                      </span>
                    </td>
                    <td className="py-2.5 font-mono text-[11px] text-dji-subtle whitespace-nowrap">
                      {entry.ip || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-dji-border/60">
            <p className="text-xs text-dji-muted tabular-nums">
              共 {total} 条 · 第 {page} / {totalPages} 页
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={offset <= 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="p-2 rounded-lg border border-dji-border text-dji-ink hover:bg-dji-page disabled:opacity-40 cursor-pointer transition-colors duration-200"
                aria-label="上一页"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
                className="p-2 rounded-lg border border-dji-border text-dji-ink hover:bg-dji-page disabled:opacity-40 cursor-pointer transition-colors duration-200"
                aria-label="下一页"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
