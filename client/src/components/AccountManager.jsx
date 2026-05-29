import { useEffect, useState } from 'react'
import { UserPlus, ShieldCheck, Pencil, Trash2, Eye, EyeOff, X, Save } from 'lucide-react'

const PERMISSION_LABELS = {
  monitor: '实时监控',
  'alert-config': '离巢告警配置',
  'flight-records': '飞行记录'
}

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() } })
}

export default function AccountManager() {
  const [users, setUsers] = useState([])
  const [permissions, setPermissions] = useState([])
  const [form, setForm] = useState({ username: '', password: '', permissions: ['flight-records'] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ permissions: [], password: '' })
  const [editLoading, setEditLoading] = useState(false)

  const loadUsers = async () => {
    const res = await apiFetch('/api/users')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '获取账号失败')
    setUsers(data.users || [])
    setPermissions(data.permissions || [])
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
      setForm({ username: '', password: '', permissions: ['flight-records'] })
      await loadUsers()
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const openEdit = (user) => {
    setEditing(user.username)
    setEditForm({ permissions: [...(user.permissions || [])], password: '' })
    setError('')
  }

  const saveEdit = async () => {
    if (!editing) return
    setEditLoading(true)
    setError('')
    try {
      const body = { permissions: editForm.permissions }
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

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={18} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-800">创建账号</h2>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="用户名" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" required />
          <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="密码" type="password" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" required />
          <button disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">{loading ? '创建中...' : '创建账号'}</button>
          <div className="md:col-span-3 flex flex-wrap gap-2">
            {permissions.map(p => (
              <label key={p} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${form.permissions.includes(p) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
                <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => togglePermission(form, setForm, p)} className="mr-1.5" />
                {PERMISSION_LABELS[p] || p}
              </label>
            ))}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-green-600" />
            <h2 className="text-lg font-semibold text-gray-800">账号列表</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswords(v => !v)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            {showPasswords ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPasswords ? '隐藏密码' : '显示密码'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-gray-400">用户名</th>
                <th className="text-left py-2 text-gray-400">在线状态</th>
                <th className="text-left py-2 text-gray-400">角色</th>
                <th className="text-left py-2 text-gray-400">密码</th>
                <th className="text-left py-2 text-gray-400">权限</th>
                <th className="text-left py-2 text-gray-400">创建时间</th>
                <th className="text-right py-2 text-gray-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.username} className="border-b border-gray-50">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      {u.avatar ? (
                        <img src={u.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                          {u.username.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-gray-700">{u.username}</span>
                    </div>
                  </td>
                  <td className="py-2.5">
                    {u.online ? (
                      <span className="inline-flex items-center gap-1.5 text-green-600" title={u.lastActiveAt ? `最近活跃：${new Date(u.lastActiveAt).toLocaleString('zh-CN')}` : '在线'}>
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        在线{u.sessionCount > 1 ? ` (${u.sessionCount})` : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-gray-300" />
                        离线
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-gray-500">{u.role === 'admin' ? '管理员' : '普通账号'}</td>
                  <td className="py-2.5 font-mono text-gray-600">
                    {showPasswords ? (u.plainPassword || '未记录') : '••••••'}
                  </td>
                  <td className="py-2.5 text-gray-500">
                    {u.role === 'admin' ? '全部权限' : (u.permissions || []).map(p => PERMISSION_LABELS[p] || p).join('、') || '无'}
                  </td>
                  <td className="py-2.5 text-gray-400">{u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '--'}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      {u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => deleteUser(u.username)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
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

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">编辑账号：{editing}</h3>
              <button onClick={() => setEditing(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X size={18} />
              </button>
            </div>

            {users.find(u => u.username === editing)?.role !== 'admin' && (
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-2">权限配置</div>
                <div className="flex flex-wrap gap-2">
                  {permissions.map(p => (
                    <label key={p} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${editForm.permissions.includes(p) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
                      <input
                        type="checkbox"
                        checked={editForm.permissions.includes(p)}
                        onChange={() => togglePermission(editForm, setEditForm, p)}
                        className="mr-1.5"
                      />
                      {PERMISSION_LABELS[p] || p}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 mb-2">重置密码（留空则不修改）</div>
              <input
                type="text"
                value={editForm.password}
                onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="新密码"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50">取消</button>
              <button
                onClick={saveEdit}
                disabled={editLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
