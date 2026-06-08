import { useState, useRef } from 'react'
import { X, User, Camera, Lock, Loader2, Bot, Check } from 'lucide-react'
import {
  ASSISTANT_SKINS,
  loadAssistantSkin,
  saveAssistantSkin,
} from '../lib/assistant-skin'
import CodeNoNoSprite from './CodeNoNoSprite'

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
  const [assistantSkin, setAssistantSkin] = useState(() => loadAssistantSkin())

  const handleSkinSelect = (skinId) => {
    if (skinId === assistantSkin) return
    const next = saveAssistantSkin(skinId)
    setAssistantSkin(next)
    setError('')
    setSuccess(`已切换为「${ASSISTANT_SKINS[next]?.name || next}」`)
  }

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
        className="ui-card w-full max-w-lg overflow-hidden shadow-dji-sm"
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

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-dji-ink">
              <Bot size={15} className="text-dji-subtle" />
              AI 助手形象
            </div>
            <p className="text-xs text-dji-muted leading-relaxed">
              切换后悬浮按钮与对话中的助手外观会立即更新，偏好保存在本机浏览器。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.values(ASSISTANT_SKINS).map((skin) => {
                const active = assistantSkin === skin.id
                return (
                  <button
                    key={skin.id}
                    type="button"
                    onClick={() => handleSkinSelect(skin.id)}
                    className={`profile-assistant-skin cursor-pointer text-left transition-colors duration-200 ${
                      active ? 'profile-assistant-skin--active' : ''
                    }`}
                    aria-pressed={active}
                  >
                    <div className="profile-assistant-skin__preview">
                      {skin.id === 'codenono' ? (
                        <CodeNoNoSprite state="idle" className="is-profile" alt="" animate={false} />
                      ) : (
                        <img src={skin.preview} alt="" className="profile-assistant-skin__img" draggable={false} />
                      )}
                    </div>
                    <div className="profile-assistant-skin__body">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-dji-black text-sm">{skin.name}</span>
                        {active && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 font-medium">
                            <Check size={12} aria-hidden />
                            使用中
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-dji-muted mt-1 leading-snug">{skin.description}</p>
                      {skin.sourceUrl && (
                        <a
                          href={skin.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-[11px] text-blue-600 hover:underline mt-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          开源项目
                        </a>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

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
