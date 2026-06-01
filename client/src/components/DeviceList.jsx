import { Cpu, Thermometer, Droplets, Battery, Wind, CloudRain, MapPin, AlertTriangle, Package, X, Home, MonitorPlay, Activity } from 'lucide-react'

export default function DeviceList({ devices, healthAlerts, onSelect, selectedId, title = "设备列表", filterActive = false, onClearFilter, onCockpit }) {
  const getStatusDot = (status) => {
    switch (status) {
      case 'normal': return 'bg-emerald-500'
      case 'warning': return 'bg-amber-500'
      case 'critical': return 'bg-red-500'
      default: return 'bg-dji-subtle'
    }
  }

  const getStatusLabel = (status) => {
    switch (status) {
      case 'normal': return 'text-dji-ink'
      case 'warning': return 'text-amber-700'
      case 'critical': return 'text-red-700'
      default: return 'text-dji-muted'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleTimeString('zh-CN')
  }

  return (
    <div className="ui-card overflow-hidden">
      <div className="ui-card-header flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">{title}</h2>
          <p className="ui-section-desc">
            共 {devices.length} 个设备
            {filterActive && <span className="text-dji-black font-medium ml-1">· 已筛选</span>}
          </p>
        </div>
        {filterActive && onClearFilter && (
          <button
            onClick={(e) => { e.stopPropagation(); onClearFilter() }}
            className="text-dji-subtle hover:text-dji-black p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20"
            title="清除筛选"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="divide-y divide-dji-border max-h-[500px] overflow-y-auto">
        {devices.length === 0 ? (
          <div className="p-10 text-center text-dji-muted">
            <Cpu className="mx-auto mb-3 opacity-30" size={36} strokeWidth={1.25} />
            <p className="text-sm font-medium text-dji-ink">暂无设备数据</p>
            <p className="text-xs mt-1">等待 MQTT 消息</p>
          </div>
        ) : (
          devices.map((device) => (
            <div
              key={device.deviceId}
              onClick={() => onSelect(device)}
              className={`p-4 cursor-pointer transition-colors hover:bg-dji-page ${
                selectedId === device.deviceId ? 'bg-dji-page ring-1 ring-inset ring-dji-black/10' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${getStatusDot(device.status)}`} />
                  <span className="font-medium text-dji-black truncate">{device.deviceName || device.deviceId}</span>
                  {device.deviceName && device.deviceName !== device.deviceId && (
                    <span className="text-xs text-dji-subtle truncate hidden sm:inline">({device.deviceId})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {device.metrics.modeCode && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-dji-border text-dji-muted font-medium">
                      {device.metrics.modeCode.statusText}
                    </span>
                  )}
                  <span className={`text-xs font-medium ${getStatusLabel(device.status)}`}>
                    {device.statusText}
                  </span>
                  {(device.deviceType === 'airport' || device.deviceType === 'remote') && onCockpit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCockpit(device) }}
                      className="ui-btn-primary !px-2.5 !py-1 !text-[11px] !rounded-full"
                      title="虚拟座舱"
                    >
                      <MonitorPlay size={11} />
                      座舱
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-xs text-dji-muted">
                {device.metrics.batterySlots && (
                  <div className="flex items-center gap-1">
                    <Package size={12} className="text-dji-subtle" />
                    <span>{device.metrics.batterySlots.value}</span>
                  </div>
                )}
                {device.metrics.windSpeed && (
                  <div className="flex items-center gap-1 font-medium text-dji-ink">
                    <Wind size={12} />
                    <span>{device.metrics.windSpeed.value} m/s</span>
                  </div>
                )}
                {device.metrics.environmentTemp && (
                  <div className="flex items-center gap-1">
                    <Thermometer size={12} />
                    <span>{device.metrics.environmentTemp.value}°C</span>
                  </div>
                )}
                {device.metrics.droneBattery && (
                  <div className="flex items-center gap-1">
                    <Battery size={12} />
                    <span>{device.metrics.droneBattery.value}%</span>
                  </div>
                )}
                {device.metrics.rainfall && (
                  <div className="flex items-center gap-1">
                    <CloudRain size={12} />
                    <span>{device.metrics.rainfall.value}mm</span>
                  </div>
                )}
                {device.metrics.droneInDock !== undefined && (
                  <div className="flex items-center gap-1 font-medium text-dji-ink">
                    <Home size={12} />
                    <span>{device.metrics.droneInDock.statusText}</span>
                  </div>
                )}
                {device.metrics.modeCode && (
                  <div className="flex items-center gap-1 col-span-2">
                    <Activity size={12} />
                    <span>{device.metrics.modeCode.statusText}</span>
                  </div>
                )}
              </div>

              <div className="text-xs text-dji-subtle mt-2 flex items-center gap-2 flex-wrap">
                <span>更新 {formatTime(device.lastUpdate)}</span>
                {device.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={10} />
                    {device.location.latitude.toFixed(4)}, {device.location.longitude.toFixed(4)}
                  </span>
                )}
              </div>

              {healthAlerts?.[device.deviceId]?.length > 0 && (
                <div className="mt-2.5 p-2.5 border border-dji-border rounded-lg bg-dji-page text-xs">
                  <div className="flex items-center gap-1 text-dji-ink font-medium mb-1">
                    <AlertTriangle size={12} className="text-amber-600" />
                    <span>健康告警 ({healthAlerts[device.deviceId].length})</span>
                  </div>
                  {healthAlerts[device.deviceId].slice(0, 2).map((alert, idx) => (
                    <div key={idx} className="text-dji-muted truncate flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                      <span>{alert.message}</span>
                    </div>
                  ))}
                  {healthAlerts[device.deviceId].length > 2 && (
                    <div className="text-dji-subtle mt-1">+{healthAlerts[device.deviceId].length - 2} 条</div>
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
