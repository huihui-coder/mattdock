import { AlertTriangle, XCircle, Info, Bell, ShieldCheck } from 'lucide-react'

export default function AlertList({ alerts, className = '' }) {
  const getAlertIcon = (level) => {
    switch (level) {
      case 'critical': return XCircle
      case 'warning': return AlertTriangle
      default: return Info
    }
  }

  const getAlertStyle = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-50 hover:bg-red-50/90 text-red-900'
      case 'warning': return 'bg-amber-50 hover:bg-amber-50/90 text-amber-950'
      default: return 'bg-blue-50 hover:bg-blue-50/90 text-blue-900'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const warningCount = alerts.filter(a => a.level === 'warning').length
  const criticalCount = alerts.filter(a => a.level === 'critical').length

  return (
    <div className={`ui-card overflow-hidden flex flex-col ${className}`}>
      <div className="ui-card-header flex items-center justify-between bg-amber-50/70 border-amber-100 sticky top-0 z-10">
        <div>
          <h2 className="ui-section-title flex items-center gap-2">
            <Bell size={16} className="text-amber-600" aria-hidden />
            告警列表
          </h2>
          <p className="ui-section-desc tabular-nums">
            最近 {alerts.length} 条
            {criticalCount > 0 && <span className="text-red-600 font-medium ml-1">· {criticalCount} 严重</span>}
            {warningCount > 0 && <span className="text-amber-700 font-medium ml-1">· {warningCount} 警告</span>}
          </p>
        </div>
      </div>

      <div className="ui-panel-scroll">
        {alerts.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center min-h-[240px]">
            <span className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3">
              <ShieldCheck className="text-emerald-500" size={26} strokeWidth={1.5} />
            </span>
            <p className="text-sm font-medium text-slate-700">当前无活跃告警</p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-[220px] leading-relaxed">
              风速超限、离巢等异常事件会在此显示，每 5 秒刷新
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {alerts.map((alert) => {
              const Icon = getAlertIcon(alert.level)
              return (
                <div
                  key={alert.id}
                  className={`p-3.5 transition-colors duration-200 ${getAlertStyle(alert.level)}`}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon size={16} className="mt-0.5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1.5 text-xs opacity-80 tabular-nums">
                        <span className="truncate">{alert.deviceName || alert.deviceId}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0">{formatTime(alert.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
