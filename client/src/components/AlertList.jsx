import { AlertTriangle, XCircle, Info, Bell } from 'lucide-react'

export default function AlertList({ alerts }) {
  const getAlertIcon = (level) => {
    switch (level) {
      case 'critical': return XCircle
      case 'warning': return AlertTriangle
      default: return Info
    }
  }

  const getAlertDot = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500'
      case 'warning': return 'bg-amber-500'
      default: return 'bg-dji-subtle'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    return new Date(timestamp).toLocaleTimeString('zh-CN')
  }

  return (
    <div className="ui-card overflow-hidden">
      <div className="ui-card-header flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">告警列表</h2>
          <p className="ui-section-desc">最近 {alerts.length} 条</p>
        </div>
        <Bell className="text-dji-subtle" size={18} strokeWidth={1.5} />
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-10 text-center text-dji-muted">
            <Bell className="mx-auto mb-3 opacity-30" size={36} strokeWidth={1.25} />
            <p className="text-sm font-medium text-dji-ink">暂无告警</p>
          </div>
        ) : (
          <div className="divide-y divide-dji-border">
            {alerts.map((alert) => {
              const Icon = getAlertIcon(alert.level)
              return (
                <div key={alert.id} className="p-3.5 hover:bg-dji-page transition-colors">
                  <div className="flex items-start gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${getAlertDot(alert.level)}`} aria-hidden />
                    <Icon size={15} className="mt-0.5 shrink-0 text-dji-muted" strokeWidth={1.5} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dji-black truncate">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-dji-muted">
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
