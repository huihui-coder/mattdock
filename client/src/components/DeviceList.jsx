import { Cpu, Thermometer, Droplets, Battery, Signal, Wind, CloudRain, MapPin, MoreHorizontal, AlertTriangle, Package, X, Home, MonitorPlay } from 'lucide-react'

export default function DeviceList({ devices, healthAlerts, onSelect, selectedId, title = "设备列表", filterActive = false, onClearFilter, onCockpit }) {
  const getStatusClass = (status) => {
    switch (status) {
      case 'normal': return 'bg-green-100 border-green-300'
      case 'warning': return 'bg-yellow-100 border-yellow-300'
      case 'critical': return 'bg-red-100 border-red-300'
      default: return 'bg-gray-100 border-gray-300'
    }
  }

  const getStatusDot = (status) => {
    switch (status) {
      case 'normal': return 'bg-green-500'
      case 'warning': return 'bg-yellow-500'
      case 'critical': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '-'
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN')
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">
            共 {devices.length} 个设备
            {filterActive && <span className="text-blue-600 ml-1">(已筛选)</span>}
          </p>
        </div>
        {filterActive && onClearFilter && (
          <button 
            onClick={(e) => { e.stopPropagation(); onClearFilter(); }}
            className="text-gray-400 hover:text-gray-600 p-1"
            title="清除筛选"
          >
            <X size={16} />
          </button>
        )}
      </div>
      
      <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
        {devices.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Cpu className="mx-auto mb-2 opacity-50" size={40} />
            <p>暂无设备数据</p>
            <p className="text-sm mt-1">等待MQTT消息...</p>
          </div>
        ) : (
          devices.map((device) => (
            <div
              key={device.deviceId}
              onClick={() => onSelect(device)}
              className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                selectedId === device.deviceId ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${getStatusDot(device.status)}`} />
                  <span className="font-medium text-gray-900">{device.deviceName || device.deviceId}</span>
                  {device.deviceName && device.deviceName !== device.deviceId && (
                    <span className="text-xs text-gray-400">({device.deviceId})</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${getStatusClass(device.status)}`}>
                    {device.statusText}
                  </span>
                  {(device.deviceType === 'airport' || device.deviceType === 'remote') && onCockpit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCockpit(device) }}
                      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                      title="虚拟座舱"
                    >
                      <MonitorPlay size={12} />
                      <span>虚拟座舱</span>
                    </button>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-2 text-xs">
                {/* 电池槽状态 */}
                {device.metrics.batterySlots && (
                  <div className="flex items-center gap-1 text-purple-600 font-medium">
                    <Package size={12} />
                    <span>{device.metrics.batterySlots.value}</span>
                  </div>
                )}
                {/* 风速 - 重点显示 */}
                {device.metrics.windSpeed && (
                  <div className="flex items-center gap-1 text-blue-600 font-medium">
                    <Wind size={12} />
                    <span>{device.metrics.windSpeed.value} m/s</span>
                  </div>
                )}
                {device.metrics.environmentTemp && (
                  <div className="flex items-center gap-1 text-gray-600">
                    <Thermometer size={12} />
                    <span>{device.metrics.environmentTemp.value}°C</span>
                  </div>
                )}
                {device.metrics.droneBattery && (
                  <div className="flex items-center gap-1 text-gray-600">
                    <Battery size={12} />
                    <span>{device.metrics.droneBattery.value}%</span>
                  </div>
                )}
                {device.metrics.rainfall && (
                  <div className="flex items-center gap-1 text-gray-600">
                    <CloudRain size={12} />
                    <span>{device.metrics.rainfall.value}mm</span>
                  </div>
                )}
                {device.metrics.droneInDock !== undefined && (
                  <div className={`flex items-center gap-1 font-medium ${device.metrics.droneInDock.value === 1 ? 'text-green-600' : 'text-orange-500'}`}>
                    <Home size={12} />
                    <span>{device.metrics.droneInDock.statusText}</span>
                  </div>
                )}
              </div>
              
              <div className="text-xs text-gray-400 mt-2 flex items-center gap-2">
                <span>更新: {formatTime(device.lastUpdate)}</span>
                {device.location && (
                  <span className="flex items-center gap-1">
                    <MapPin size={10} />
                    {device.location.latitude.toFixed(4)}, {device.location.longitude.toFixed(4)}
                  </span>
                )}
              </div>
              
              {/* 健康告警显示 */}
              {healthAlerts && healthAlerts[device.deviceId] && healthAlerts[device.deviceId].length > 0 && (
                <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                  <div className="flex items-center gap-1 text-orange-600 font-medium mb-1">
                    <AlertTriangle size={12} />
                    <span>健康告警 ({healthAlerts[device.deviceId].length})</span>
                  </div>
                  {healthAlerts[device.deviceId].slice(0, 2).map((alert, idx) => (
                    <div key={idx} className="text-orange-700 truncate flex items-center gap-1">
                      <span className={`px-1 rounded text-xs ${
                        alert.level === 'warning' ? 'bg-red-100 text-red-700' :
                        alert.level === 'notice' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {alert.levelText || alert.level}
                      </span>
                      <span>{alert.message}</span>
                    </div>
                  ))}
                  {healthAlerts[device.deviceId].length > 2 && (
                    <div className="text-orange-500 mt-1">
                      +{healthAlerts[device.deviceId].length - 2} 更多...
                    </div>
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
