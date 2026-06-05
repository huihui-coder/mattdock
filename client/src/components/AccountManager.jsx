import { useEffect, useState } from 'react'
import { UserPlus, ShieldCheck, Pencil, Trash2, Eye, EyeOff, X, Save } from 'lucide-react'
import RegionSettings, { flattenRegionOptions } from './RegionSettings'

const PERMISSION_LABELS = {
  monitor: '实时监控',
  'alert-config': '离巢告警配置',
  'flight-records': '飞行记录',
  'device-config': '设备管理',
  'image-studio': 'AI 生图',
  'ai-assistant': '飞行助手',
  'audit-log': '操作日志',
}

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() } })
}

export default function AccountManager() {
  const [users, setUsers] = useState([])
  const [regions, setRegions] = useState([])
  const [regionTree, setRegionTree] = useState([])
  const [permissions, setPermissions] = useState([])
  const [form, setForm] = useState({ username: '', password: '', regionId: '', permissions: ['flight-records'] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ permissions: [], password: '', regionId: '' })
  const [editLoading, setEditLoading] = useState(false)

  const loadUsers = async () => {
    const res = await apiFetch('/api/users')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '获取账号失败')
    setUsers(data.users || [])
    setRegions(data.regions || [])
    setRegionTree(data.tree || data.regions?.map((r) => ({ ...r, children: [] })) || [])
    setPermissions(data.permissions || [])
    setForm((prev) => ({
      ...prev,
      regionId: prev.regionId || data.regions?.[0]?.id || '',
    }))
  }

  useEffect(() => { loadUsers().catch(err => setError(err.message)) }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      loadUsers().catch(() => {})
    }, 15000)
    return () => clearInterval(timer)
  }, [])
  const togglePermission = (list, setList, p) => {
    setList(prev => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter(x => x !== p)
        : [...prev.permissions, p]
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建账号失败')
      setForm({ username: '', password: '', regionId: regions[0]?.id || '', permissions: ['flight-records'] })
      await loadUsers()
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const openEdit = (user) => {
    setEditing(user.username)
    setEditForm({
      permissions: [...(user.permissions || [])],
      password: '',
      regionId: user.regionId || regions[0]?.id || '',
    })
    setError('')
  }

  const saveEdit = async () => {
    if (!editing) return
    setEditLoading(true)
    setError('')
    try {
      const body = { permissions: editForm.permissions, regionId: editForm.regionId }
      if (editForm.password.trim()) body.password = editForm.password.trim()
      const res = await apiFetch(`/api/users/${encodeURIComponent(editing)}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新失败')
      setEditing(null)
      await loadUsers()
    } catch (err) {
      setError(err.message)
    }
    setEditLoading(false)
  }

  const deleteUser = async (username) => {
    if (!window.confirm(`确定删除账号「${username}」？此操作不可恢复。`)) return
    setError('')
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      await loadUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  const regionOptions = flattenRegionOptions(regionTree.length ? regionTree : regions.map((r) => ({ ...r, children: [] })))
  const regionLabel = (id) => regions.find((r) => r.id === id)?.name || id || '—'

  return (
    <div className="space-y-5">
      <RegionSettings />
      <div className="ui-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={18} className="text-dji-black" />
          <h2 className="ui-section-title">创建账号</h2>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="用户名" className="ui-input" required />
          <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="密码" type="password" className="ui-input" required />
          <div>
            <label className="block text-xs text-dji-muted mb-1">所属区域</label>
            <select
              value={form.regionId}
              onChange={(e) => setForm({ ...form, regionId: e.target.value })}
              className="ui-input w-full cursor-pointer"
              required
            >
              {regionOptions.map((r) => (
                <option key={r.id} value={r.id}>{`${'　'.repeat(r.depth)}${r.name}`}</option>
              ))}
            </select>
          </div>
          <button disabled={loading} className="ui-btn-primary disabled:opacity-50">{loading ? '创建中...' : '创建账号'}</button>
          <div className="md:col-span-3 flex flex-wrap gap-2">
            {permissions.map(p => (
              <label key={p} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${form.permissions.includes(p) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-blue-200'}`}>
                <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => togglePermission(form, setForm, p)} className="mr-1.5 sr-only" />
                {PERMISSION_LABELS[p] || p}
              </label>
            ))}
          </div>
        </form>
      </div>

      <div className="ui-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-dji-black" />
            <h2 className="ui-section-title">账号列表</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswords(v => !v)}
            className="ui-btn-secondary"
          >
            {showPasswords ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPasswords ? '隐藏密码' : '显示密码'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dji-border text-dji-muted">
                <th className="text-left py-2 font-medium">用户名</th>
                <th className="text-left py-2 font-medium">在线状态</th>
                <th className="text-left py-2 font-medium">区域</th>
                <th className="text-left py-2 font-medium">角色</th>
                <th className="text-left py-2 font-medium">密码</th>
                <th className="text-left py-2 font-medium">权限</th>
                <th className="text-left py-2 font-medium">创建时间</th>
                <th className="text-right py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.username} className="border-b border-dji-border/50 hover:bg-dji-page transition-colors">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      {u.avatar ? (
                        <img src={u.avatar} alt="" className="w-7 h-7 rounded-full object-cover border border-dji-border" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-dji-page border border-dji-border flex items-center justify-center text-xs text-dji-muted">
                          {u.username.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-dji-black">{u.username}</span>
                    </div>
                  </td>
                  <td className="py-2.5">
                    {u.online ? (
                      <span className="inline-flex items-center gap-1.5 text-dji-ink" title={u.lastActiveAt ? `最近活跃：${new Date(u.lastActiveAt).toLocaleString('zh-CN')}` : '在线'}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        在线{u.sessionCount > 1 ? ` (${u.sessionCount})` : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-dji-subtle">
                        <span className="w-1.5 h-1.5 rounded-full bg-dji-border" />
                        离线
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-dji-muted">{regionLabel(u.regionId)}</td>
                  <td className="py-2.5 text-dji-muted">{u.role === 'admin' ? '管理员' : '普通账号'}</td>
                  <td className="py-2.5 font-mono text-dji-ink">
                    {showPasswords ? (u.plainPassword || '未记录') : '••••••'}
                  </td>
                  <td className="py-2.5 text-dji-muted">
                    {u.role === 'admin' ? '全部权限' : (u.permissions || []).map(p => PERMISSION_LABELS[p] || p).join('、') || '无'}
                  </td>
                  <td className="py-2.5 text-dji-subtle">{u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '--'}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-full text-dji-ink hover:bg-dji-page"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      {u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => deleteUser(u.username)}
                          className="p-1.5 rounded-full text-red-600 hover:bg-red-50"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="ui-card w-full max-w-md p-5 shadow-dji-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="ui-section-title">编辑账号：{editing}</h3>
              <button onClick={() => setEditing(null)} className="p-1 rounded-full hover:bg-dji-page text-dji-subtle">
                <X size={18} />
              </button>
            </div>

            <div className="mb-4">
              <div className="text-sm font-medium text-dji-ink mb-2">所属区域</div>
              <select
                value={editForm.regionId}
                onChange={(e) => setEditForm({ ...editForm, regionId: e.target.value })}
                className="ui-input w-full cursor-pointer"
              >
                {regionOptions.map((r) => (
                  <option key={r.id} value={r.id}>{`${'　'.repeat(r.depth)}${r.name}`}</option>
                ))}
              </select>
            </div>

            {users.find(u => u.username === editing)?.role !== 'admin' && (
              <div className="mb-4">
                <div className="text-sm font-medium text-dji-ink mb-2">权限配置</div>
                <div className="flex flex-wrap gap-2">
                  {permissions.map(p => (
                    <label key={p} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${editForm.permissions.includes(p) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                      <input
                        type="checkbox"
                        checked={editForm.permissions.includes(p)}
                        onChange={() => togglePermission(editForm, setEditForm, p)}
                        className="sr-only"
                      />
                      {PERMISSION_LABELS[p] || p}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="text-sm font-medium text-dji-ink mb-2">重置密码（留空则不修改）</div>
              <input
                type="text"
                value={editForm.password}
                onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="新密码"
                className="ui-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="ui-btn-secondary">取消</button>
              <button
                onClick={saveEdit}
                disabled={editLoading}
                className="ui-btn-primary disabled:opacity-50"
              >
                <Save size={14} />
                {editLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
