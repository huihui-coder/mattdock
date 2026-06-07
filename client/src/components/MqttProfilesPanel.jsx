import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Link2,
  Pencil,
  Plus,
  Radio,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

const EMPTY_FORM = {
  id: '',
  name: '',
  remark: '',
  mqttBroker: '',
  mqttUser: '',
  mqttPass: '',
  mqttClientId: '',
  mqttTopics: 'thing/product/+/osd,thing/product/+/state,thing/product/+/events',
  mqttProtocol: '5',
  streamBase: '',
  streamToken: '',
}

function ConnectionBadge({ connected }) {
  if (connected === true) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5">
        <CheckCircle2 size={12} aria-hidden />
        已连接
      </span>
    )
  }
  if (connected === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5">
        <XCircle size={12} aria-hidden />
        未连接
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-0.5">
      未使用
    </span>
  )
}

export default function MqttProfilesPanel({ onChanged }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [meta, setMeta] = useState({ passwordSet: false, tokenSet: false })

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/mqtt-profiles')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载 MQTT 配置失败')
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
    setMeta({ passwordSet: false, tokenSet: false })
    setModalOpen(true)
  }

  const openEdit = (profile) => {
    setEditing(profile)
    setMeta({
      passwordSet: !!profile.mqtt?.passwordSet,
      tokenSet: !!profile.stream?.tokenSet,
    })
    setForm({
      id: profile.id,
      name: profile.name || '',
      remark: profile.remark || '',
      mqttBroker: profile.mqtt?.brokerUrl || '',
      mqttUser: profile.mqtt?.username || '',
      mqttPass: '',
      mqttClientId: profile.mqtt?.clientId || '',
      mqttTopics: profile.mqtt?.topics || EMPTY_FORM.mqttTopics,
      mqttProtocol: String(profile.mqtt?.protocolVersion || 5),
      streamBase: profile.stream?.baseUrl || '',
      streamToken: '',
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
        mqtt: {
          brokerUrl: form.mqttBroker,
          username: form.mqttUser,
          clientId: form.mqttClientId,
          topics: form.mqttTopics,
          protocolVersion: Number(form.mqttProtocol) || 5,
        },
        stream: { baseUrl: form.streamBase },
      }
      if (form.mqttPass.trim()) body.mqtt.password = form.mqttPass.trim()
      if (form.streamToken.trim()) body.stream.token = form.streamToken.trim()

      const url = editing
        ? `/api/mqtt-profiles/${encodeURIComponent(editing.id)}`
        : '/api/mqtt-profiles'
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

  const removeProfile = async (profile) => {
    if (!window.confirm(`确定删除 MQTT 配置「${profile.name}」？`)) return
    setError('')
    try {
      const res = await apiFetch(`/api/mqtt-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' })
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
    connected: profiles.filter((p) => p.connected).length,
    inUse: profiles.filter((p) => (p.boundRegions?.length || p.usageCount || 0) > 0).length,
  }), [profiles])

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-dji-black" aria-hidden />
            <h2 className="ui-section-title">MQTT 连接池</h2>
          </div>
          <p className="text-sm text-dji-muted mt-1">
            平台级 MQTT 配置统一管理；各组织在「组织与账号」中选择绑定，无需重复填写连接参数。
          </p>
        </div>
        <button type="button" onClick={openCreate} className="ui-btn-primary shrink-0 cursor-pointer">
          <Plus size={14} aria-hidden />
          新建 MQTT 配置
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-dji-border bg-white px-4 py-3 shadow-dji-sm">
          <p className="text-xs text-dji-subtle">配置总数</p>
          <p className="text-2xl font-semibold text-slate-800 tabular-nums mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-dji-border bg-white px-4 py-3 shadow-dji-sm">
          <p className="text-xs text-dji-subtle">已绑定组织</p>
          <p className="text-2xl font-semibold text-slate-800 tabular-nums mt-1">{stats.inUse}</p>
        </div>
        <div className="rounded-xl border border-dji-border bg-white px-4 py-3 shadow-dji-sm">
          <p className="text-xs text-dji-subtle">在线连接</p>
          <p className="text-2xl font-semibold text-emerald-700 tabular-nums mt-1">{stats.connected}</p>
        </div>
      </div>

      {error && !modalOpen && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <section className="rounded-xl border border-dji-border bg-white shadow-dji-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-dji-subtle border-b border-dji-border bg-slate-50/80">
                <th className="px-4 py-3 text-left font-medium">名称</th>
                <th className="px-3 py-3 text-left font-medium hidden md:table-cell">MQTT 地址</th>
                <th className="px-3 py-3 text-left font-medium hidden lg:table-cell">账号</th>
                <th className="px-3 py-3 text-left font-medium hidden xl:table-cell">Client ID</th>
                <th className="px-3 py-3 text-left font-medium w-24">状态</th>
                <th className="px-3 py-3 text-left font-medium hidden sm:table-cell">绑定组织</th>
                <th className="px-4 py-3 text-right font-medium w-28">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !profiles.length ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-dji-subtle">加载中…</td></tr>
              ) : !profiles.length ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-dji-subtle">暂无 MQTT 配置，点击右上角新建</td></tr>
              ) : profiles.map((profile) => (
                <tr key={profile.id} className="hover:bg-slate-50/60 transition-colors duration-200">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{profile.name}</p>
                    {profile.remark && <p className="text-xs text-dji-subtle mt-0.5">{profile.remark}</p>}
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell font-mono text-xs text-slate-600 max-w-[200px] truncate" title={profile.mqtt?.brokerUrl}>
                    {profile.mqtt?.brokerUrl || '—'}
                  </td>
                  <td className="px-3 py-3 hidden lg:table-cell text-slate-600">{profile.mqtt?.username || '—'}</td>
                  <td className="px-3 py-3 hidden xl:table-cell font-mono text-xs text-slate-600">{profile.mqtt?.clientId || '—'}</td>
                  <td className="px-3 py-3"><ConnectionBadge connected={profile.connected} /></td>
                  <td className="px-3 py-3 hidden sm:table-cell">
                    {(profile.boundRegions?.length || profile.usageCount) ? (
                      <div className="flex flex-wrap gap-1">
                        {(profile.boundRegions || []).slice(0, 3).map((r) => (
                          <span key={r.id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                            {r.name || r.id}
                          </span>
                        ))}
                        {(profile.boundRegions?.length || 0) > 3 && (
                          <span className="text-[10px] text-dji-subtle">+{(profile.boundRegions.length - 3)}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-dji-subtle">未绑定</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openEdit(profile)} title="编辑"
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors duration-200">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => removeProfile(profile)} title="删除"
                        className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors duration-200">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-dji-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-dji-border">
              <h3 className="ui-section-title">{editing ? '编辑 MQTT 配置' : '新建 MQTT 配置'}</h3>
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
                  <span className="text-xs font-medium text-dji-muted">配置 ID（英文）</span>
                  <input value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                    placeholder="如 smartcity-prod" className="ui-input mt-1 w-full" />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-medium text-dji-muted">显示名称</span>
                <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required
                  placeholder="生产环境-MQTT" className="ui-input mt-1 w-full" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-dji-muted">备注</span>
                <input value={form.remark} onChange={(e) => setForm((p) => ({ ...p, remark: e.target.value }))}
                  className="ui-input mt-1 w-full" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-dji-muted">MQTT 地址</span>
                  <input value={form.mqttBroker} onChange={(e) => setForm((p) => ({ ...p, mqttBroker: e.target.value }))} required
                    placeholder="tcp://host:1883" className="ui-input mt-1 w-full font-mono text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-dji-muted">账号</span>
                  <input value={form.mqttUser} onChange={(e) => setForm((p) => ({ ...p, mqttUser: e.target.value }))}
                    className="ui-input mt-1 w-full" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-dji-muted">
                    密码{meta.passwordSet && editing ? '（留空不修改）' : ''}
                  </span>
                  <input type="password" value={form.mqttPass} onChange={(e) => setForm((p) => ({ ...p, mqttPass: e.target.value }))}
                    className="ui-input mt-1 w-full" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-dji-muted">Client ID</span>
                  <input value={form.mqttClientId} onChange={(e) => setForm((p) => ({ ...p, mqttClientId: e.target.value }))} required
                    className="ui-input mt-1 w-full font-mono text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-dji-muted">协议版本</span>
                  <select value={form.mqttProtocol} onChange={(e) => setForm((p) => ({ ...p, mqttProtocol: e.target.value }))}
                    className="ui-input mt-1 w-full cursor-pointer">
                    <option value="3">MQTT 3.1</option>
                    <option value="4">MQTT 3.1.1</option>
                    <option value="5">MQTT 5</option>
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-dji-muted">订阅主题</span>
                  <input value={form.mqttTopics} onChange={(e) => setForm((p) => ({ ...p, mqttTopics: e.target.value }))}
                    className="ui-input mt-1 w-full font-mono text-xs" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-dji-muted">推流基址（可选）</span>
                  <input value={form.streamBase} onChange={(e) => setForm((p) => ({ ...p, streamBase: e.target.value }))}
                    placeholder="https://live.example.com/live" className="ui-input mt-1 w-full font-mono text-sm" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-dji-muted">
                    推流 Token{meta.tokenSet && editing ? '（留空不修改）' : ''}
                  </span>
                  <input type="password" value={form.streamToken} onChange={(e) => setForm((p) => ({ ...p, streamToken: e.target.value }))}
                    className="ui-input mt-1 w-full font-mono text-sm" />
                </label>
              </div>
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
    </div>
  )
}
