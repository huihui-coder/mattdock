import { Wifi, WifiOff, Activity, LogOut, User } from 'lucide-react'
import LogoMark from './LogoMark'
import MainNav from './MainNav'

function StatusChip({ label, ok, okText, failText, okIcon: OkIcon, failIcon: FailIcon }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200 ${
        ok
          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80'
          : 'bg-red-50 text-red-700 ring-1 ring-red-200/80'
      }`}
      role="status"
      aria-live="polite"
      aria-label={`${label}：${ok ? okText : failText}`}
    >
      <span
        className={`relative flex h-1.5 w-1.5 shrink-0 ${ok ? 'text-emerald-500' : 'text-red-500'}`}
        aria-hidden
      >
        <span className={`absolute inset-0 rounded-full bg-current ${ok ? 'motion-safe:animate-ping opacity-40' : ''}`} />
        <span className="relative rounded-full bg-current h-full w-full" />
      </span>
      <span className="hidden sm:inline text-slate-500 font-normal">{label}</span>
      {ok ? (
        <OkIcon size={13} className="shrink-0 sm:hidden" aria-hidden />
      ) : (
        <FailIcon size={13} className="shrink-0 sm:hidden" aria-hidden />
      )}
      <span className="whitespace-nowrap">{ok ? okText : failText}</span>
    </div>
  )
}

export default function Header({
  mqttConnected,
  wsConnected,
  user,
  onLogout,
  onOpenProfile,
  tabs,
  activeTab,
  onTabChange,
}) {
  const allOnline = mqttConnected && wsConnected
  const showNav = Array.isArray(tabs) && tabs.length > 0 && onTabChange

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__top">
          <div className="flex items-center gap-2.5 min-w-0">
            <LogoMark variant="app" title="无人机管理平台" />
            <div className="min-w-0 leading-tight">
              <h1 className="text-[15px] sm:text-base font-semibold text-slate-900 tracking-tight truncate">
                无人机管理平台
              </h1>
              <p className="text-[11px] text-slate-400 font-medium tracking-[0.2em] uppercase truncate hidden sm:block">
                安全 · 稳定 · 高效
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div
              className={`hidden md:flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors duration-200 ${
                allOnline
                  ? 'border-emerald-200/70 bg-emerald-50/40'
                  : 'border-slate-200/80 bg-slate-50/60'
              }`}
              aria-label="连接状态"
            >
              <StatusChip
                label="MQTT"
                ok={mqttConnected}
                okText="已连接"
                failText="未连接"
                okIcon={Wifi}
                failIcon={WifiOff}
              />
              <span className="h-3 w-px bg-slate-200/90" aria-hidden />
              <StatusChip
                label="实时"
                ok={wsConnected}
                okText="在线"
                failText="离线"
                okIcon={Activity}
                failIcon={Activity}
              />
            </div>

            <div className="flex md:hidden items-center gap-1.5">
              <StatusChip
                label="MQTT"
                ok={mqttConnected}
                okText="已连接"
                failText="未连接"
                okIcon={Wifi}
                failIcon={WifiOff}
              />
              <StatusChip
                label="实时"
                ok={wsConnected}
                okText="在线"
                failText="离线"
                okIcon={Activity}
                failIcon={Activity}
              />
            </div>

            {user && (
              <div className="flex items-center gap-1 sm:gap-1.5 pl-2 sm:pl-3 border-l border-slate-200/90">
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="group flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 sm:pr-2.5 text-slate-700 hover:bg-slate-100 active:scale-[0.98] transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                  title="打开个人中心"
                  aria-label={`个人中心，当前用户 ${user.username}`}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover ring-2 ring-white shadow-sm"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                      <User size={15} aria-hidden />
                    </span>
                  )}
                  <span className="hidden sm:inline text-sm font-medium text-slate-800 group-hover:text-blue-700 transition-colors max-w-[88px] truncate">
                    {user.username}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 active:scale-[0.98] transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                  aria-label="退出登录"
                >
                  <LogOut size={15} aria-hidden />
                  <span className="hidden sm:inline">退出</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {showNav && (
          <div className="app-header__nav">
            <MainNav
              variant="embedded"
              tabs={tabs}
              activeKey={activeTab}
              onChange={onTabChange}
            />
          </div>
        )}
      </div>
    </header>
  )
}
