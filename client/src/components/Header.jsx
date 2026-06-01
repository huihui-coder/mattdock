import { Wifi, WifiOff, Activity, LogOut, User, Settings } from 'lucide-react'

export default function Header({ mqttConnected, wsConnected, user, onLogout, onOpenProfile }) {
  return (
    <header className="bg-dji-surface border-b border-dji-border sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logos/platform-logo.png" alt="平台Logo" className="h-9 w-9 object-contain" />
            <div>
              <h1 className="text-lg font-semibold text-dji-black tracking-tight">机场监测系统</h1>
              <p className="text-xs text-dji-muted">基于 MQTT 的实时设备监控</p>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-dji-subtle">MQTT</span>
              {mqttConnected ? (
                <span className="flex items-center gap-1.5 text-dji-ink font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                  <Wifi size={14} aria-hidden />
                  已连接
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-dji-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden />
                  <WifiOff size={14} aria-hidden />
                  未连接
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-dji-subtle">实时</span>
              {wsConnected ? (
                <span className="flex items-center gap-1.5 text-dji-ink font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
                  <Activity size={14} aria-hidden />
                  在线
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-dji-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-dji-subtle" aria-hidden />
                  <Activity size={14} aria-hidden />
                  离线
                </span>
              )}
            </div>

            {user && (
              <div className="flex items-center gap-3 text-sm border-l border-dji-border pl-5">
                <button
                  onClick={onOpenProfile}
                  className="flex items-center gap-2 text-dji-ink hover:text-dji-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 rounded-full"
                  title="个人中心"
                >
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="w-7 h-7 rounded-full object-cover border border-dji-border" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-dji-page border border-dji-border flex items-center justify-center">
                      <User size={14} className="text-dji-muted" />
                    </span>
                  )}
                  <span className="text-sm font-medium">{user.username}</span>
                  <Settings size={14} className="text-dji-subtle" />
                </button>
                <button
                  onClick={onLogout}
                  className="flex items-center gap-1 text-dji-muted hover:text-dji-black transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 rounded"
                >
                  <LogOut size={14} />
                  退出
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
