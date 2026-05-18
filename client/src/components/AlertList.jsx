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
      case 'critical': return 'bg-red-50 border-red-200 text-red-800'
      case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-800'
      default: return 'bg-blue-50 border-blue-200 text-blue-800'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN')
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">告警列表</h2>
          <p className="text-sm text-gray-500">最近 {alerts.length} 条告警</p>
        </div>
        <Bell className="text-gray-400" size={20} />
      </div>
      
      <div className="max-h-[400px] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Bell className="mx-auto mb-2 opacity-50" size={40} />
            <p>暂无告警</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {alerts.map((alert) => {
              const Icon = getAlertIcon(alert.level)
              return (
                <div
                  key={alert.id}
                  className={`p-3 ${getAlertStyle(alert.level)}`}
                >
                  <div className="flex items-start gap-2">
                    <Icon size={16} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs opacity-75">
                        <span>{alert.deviceName || alert.deviceId}</span>
                        <span>•</span>
                        <span>{formatTime(alert.timestamp)}</span>
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
