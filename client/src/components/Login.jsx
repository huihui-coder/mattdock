import { useState } from 'react'
import { Lock, User, Eye, EyeOff } from 'lucide-react'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '登录失败')
      localStorage.setItem('auth_token', data.token)
      localStorage.setItem('auth_user', JSON.stringify(data.user))
      onLogin(data.token, data.user)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex">
      {/* 左侧品牌区：大疆式深色 hero */}
      <div
        className="hidden lg:flex lg:w-[55%] relative bg-dji-dark text-white flex-col justify-end p-12 xl:p-16"
        style={{ backgroundImage: "url('/images/preview.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />
        <div className="relative z-10 max-w-md">
          <svg className="w-12 h-10 mb-6 text-white" viewBox="0 0 100 60" fill="currentColor" aria-hidden>
            <path d="M10,15 C25,15 40,25 48,42 L50,46 L52,42 C60,25 75,15 90,15 C75,20 63,32 58,45 L50,60 L42,45 C37,32 25,20 10,15 Z" />
          </svg>
          <h1 className="text-3xl font-semibold tracking-tight text-wrap-balance">无人机管理平台</h1>
          <p className="text-sm text-white/60 mt-3 leading-relaxed">
            实时监测机场设备状态，接收离巢告警，查阅飞行记录。
          </p>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-dji-surface">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden mb-8">
            <svg className="w-10 h-8 text-dji-black mb-4" viewBox="0 0 100 60" fill="currentColor" aria-hidden>
              <path d="M10,15 C25,15 40,25 48,42 L50,46 L52,42 C60,25 75,15 90,15 C75,20 63,32 58,45 L50,60 L42,45 C37,32 25,20 10,15 Z" />
            </svg>
            <h1 className="text-2xl font-semibold text-dji-black tracking-tight">无人机管理平台</h1>
          </div>

          <h2 className="text-xl font-semibold text-dji-black mb-1">登录</h2>
          <p className="text-sm text-dji-muted mb-8">输入账号密码进入系统</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dji-subtle" aria-hidden />
              <input
                type="text"
                placeholder="用户名"
                className="ui-input pl-10 py-3"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dji-subtle" aria-hidden />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="密码"
                className="ui-input pl-10 pr-10 py-3"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-dji-subtle hover:text-dji-ink transition-colors"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</p>
            )}

            <button type="submit" disabled={loading} className="ui-btn-primary w-full py-3 mt-2">
              {loading ? '登录中...' : '登录'}
            </button>

            <div className="flex items-center justify-between text-xs text-dji-muted pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none hover:text-dji-ink transition-colors">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="rounded border-dji-border text-dji-black focus:ring-dji-black/20 w-3.5 h-3.5"
                />
                <span>记住我</span>
              </label>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
