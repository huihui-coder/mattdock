import { useEffect, useState } from 'react'
import { UserPlus, ShieldCheck } from 'lucide-react'

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

  const loadUsers = async () => {
    const res = await apiFetch('/api/users')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '获取账号失败')
    setUsers(data.users || [])
    setPermissions(data.permissions || [])
  }

  useEffect(() => { loadUsers().catch(err => setError(err.message)) }, [])

  const togglePermission = (p) => {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(p) ? prev.permissions.filter(x => x !== p) : [...prev.permissions, p]
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
                <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => togglePermission(p)} className="mr-1.5" />
                {PERMISSION_LABELS[p] || p}
              </label>
            ))}
          </div>
          {error && <div className="md:col-span-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={18} className="text-green-600" />
          <h2 className="text-lg font-semibold text-gray-800">账号列表</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100"><th className="text-left py-2 text-gray-400">用户名</th><th className="text-left py-2 text-gray-400">角色</th><th className="text-left py-2 text-gray-400">权限</th><th className="text-left py-2 text-gray-400">创建时间</th></tr></thead>
            <tbody>{users.map(u => <tr key={u.username} className="border-b border-gray-50"><td className="py-2 font-medium text-gray-700">{u.username}</td><td className="py-2 text-gray-500">{u.role === 'admin' ? '管理员' : '普通账号'}</td><td className="py-2 text-gray-500">{(u.permissions || []).map(p => PERMISSION_LABELS[p] || p).join('、')}</td><td className="py-2 text-gray-400">{u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '--'}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
