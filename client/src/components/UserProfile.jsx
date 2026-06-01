import { useState, useRef } from 'react'
import { X, User, Camera, Lock, Loader2 } from 'lucide-react'

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(opts.headers || {}),
      'x-auth-token': getToken()
    }
  })
}

export default function UserProfile({ user, onClose, onUserUpdate }) {
  const fileRef = useRef(null)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pwdForm, setPwdForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' })

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('图片不能超过 2MB')
      return
    }

    setAvatarLoading(true)
    setError('')
    setSuccess('')
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await apiFetch('/api/me/avatar', {
        method: 'POST',
        body: JSON.stringify({ avatar: dataUrl })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '上传头像失败')
      onUserUpdate?.(data.user)
      setSuccess('头像已更新')
    } catch (err) {
      setError(err.message)
    } finally {
      setAvatarLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setPwdLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await apiFetch('/api/me/password', {
        method: 'PUT',
        body: JSON.stringify({
          oldPassword: pwdForm.oldPassword,
          newPassword: pwdForm.newPassword
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '修改密码失败')
      setPwdForm({ oldPassword: '', newPassword: '', confirmPassword: '' })
      setSuccess('密码修改成功')
      onUserUpdate?.(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setPwdLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="ui-card w-full max-w-md overflow-hidden shadow-dji-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-dji-border">
          <h2 className="ui-section-title">个人中心</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-dji-page text-dji-subtle">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-dji-border" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-dji-page border-2 border-dji-border flex items-center justify-center">
                  <User size={32} className="text-dji-subtle" />
                </div>
              )}
              <button
                type="button"
                disabled={avatarLoading}
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-50"
              >
                {avatarLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <div className="text-center">
              <div className="font-medium text-dji-black">{user?.username}</div>
              <div className="text-sm text-dji-muted">{user?.role === 'admin' ? '管理员' : '普通账号'}</div>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-dji-ink">
              <Lock size={15} className="text-dji-subtle" />
              修改密码
            </div>
            <input
              type="password"
              value={pwdForm.oldPassword}
              onChange={e => setPwdForm({ ...pwdForm, oldPassword: e.target.value })}
              placeholder="原密码"
              className="ui-input"
              required
            />
            <input
              type="password"
              value={pwdForm.newPassword}
              onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              placeholder="新密码（至少4位）"
              className="ui-input"
              required
              minLength={4}
            />
            <input
              type="password"
              value={pwdForm.confirmPassword}
              onChange={e => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
              placeholder="确认新密码"
              className="ui-input"
              required
              minLength={4}
            />
            <button
              type="submit"
              disabled={pwdLoading}
              className="ui-btn-primary w-full disabled:opacity-50"
            >
              {pwdLoading ? '保存中...' : '保存新密码'}
            </button>
          </form>

          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {success && <div className="text-sm text-dji-ink bg-dji-page border border-dji-border rounded-lg px-3 py-2">{success}</div>}
        </div>
      </div>
    </div>
  )
}
