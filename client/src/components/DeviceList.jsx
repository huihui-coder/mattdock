import { useMemo, useState } from 'react'
import { Cpu, Thermometer, Battery, Wind, CloudRain, MapPin, AlertTriangle, Package, X, Home, MonitorPlay, Radio, Unplug } from 'lucide-react'
import RegionLabel from './RegionLabel'
import { deviceScopeKey } from '../lib/scope-query'

/** 机场设备列：机巢 / 单兵遥控器 */
const FACILITY_ICON = {
  airport: { src: '/images/无人机库,机巢.svg', label: '机场机巢' },
  remote: { src: '/images/无人机遥控器.svg', label: '单兵遥控器' },
}

/** 无人机列：单兵机 / 机场绑定机 */
const DRONE_ICON = {
  single: { src: '/images/单兵无人机.svg', label: '单兵无人机' },
  drone: { src: '/images/机场无人机.svg', label: '机场无人机' },
  virtual: { src: '/images/机场无人机.svg', label: '机场无人机' },
}

function DeviceListIcon({ src, label, status, getStatusDot }) {
  return (
    <div className="relative shrink-0" title={label}>
      <div className="w-9 h-9 rounded-lg bg-white border border-slate-200/90 shadow-sm flex items-center justify-center p-1.5 transition-colors duration-200">
        <img src={src} alt="" className="w-full h-full object-contain text-slate-700" aria-hidden />
      </div>
      <span
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${getStatusDot(status)}`}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </div>
  )
}

function DeviceFacilityIcon({ deviceType, status, getStatusDot }) {
  const meta = deviceType === 'remote' ? FACILITY_ICON.remote : FACILITY_ICON.airport
  return <DeviceListIcon src={meta.src} label={meta.label} status={status} getStatusDot={getStatusDot} />
}

function DeviceDroneIcon({ deviceType, status, getStatusDot }) {
  const meta = DRONE_ICON[deviceType] || DRONE_ICON.drone
  return <DeviceListIcon src={meta.src} label={meta.label} status={status} getStatusDot={getStatusDot} />
}

const FACILITY_TABS = [
  { id: 'all', label: '全部' },
  { id: 'airport', label: '机场', icon: FACILITY_ICON.airport },
  { id: 'remote', label: '遥控器', icon: FACILITY_ICON.remote },
]

const DRONE_TABS = [
  { id: 'all', label: '全部' },
  { id: 'single', label: '单兵', icon: DRONE_ICON.single },
  { id: 'drone', label: '机场机', icon: DRONE_ICON.drone },
]

function DeviceListTabBar({ tabs, counts, activeId, onChange, ariaLabel, activeClassName = 'ui-tab-active' }) {
  return (
    <div className="ui-nav-bar-full" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const count = counts[tab.id]
        const active = activeId === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`ui-tab flex-1 justify-center cursor-pointer ${active ? activeClassName : 'ui-tab-inactive'}`}
          >
            {tab.icon && (
              <img
                src={tab.icon.src}
                alt=""
                className={`w-4 h-4 object-contain shrink-0 ${active ? 'brightness-0 invert' : 'opacity-70'}`}
                aria-hidden
              />
            )}
            <span>{tab.label}</span>
            <span className={`text-xs tabular-nums ${active ? 'text-white/85' : 'text-slate-400'}`}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const ACCENT_HEADERS = {
  blue: 'bg-blue-50/90 border-blue-100',
  indigo: 'bg-indigo-50/90 border-indigo-100',
  default: 'bg-slate-50/80 border-slate-100',
}

/** 是否已在设备注册表映射（有友好名称或绑定关系） */
function isMappedDevice(device) {
  if (device.metrics?.boundDrone?.sn || device.metrics?.boundDrone?.name) return true
  const name = device.deviceName || ''
  return name.length > 0 && name !== device.deviceId
}

function sortMappedFirst(devices) {
  return [...devices].sort((a, b) => {
    const mappedDiff = Number(isMappedDevice(b)) - Number(isMappedDevice(a))
    if (mappedDiff !== 0) return mappedDiff
    const na = a.deviceName || a.deviceId || ''
    const nb = b.deviceName || b.deviceId || ''
    return na.localeCompare(nb, 'zh-CN')
  })
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
  showFacilityIcons = false,
  showDroneIcons = false,
  showMqttSource = false,
}) {
  const [facilityTab, setFacilityTab] = useState('all')
  const [droneTab, setDroneTab] = useState('all')

  const facilityCounts = useMemo(() => ({
    all: devices.length,
    airport: devices.filter((d) => d.deviceType === 'airport').length,
    remote: devices.filter((d) => d.deviceType === 'remote').length,
  }), [devices])

  const droneCounts = useMemo(() => ({
    all: devices.length,
    single: devices.filter((d) => d.deviceType === 'single').length,
    drone: devices.filter((d) => d.deviceType === 'drone' || d.deviceType === 'virtual').length,
  }), [devices])

  const tabFilterActive =
    (showFacilityIcons && facilityTab !== 'all') || (showDroneIcons && droneTab !== 'all')

  const visibleDevices = useMemo(() => {
    let rows = devices
    if (showFacilityIcons && facilityTab !== 'all') {
      rows = devices.filter((d) => d.deviceType === facilityTab)
    } else if (showDroneIcons && droneTab !== 'all') {
      if (droneTab === 'single') rows = devices.filter((d) => d.deviceType === 'single')
      else rows = devices.filter((d) => d.deviceType === 'drone' || d.deviceType === 'virtual')
    }
    return sortMappedFirst(rows)
  }, [devices, facilityTab, showFacilityIcons, droneTab, showDroneIcons])

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
            共 {visibleDevices.length} 个设备
            {tabFilterActive && (
              <span className="text-slate-500 ml-1">/ {devices.length} 总计</span>
            )}
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

      {showFacilityIcons && (
        <div className={`px-4 pb-3 border-b border-slate-100/80 ${headerClass}`}>
          <DeviceListTabBar
            tabs={FACILITY_TABS}
            counts={facilityCounts}
            activeId={facilityTab}
            onChange={setFacilityTab}
            ariaLabel="机场设备分类"
          />
        </div>
      )}

      {showDroneIcons && (
        <div className={`px-4 pb-3 border-b border-slate-100/80 ${headerClass}`}>
          <DeviceListTabBar
            tabs={DRONE_TABS}
            counts={droneCounts}
            activeId={droneTab}
            onChange={setDroneTab}
            ariaLabel="无人机分类"
            activeClassName="ui-tab-active !bg-indigo-600 !shadow-indigo-600/25"
          />
        </div>
      )}

      <div className="ui-panel-scroll divide-y divide-slate-100">
        {visibleDevices.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center min-h-[240px]">
            <span className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3 p-2.5">
              {showFacilityIcons ? (
                <img
                  src={(facilityTab === 'remote' ? FACILITY_ICON.remote : FACILITY_ICON.airport).src}
                  alt=""
                  className="w-full h-full object-contain opacity-50"
                  aria-hidden
                />
              ) : showDroneIcons ? (
                <img
                  src={(droneTab === 'drone' ? DRONE_ICON.drone : DRONE_ICON.single).src}
                  alt=""
                  className="w-full h-full object-contain opacity-50"
                  aria-hidden
                />
              ) : (
                <Cpu className="text-slate-400" size={28} strokeWidth={1.25} />
              )}
            </span>
            <p className="text-sm font-medium text-slate-700">暂无设备数据</p>
            <p className="text-xs text-slate-500 mt-1.5 max-w-[220px] leading-relaxed">
              {filterActive
                ? '当前筛选条件下没有匹配设备，可清除筛选重试'
                : showFacilityIcons && facilityTab !== 'all'
                  ? `暂无${facilityTab === 'airport' ? '机场' : '遥控器'}设备`
                  : showDroneIcons && droneTab !== 'all'
                    ? `暂无${droneTab === 'single' ? '单兵' : '机场'}无人机`
                    : '等待 MQTT 推送设备状态'}
            </p>
            {!filterActive && (
              <span className="inline-flex items-center gap-1.5 mt-4 text-xs text-slate-400">
                <Radio size={12} className="animate-pulse" />
                监听中
              </span>
            )}
          </div>
        ) : (
          visibleDevices.map((device) => (
            <div
              key={deviceScopeKey(device)}
              onClick={() => onSelect(device)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect(device) }}
              role="button"
              tabIndex={0}
              className={`p-4 cursor-pointer transition-all duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                showDroneIcons ? 'focus-visible:ring-indigo-400/50' : 'focus-visible:ring-blue-400/50'
              } ${
                selectedId === deviceScopeKey(device)
                  ? showDroneIcons
                    ? 'bg-indigo-50/80 ring-1 ring-inset ring-indigo-200'
                    : 'bg-blue-50/80 ring-1 ring-inset ring-blue-200'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  {showFacilityIcons && (device.deviceType === 'airport' || device.deviceType === 'remote') ? (
                    <DeviceFacilityIcon
                      deviceType={device.deviceType}
                      status={device.status}
                      getStatusDot={getStatusDot}
                    />
                  ) : showDroneIcons && ['drone', 'single', 'virtual'].includes(device.deviceType) ? (
                    <DeviceDroneIcon
                      deviceType={device.deviceType}
                      status={device.status}
                      getStatusDot={getStatusDot}
                    />
                  ) : (
                    <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${getStatusDot(device.status)}`} aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="font-semibold text-slate-800 truncate">{device.deviceName || device.deviceId}</span>
                      {showMqttSource ? (
                        <span
                          className="inline-flex items-center gap-1 shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium"
                          title={device.mqttBroker || device.mqttProfileName || device.mqttSourceRegionName}
                        >
                          <Unplug size={10} aria-hidden />
                          {device.mqttProfileName || device.mqttSourceRegionName || device.mqttProfileId || device.mqttSourceRegionId || 'MQTT'}
                        </span>
                      ) : (
                        <RegionLabel regionName={device.regionName} regionId={device.regionId} className="shrink-0" />
                      )}
                    </div>
                    {showMqttSource && device.mqttBroker && (
                      <span className="text-[11px] text-amber-700/80 truncate block mt-0.5">{device.mqttBroker}</span>
                    )}
                    {device.deviceName && device.deviceName !== device.deviceId && (
                      <span className="text-xs text-slate-400 truncate block mt-0.5">{device.deviceId}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  {device.metrics.operational && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium border ${
                      device.metrics.operational.value === 'flying'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : device.metrics.operational.value === 'disconnected'
                          ? 'bg-slate-100 text-slate-600 border-slate-200'
                          : 'bg-blue-50 text-blue-700 border-blue-100'
                    }`}>
                      {device.metrics.operational.statusText}
                    </span>
                  )}
                  {device.metrics.modeCode && !device.metrics.operational && (
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
                      {device.metrics.modeCode.statusText}
                    </span>
                  )}
                  {!['drone', 'single', 'virtual'].includes(device.deviceType) && (
                    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${getStatusBadge(device.status)}`}>
                      {device.statusText}
                    </span>
                  )}
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
                {device.metrics.boundDrone && (
                  <div className="flex items-center gap-1 text-sky-700 col-span-2">
                    <Radio size={12} aria-hidden />
                    <span className="truncate">绑定 {device.metrics.boundDrone.name}</span>
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
