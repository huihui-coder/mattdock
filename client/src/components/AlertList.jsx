import { AlertTriangle, XCircle, Info, Bell } from 'lucide-react'

export default function AlertList({ alerts }) {
  const getAlertIcon = (level) => {
    switch (level) {
      case 'critical': return XCircle
      case 'warning': return AlertTriangle
      default: return Info
    }
  }

  const getAlertStyle = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-50 border-red-100 text-red-800'
      case 'warning': return 'bg-amber-50 border-amber-100 text-amber-900'
      default: return 'bg-blue-50 border-blue-100 text-blue-800'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    return new Date(timestamp).toLocaleTimeString('zh-CN')
  }

  return (
    <div className="ui-card overflow-hidden">
      <div className="ui-card-header flex items-center justify-between bg-amber-50/50">
        <div>
          <h2 className="ui-section-title flex items-center gap-2">
            <Bell size={16} className="text-amber-600" />
            告警列表
          </h2>
          <p className="ui-section-desc">最近 {alerts.length} 条</p>
        </div>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            <Bell className="mx-auto mb-3 text-slate-300" size={36} strokeWidth={1.25} />
            <p className="text-sm font-medium text-slate-600">暂无告警</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {alerts.map((alert) => {
              const Icon = getAlertIcon(alert.level)
              return (
                <div key={alert.id} className={`p-3.5 border-b last:border-b-0 ${getAlertStyle(alert.level)}`}>
                  <div className="flex items-start gap-2.5">
                    <Icon size={16} className="mt-0.5 shrink-0 opacity-80" strokeWidth={1.75} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs opacity-75">
                        <span>{alert.deviceName || alert.deviceId}</span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{formatTime(alert.timestamp)}</span>
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
