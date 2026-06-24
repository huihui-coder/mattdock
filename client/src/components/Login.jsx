import { useEffect, useRef, useState } from 'react'
import { Lock, User, Eye, EyeOff } from 'lucide-react'
import LogoMark from './LogoMark'

/** 生成视频后放到 client/public/videos/ 下，文件名保持一致即可 */
const LOGIN_BG_MP4 = '/videos/login-bg.mp4'
const LOGIN_BG_WEBM = '/videos/login-bg.webm'
const LOGIN_BG_POSTER = '/images/preview.jpg'

function LoginBackground() {
  const videoRef = useRef(null)
  const [videoActive, setVideoActive] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || reduceMotion) return

    const tryPlay = () => {
      video.play()
        .then(() => setVideoActive(true))
        .catch(() => setVideoActive(false))
    }

    if (video.readyState >= 2) tryPlay()
    else video.addEventListener('loadeddata', tryPlay)

    return () => video.removeEventListener('loadeddata', tryPlay)
  }, [reduceMotion])

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0 bg-cover bg-center bg-slate-800"
        style={{ backgroundImage: `url('${LOGIN_BG_POSTER}')` }}
      />
      {!reduceMotion && (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            videoActive ? 'opacity-100' : 'opacity-0'
          }`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={LOGIN_BG_POSTER}
          onError={() => setVideoActive(false)}
        >
          <source src={LOGIN_BG_WEBM} type="video/webm" />
          <source src={LOGIN_BG_MP4} type="video/mp4" />
        </video>
      )}
      <div className="absolute inset-0 bg-slate-900/20" />
    </div>
  )
}

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
      const text = await res.text()
      let data = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        throw new Error(res.ok ? '登录响应异常' : `登录失败 (${res.status})，请确认后端已启动在 3001 端口`)
      }
      if (!res.ok) throw new Error(data.error || `登录失败 (${res.status})`)
      localStorage.setItem('auth_token', data.token)
      localStorage.setItem('auth_user', JSON.stringify(data.user))
      onLogin(data.token, data.user)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center md:justify-start px-6 md:pl-28 lg:pl-40 relative">
      <LoginBackground />

      <div className="bg-white/75 backdrop-blur-xl border border-white/50 shadow-[0_8px_32px_0_rgba(31,38,135,0.08)] rounded-[24px] p-9 w-full max-w-[390px] relative z-10 transition-all duration-300 hover:shadow-[0_8px_40px_0_rgba(31,38,135,0.12)]">
        <div className="flex flex-col items-start mb-8">
          <LogoMark variant="login" className="mb-5" title="无人机管理平台" />
          <h1 className="text-2xl font-semibold text-slate-800 tracking-wide">无人机管理平台</h1>
          <p className="text-[11px] text-slate-400 font-medium tracking-[0.2em] uppercase mt-2">安全 · 稳定 · 高效</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="relative">
            <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="text"
              placeholder="用户名/手机号"
              autoComplete="username"
              className="w-full pl-11 pr-4 py-3 bg-white/60 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400/80 focus:outline-none focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 transition-all duration-200"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="relative">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="密码"
              autoComplete="current-password"
              className="w-full pl-11 pr-11 py-3 bg-white/60 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400/80 focus:outline-none focus:border-blue-500/80 focus:ring-2 focus:ring-blue-500/10 transition-all duration-200"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50/80 backdrop-blur-sm border border-red-200/50 rounded-xl px-3 py-2.5" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium text-sm transition-all duration-200 shadow-[0_4px_12px_rgba(59,130,246,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
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
            <button type="button" className="hover:text-blue-500 transition-colors cursor-pointer">
              忘记密码？
            </button>
          </div>
        </form>
      </div>

      <p className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 text-xs text-white/70 tracking-wide select-none">
        v1.3.1 @2026
      </p>
    </div>
  )
}
