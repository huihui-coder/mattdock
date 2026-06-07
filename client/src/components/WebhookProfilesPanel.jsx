import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Link2,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook,
  X,
  XCircle,
} from 'lucide-react'
import { TYPE_LABELS, WebhookTypeBadge, WebhookTypeIcon } from './WebhookTypeIcon'

const EMPTY_FORM = {
  id: '',
  name: '',
  remark: '',
  type: 'wecom',
  url: '',
  enabled: true,
}

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

function StatusBadge({ profile }) {
  if (!profile.enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5">
        已停用
      </span>
    )
  }
  if (profile.lastTestStatus === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5">
        <CheckCircle2 size={12} aria-hidden />
        测试通过
      </span>
    )
  }
  if (profile.lastTestStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-0.5">
        <XCircle size={12} aria-hidden />
        测试失败
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5">
      待测试
    </span>
  )
}

function ToggleSwitch({ enabled, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 cursor-pointer ${
        enabled ? 'bg-blue-600' : 'bg-slate-300'
      }`}
      aria-pressed={enabled}
      aria-label={label}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function WebhookProfilesPanel({ onChanged }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/webhook-profiles')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载 Webhook 配置失败')
      setProfiles(data.profiles || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  const openEdit = (profile) => {
    setEditing(profile)
    setForm({
      id: profile.id,
      name: profile.name || '',
      remark: profile.remark || '',
      type: profile.type || 'wecom',
      url: profile.url || '',
      enabled: profile.enabled !== false,
    })
    setModalOpen(true)
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        id: form.id,
        name: form.name,
        remark: form.remark,
        type: form.type,
        url: form.url,
        enabled: form.enabled,
      }
      const url = editing
        ? `/api/webhook-profiles/${encodeURIComponent(editing.id)}`
        : '/api/webhook-profiles'
      const res = await apiFetch(url, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      setModalOpen(false)
      await loadProfiles()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (profile) => {
    setError('')
    try {
      const res = await apiFetch(`/api/webhook-profiles/${encodeURIComponent(profile.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !profile.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新失败')
      await loadProfiles()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  const testProfile = async (profile) => {
    setTestingId(profile.id)
    setError('')
    try {
      const res = await apiFetch(`/api/webhook-profiles/${encodeURIComponent(profile.id)}/test`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '测试失败')
      await loadProfiles()
    } catch (err) {
      setError(err.message)
    } finally {
      setTestingId(null)
    }
  }

  const removeProfile = async (profile) => {
    if (!window.confirm(`确定删除 Webhook「${profile.name}」？`)) return
    setError('')
    try {
      const res = await apiFetch(`/api/webhook-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      await loadProfiles()
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  const stats = useMemo(() => ({
    total: profiles.length,
    enabled: profiles.filter((p) => p.enabled !== false).length,
    inUse: profiles.filter((p) => (p.boundRegions?.length || p.usageCount || 0) > 0).length,
  }), [profiles])

  return (
    <section className="ui-card overflow-hidden">
      <div className="px-4 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Webhook size={18} className="text-blue-600" aria-hidden />
            <h2 className="text-sm font-semibold text-slate-800">Webhook 管理</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            集中管理企业微信、飞书、钉钉等推送地址；各组织在下方选择绑定，无需重复填写 URL。
          </p>
        </div>
        <button type="button" onClick={openCreate} className="ui-btn-primary !text-xs shrink-0 cursor-pointer">
          <Plus size={14} aria-hidden />
          添加 Webhook
        </button>
      </div>

      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-slate-100 bg-slate-50/50">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[11px] text-slate-500">配置总数</p>
          <p className="text-xl font-semibold text-slate-800 tabular-nums mt-0.5">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[11px] text-slate-500">已启用</p>
          <p className="text-xl font-semibold text-emerald-700 tabular-nums mt-0.5">{stats.enabled}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[11px] text-slate-500">已绑定组织</p>
          <p className="text-xl font-semibold text-slate-800 tabular-nums mt-0.5">{stats.inUse}</p>
        </div>
      </div>

      {error && !modalOpen && (
        <p className="mx-4 mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-100 bg-white">
              <th className="px-4 py-2.5 text-left font-medium">名称</th>
              <th className="px-3 py-2.5 text-left font-medium w-24">类型</th>
              <th className="px-3 py-2.5 text-left font-medium hidden md:table-cell">URL</th>
              <th className="px-3 py-2.5 text-left font-medium w-24">状态</th>
              <th className="px-3 py-2.5 text-left font-medium w-16">启用</th>
              <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell w-36">最近测试</th>
              <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell w-28">绑定</th>
              <th className="px-4 py-2.5 text-right font-medium w-32">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading && !profiles.length ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">加载中…</td></tr>
            ) : !profiles.length ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">暂无 Webhook，点击右上角添加</td></tr>
            ) : profiles.map((profile) => (
              <tr key={profile.id} className="hover:bg-slate-50/60 transition-colors duration-200">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{profile.name}</p>
                  {profile.remark && <p className="text-xs text-slate-400 mt-0.5">{profile.remark}</p>}
                </td>
                <td className="px-3 py-3"><WebhookTypeBadge type={profile.type} /></td>
                <td className="px-3 py-3 hidden md:table-cell font-mono text-xs text-slate-500 max-w-[220px] truncate" title={profile.url}>
                  {profile.url || '—'}
                </td>
                <td className="px-3 py-3"><StatusBadge profile={profile} /></td>
                <td className="px-3 py-3">
                  <ToggleSwitch
                    enabled={profile.enabled !== false}
                    onChange={() => toggleEnabled(profile)}
                    label={`${profile.name} 启用状态`}
                  />
                </td>
                <td className="px-3 py-3 hidden lg:table-cell text-xs text-slate-500">
                  {profile.lastTestAt
                    ? new Date(profile.lastTestAt).toLocaleString('zh-CN', { hour12: false })
                    : '—'}
                </td>
                <td className="px-3 py-3 hidden sm:table-cell">
                  {(profile.boundRegions?.length || profile.boundDeviceCount) ? (
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      <Link2 size={12} className="text-slate-400 shrink-0" aria-hidden />
                      <span>
                        {profile.boundRegions?.length || 0} 组织
                        {profile.boundDeviceCount > 0 ? ` · ${profile.boundDeviceCount} 设备` : ''}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">未绑定</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => testProfile(profile)}
                      disabled={testingId === profile.id || !profile.url}
                      title="测试"
                      className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors duration-200 disabled:opacity-50"
                    >
                      <Send size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(profile)}
                      title="编辑"
                      className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors duration-200"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeProfile(profile)}
                      title="删除"
                      className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors duration-200"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">{editing ? '编辑 Webhook' : '添加 Webhook'}</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveProfile} className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {error && modalOpen && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
              {!editing && (
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">配置 ID（英文）</span>
                  <input value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                    placeholder="如 wecom-ops" className="ui-input mt-1 w-full" />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-medium text-slate-600">显示名称</span>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required
                  placeholder="运维群-企业微信" className="ui-input mt-1 w-full" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">类型</span>
                <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  className="ui-input mt-1 w-full cursor-pointer">
                  <option value="wecom">企业微信</option>
                  <option value="feishu">飞书</option>
                  <option value="dingtalk">钉钉</option>
                  <option value="custom">自定义</option>
                </select>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <WebhookTypeIcon type={form.type} size={18} />
                  <span>{TYPE_LABELS[form.type] || TYPE_LABELS.custom}</span>
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Webhook URL</span>
                <input value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} required
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." className="ui-input mt-1 w-full font-mono text-sm" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">备注</span>
                <input value={form.remark} onChange={(e) => setForm((p) => ({ ...p, remark: e.target.value }))}
                  className="ui-input mt-1 w-full" />
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                />
                <span className="text-sm text-slate-600">创建后立即启用</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="ui-btn-secondary cursor-pointer">取消</button>
                <button type="submit" disabled={saving} className="ui-btn-primary cursor-pointer disabled:opacity-50">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

export { TYPE_LABELS }
