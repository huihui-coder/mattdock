import { Wifi, WifiOff, Activity, LogOut, User, Settings } from 'lucide-react'

export default function Header({ mqttConnected, wsConnected, user, onLogout, onOpenProfile }) {
  return (
    <header className="bg-white sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <img src="/logos/platform-logo.png" alt="平台Logo" className="h-7 w-7 object-contain" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800 tracking-tight">机场监测系统</h1>
              <p className="text-xs text-slate-500">基于 MQTT 的实时设备监控</p>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">MQTT</span>
              {mqttConnected ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                  <Wifi size={14} className="text-emerald-600" aria-hidden />
                  已连接
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-red-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden />
                  <WifiOff size={14} aria-hidden />
                  未连接
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">实时</span>
              {wsConnected ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                  <Activity size={14} className="text-emerald-600" aria-hidden />
                  在线
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300" aria-hidden />
                  <Activity size={14} aria-hidden />
                  离线
                </span>
              )}
            </div>

            {user && (
              <div className="flex items-center gap-3 text-sm border-l border-slate-200 pl-5">
                <button
                  onClick={onOpenProfile}
                  className="flex items-center gap-2 text-slate-700 hover:text-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded-lg"
                  title="个人中心"
                >
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover border border-slate-200" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
                      <User size={14} className="text-blue-500" />
                    </span>
                  )}
                  <span className="text-sm font-medium">{user.username}</span>
                  <Settings size={14} className="text-slate-400" />
                </button>
                <button
                  onClick={onLogout}
                  className="flex items-center gap-1 text-slate-500 hover:text-red-600 transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded"
                >
                  <LogOut size={14} />
                  退出
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="h-0.5 bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400" aria-hidden />
    </header>
  )
}
