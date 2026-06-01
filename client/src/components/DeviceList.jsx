import { Cpu, Thermometer, Battery, Wind, CloudRain, MapPin, AlertTriangle, Package, X, Home, MonitorPlay, Radio } from 'lucide-react'

const ACCENT_HEADERS = {
  blue: 'bg-blue-50/90 border-blue-100',
  indigo: 'bg-indigo-50/90 border-indigo-100',
  default: 'bg-slate-50/80 border-slate-100',
}

export default function DeviceList({
  devices,
  healthAlerts,
  onSelect,
  selectedId,
  title = '设备列表',
  accent = 'default',
  filterActive = false,
  onClearFilter,
  onCockpit,
  className = '',
}) {
  const getStatusDot = (status) => {
    switch (status) {
      case 'normal': return 'bg-emerald-500 shadow-sm shadow-emerald-500/40'
      case 'warning': return 'bg-amber-500 shadow-sm shadow-amber-500/40 animate-pulse'
      case 'critical': return 'bg-red-500 shadow-sm shadow-red-500/40 animate-pulse'
      default: return 'bg-slate-400'
    }
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'normal': return 'bg-emerald-100 text-emerald-700 border border-emerald-200'
      case 'warning': return 'bg-amber-100 text-amber-800 border border-amber-200'
      case 'critical': return 'bg-red-100 text-red-700 border border-red-200'
      default: return 'bg-slate-100 text-slate-600 border border-slate-200'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const headerClass = ACCENT_HEADERS[accent] || ACCENT_HEADERS.default

  return (
    <div className={`ui-card overflow-hidden flex flex-col ${className}`}>
      <div className={`ui-card-header flex items-center justify-between sticky top-0 z-10 ${headerClass}`}>
        <div>
          <h2 className="ui-section-title">{title}</h2>
          <p className="ui-section-desc tabular-nums">
            共 {devices.length} 个设备
            {filterActive && <span className="text-blue-600 font-medium ml-1">· 已筛选</span>}
          </p>
        </div>
        {filterActive && onClearFilter && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClearFilter() }}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-white/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            title="清除筛选"
            aria-label="清除筛选"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="ui-panel-scroll divide-y divide-slate-100">
        {devices.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center min-h-[240px]">
            <span className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <Cpu className="text-slate-400" size={28} strokeWidth={1.25} />
            </span>
            <p className="text-sm font-medium text-slate-700">暂无设备数据</p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-[200px] leading-relaxed">
              {filterActive ? '当前筛选条件下没有匹配设备，可清除筛选重试' : '等待 MQTT 推送设备状态'}
            </p>
            {!filterActive && (
              <span className="inline-flex items-center gap-1.5 mt-4 text-xs text-slate-400">
                <Radio size={12} className="animate-pulse" />
                监听中
              </span>
            )}
          </div>
        ) : (
          devices.map((device) => (
            <div
              key={device.deviceId}
              onClick={() => onSelect(device)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect(device) }}
              role="button"
              tabIndex={0}
              className={`p-4 cursor-pointer transition-all duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400/50 ${
                selectedId === device.deviceId ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${getStatusDot(device.status)}`} aria-hidden />
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800 truncate block">{device.deviceName || device.deviceId}</span>
                    {device.deviceName && device.deviceName !== device.deviceId && (
                      <span className="text-xs text-slate-400 truncate block mt-0.5">{device.deviceId}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  {device.metrics.modeCode && (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
                      {device.metrics.modeCode.statusText}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${getStatusBadge(device.status)}`}>
                    {device.statusText}
                  </span>
                  {(device.deviceType === 'airport' || device.deviceType === 'remote') && onCockpit && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCockpit(device) }}
                      className="ui-btn-cockpit"
                      title="打开虚拟座舱"
                    >
                      <MonitorPlay size={11} aria-hidden />
                      座舱
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs text-slate-600">
                {device.metrics.batterySlots && (
                  <div className="flex items-center gap-1 text-violet-600">
                    <Package size={12} aria-hidden />
                    <span className="tabular-nums">{device.metrics.batterySlots.value}</span>
                  </div>
                )}
                {device.metrics.windSpeed && (
                  <div className={`flex items-center gap-1 font-semibold tabular-nums ${
                    (device.metrics.windSpeed.value || 0) >= 8 ? 'text-red-600' : 'text-blue-600'
                  }`}>
                    <Wind size={12} aria-hidden />
                    <span>{device.metrics.windSpeed.value} m/s</span>
                  </div>
                )}
                {device.metrics.environmentTemp && (
                  <div className="flex items-center gap-1 tabular-nums">
                    <Thermometer size={12} aria-hidden />
                    <span>{device.metrics.environmentTemp.value}°C</span>
                  </div>
                )}
                {device.metrics.droneBattery && (
                  <div className="flex items-center gap-1 tabular-nums">
                    <Battery size={12} aria-hidden />
                    <span>{device.metrics.droneBattery.value}%</span>
                  </div>
                )}
                {device.metrics.rainfall && (
                  <div className="flex items-center gap-1 tabular-nums">
                    <CloudRain size={12} aria-hidden />
                    <span>{device.metrics.rainfall.value}mm</span>
                  </div>
                )}
                {device.metrics.droneInDock !== undefined && (
                  <div className={`flex items-center gap-1 font-medium ${device.metrics.droneInDock.value === 1 ? 'text-emerald-600' : 'text-orange-500'}`}>
                    <Home size={12} aria-hidden />
                    <span>{device.metrics.droneInDock.statusText}</span>
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-400 mt-2 flex items-center gap-2 flex-wrap tabular-nums">
                <span>更新 {formatTime(device.lastUpdate)}</span>
                {device.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={10} aria-hidden />
                    {device.location.latitude.toFixed(4)}, {device.location.longitude.toFixed(4)}
                  </span>
                )}
              </div>

              {healthAlerts?.[device.deviceId]?.length > 0 && (
                <div className="mt-2.5 p-2.5 border border-amber-200 rounded-lg bg-amber-50/90 text-xs">
                  <div className="flex items-center gap-1 text-amber-800 font-medium mb-1">
                    <AlertTriangle size={12} className="text-amber-600" aria-hidden />
                    <span>健康告警 ({healthAlerts[device.deviceId].length})</span>
                  </div>
                  {healthAlerts[device.deviceId].slice(0, 2).map((alert, idx) => (
                    <div key={idx} className="text-amber-900/85 truncate flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" aria-hidden />
                      <span>{alert.message}</span>
                    </div>
                  ))}
                  {healthAlerts[device.deviceId].length > 2 && (
                    <div className="text-amber-700 mt-1">+{healthAlerts[device.deviceId].length - 2} 条</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
