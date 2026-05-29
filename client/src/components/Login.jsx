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
    <div className="min-h-screen bg-cover bg-center flex items-center justify-center md:justify-start px-6 md:pl-28 lg:pl-40 relative" style={{ backgroundImage: "url('/images/preview.jpg')" }}>
      {/* 极淡遮罩层，保持背景图清爽透亮 */}
      <div className="absolute inset-0 bg-slate-900/10" />
      
      {/* 磨砂玻璃效果登录框 */}
      <div className="bg-white/75 backdrop-blur-xl border border-white/50 shadow-[0_8px_32px_0_rgba(31,38,135,0.08)] rounded-[24px] p-9 w-full max-w-[390px] relative z-10 transition-all duration-300 hover:shadow-[0_8px_40px_0_rgba(31,38,135,0.12)]">
        <div className="flex flex-col items-start mb-8">
          {/* 科技感翅膀/双翼极简Logo */}
          <div className="text-[#1c2d5a] mb-5">
            <svg className="w-11 h-9" viewBox="0 0 100 60" fill="currentColor">
              <path d="M10,15 C25,15 40,25 48,42 L50,46 L52,42 C60,25 75,15 90,15 C75,20 63,32 58,45 L50,60 L42,45 C37,32 25,20 10,15 Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-wide">无人机管理平台</h1>
          <p className="text-[11px] text-slate-400 font-medium tracking-[0.2em] uppercase mt-2">安全 · 稳定 · 高效</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="relative">
            <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="用户名/手机号"
              className="w-full pl-11 pr-4 py-3 bg-white/60 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400/80 focus:outline-none focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 transition-all"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="密码"
              className="w-full pl-11 pr-11 py-3 bg-white/60 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400/80 focus:outline-none focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 transition-all"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50/80 backdrop-blur-sm border border-red-200/50 rounded-xl px-3 py-2.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium text-sm transition-all shadow-[0_4px_12px_rgba(59,130,246,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="flex items-center justify-between text-xs text-slate-400 mt-2 px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none hover:text-slate-500 transition-colors">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/20 w-3.5 h-3.5"
              />
              <span>记住我</span>
            </label>
            <button type="button" className="hover:text-blue-500 transition-colors">
              忘记密码？
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
