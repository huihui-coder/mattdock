import { X, Thermometer, Droplets, Battery, Signal, Wind, CloudRain, MapPin, Activity, Clock, Wifi, Plane, HardDrive, Zap, Shield, Sun, Compass, Database } from 'lucide-react'
import LiveStreamPlayer from './LiveStreamPlayer'

export default function DeviceDetail({ device, onClose }) {
  const getMetricStatusColor = (status) => {
    switch (status) {
      case 'normal': return 'text-green-600 bg-green-50'
      case 'warning': return 'text-yellow-600 bg-yellow-50'
      case 'critical': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getMetricIcon = (type) => {
    switch (type) {
      case 'temperature': return Thermometer
      case 'humidity': return Droplets
      case 'battery': return Battery
      case 'signal': return Signal
      case 'windSpeed': return Wind
      case 'environmentTemp': return Thermometer
      case 'droneBattery': return Battery
      case 'networkQuality': return Wifi
      case 'rainfall': return CloudRain
      case 'droneInDock': return Plane
      case 'modeCode': return Activity
      default: return Activity
    }
  }

  const getMetricName = (type) => {
    const names = {
      temperature: '机库温度',
      humidity: '机库湿度',
      battery: '电量',
      signal: '信号强度',
      windSpeed: '风速',
      environmentTemp: '环境温度',
      droneBattery: '无人机电量',
      networkQuality: '网络质量',
      rainfall: '降雨量',
      droneInDock: '无人机状态',
      modeCode: '工作模式',
      operational: '运行状态'
    }
    return names[type] || type
  }

  // 风速特殊样式 - 重点显示
  const isWindSpeed = (type) => type === 'windSpeed'

  // 从原始数据提取更多详细信息
  const raw = device.raw || {}
  const rawData = raw.data || raw

  // 格式化字节大小
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) return `${gb.toFixed(2)} GB`
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(2)} MB`
  }

  // 存储信息
  const storage = rawData.storage
  // 子设备信息
  const subDevice = rawData.sub_device
  // 空调信息
  const airConditioner = rawData.air_conditioner
  // 备降点信息
  const alternateLandPoint = rawData.alternate_land_point
  // 定位状态
  const positionState = rawData.position_state
  // 无人机权限信息
  const droneAuthority = rawData.drone_authority_info

  // 判断设备类型（直接用后端字段）
  const deviceType = device.deviceType || (device.deviceId.startsWith('NEST') ? 'airport' : 'drone')

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{device.deviceId}</h3>
            <p className="text-sm text-gray-500">{device.topic}</p>
            {device.gateway && (
              <p className="text-xs text-gray-400 mt-1">网关: {device.gateway}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              device.status === 'normal' ? 'bg-green-100 text-green-800' :
              device.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
              device.status === 'critical' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {device.statusText}
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* 时间戳 */}
        <div className="px-4 py-2 bg-gray-100 text-xs text-gray-500 flex items-center gap-4">
          <span className="flex items-center gap-1"><Clock size={12} />更新时间: {new Date(device.lastUpdate).toLocaleString('zh-CN')}</span>
          {device.timestamp && <span>原始时间戳: {device.timestamp}</span>}
        </div>

        {/* 风速重点显示 */}
        {device.metrics.windSpeed && (
          <div className={`p-5 border-b border-gray-200 ${
            device.metrics.windSpeed.status === 'critical' ? 'bg-red-50' :
            device.metrics.windSpeed.status === 'warning' ? 'bg-yellow-50' : 'bg-blue-50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${
                  device.metrics.windSpeed.status === 'critical' ? 'bg-red-100' :
                  device.metrics.windSpeed.status === 'warning' ? 'bg-yellow-100' : 'bg-blue-100'
                }`}>
                  <Wind size={32} className={
                    device.metrics.windSpeed.status === 'critical' ? 'text-red-600' :
                    device.metrics.windSpeed.status === 'warning' ? 'text-yellow-600' : 'text-blue-600'
                  } />
                </div>
                <div>
                  <p className="text-sm text-gray-500 font-medium">风速 (重点监测)</p>
                  <p className={`text-4xl font-bold ${
                    device.metrics.windSpeed.status === 'critical' ? 'text-red-600' :
                    device.metrics.windSpeed.status === 'warning' ? 'text-yellow-600' : 'text-blue-600'
                  }`}>
                    {device.metrics.windSpeed.value} <span className="text-xl">m/s</span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className={`inline-block px-4 py-2 rounded-full text-sm font-medium ${
                  device.metrics.windSpeed.status === 'normal' ? 'bg-green-100 text-green-800' :
                  device.metrics.windSpeed.status === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {device.metrics.windSpeed.statusText}
                </span>
                <p className="text-xs text-gray-400 mt-2">阈值: 0-10正常, 10-20警告, &gt;20严重</p>
              </div>
            </div>
          </div>
        )}

        {/* 直播流 */}
        <div className="p-4 border-b border-gray-200">
          <LiveStreamPlayer deviceId={device.deviceId} deviceType={deviceType} />
        </div>

        {/* 位置信息 */}
        {device.location && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <MapPin size={16} /> 位置信息
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500">纬度</span>
                <p className="font-mono font-medium">{device.location.latitude.toFixed(6)}</p>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500">经度</span>
                <p className="font-mono font-medium">{device.location.longitude.toFixed(6)}</p>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500">高度</span>
                <p className="font-medium">{device.location.height?.toFixed(2)} m</p>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <span className="text-gray-500">航向</span>
                <p className="font-medium">{device.location.heading?.toFixed(1)}°</p>
              </div>
            </div>
          </div>
        )}

        {/* 环境指标 */}
        <div className="p-4 border-b border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Thermometer size={16} /> 环境指标
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(device.metrics)
              .filter(([type]) => !isWindSpeed(type))
              .map(([type, metric]) => {
              const Icon = getMetricIcon(type)
              return (
                <div
                  key={type}
                  className={`p-3 rounded-lg ${getMetricStatusColor(metric.status)}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={14} />
                    <span className="text-xs font-medium">{getMetricName(type)}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold">{metric.value}</span>
                    <span className="text-xs">{metric.unit}</span>
                  </div>
                  <div className="text-xs mt-1 opacity-75">{metric.statusText}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 无人机状态 */}
        {rawData.drone_charge_state && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Plane size={16} /> 无人机状态
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">电量</span>
                <p className="font-bold text-lg">{rawData.drone_charge_state.capacity_percent}%</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">充电状态</span>
                <p className="font-medium">{rawData.drone_charge_state.state === 0 ? '未充电' : '充电中'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">在库状态</span>
                <p className="font-medium">{rawData.drone_in_dock === 1 ? '✓ 在库' : '✗ 出库'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">工作模式</span>
                <p className="font-medium">{device.metrics.modeCode?.statusText || '-'}</p>
              </div>
            </div>
          </div>
        )}

        {/* 网络状态 */}
        {rawData.network_state && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Wifi size={16} /> 网络状态
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">类型</span>
                <p className="font-medium">{rawData.network_state.type === 2 ? '4G' : `类型${rawData.network_state.type}`}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">信号质量</span>
                <p className="font-bold text-lg">{rawData.network_state.quality}/5</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">速率</span>
                <p className="font-medium">{rawData.network_state.rate?.toFixed(1)} Mbps</p>
              </div>
            </div>
          </div>
        )}

        {/* 存储信息 */}
        {storage && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <HardDrive size={16} /> 存储信息
            </h4>
            <div className="flex items-center gap-4">
              <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                <div 
                  className="bg-blue-500 h-full transition-all"
                  style={{ width: `${(storage.used / storage.total) * 100}%` }}
                />
              </div>
              <span className="text-sm text-gray-600">
                {formatBytes(storage.used)} / {formatBytes(storage.total)}
              </span>
            </div>
          </div>
        )}

        {/* 定位状态 */}
        {positionState && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Compass size={16} /> 定位状态
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">校准状态</span>
                <p className="font-medium">{positionState.is_calibration ? '✓ 已校准' : '未校准'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">固定状态</span>
                <p className="font-medium">{positionState.is_fixed ? '✓ 已固定' : '未固定'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">定位质量</span>
                <p className="font-bold">{positionState.quality}/5</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">GPS/RTK</span>
                <p className="font-medium">{positionState.gps_number}/{positionState.rtk_number}</p>
              </div>
            </div>
          </div>
        )}

        {/* 空调状态 */}
        {airConditioner && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Sun size={16} /> 空调状态
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">运行状态</span>
                <p className="font-medium">{airConditioner.air_conditioner_state ? '✓ 运行中' : '已关闭'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">切换时间</span>
                <p className="font-medium">{airConditioner.switch_time}s</p>
              </div>
            </div>
          </div>
        )}

        {/* 备降点信息 */}
        {alternateLandPoint && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Shield size={16} /> 备降点信息
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">纬度</span>
                <p className="font-mono">{alternateLandPoint.latitude?.toFixed(6)}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">经度</span>
                <p className="font-mono">{alternateLandPoint.longitude?.toFixed(6)}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">高度</span>
                <p className="font-medium">{alternateLandPoint.height?.toFixed(1)}m</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">配置状态</span>
                <p className="font-medium">{alternateLandPoint.is_configured ? '✓ 已配置' : '未配置'}</p>
              </div>
            </div>
          </div>
        )}

        {/* 子设备信息 */}
        {subDevice && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Database size={16} /> 子设备信息
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">序列号</span>
                <p className="font-medium">{subDevice.device_sn || '-'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">型号</span>
                <p className="font-medium">{subDevice.device_model_key || '-'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">在线状态</span>
                <p className="font-medium">{subDevice.device_online_status ? '✓ 在线' : '离线'}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-gray-500 text-xs">配对状态</span>
                <p className="font-medium">{subDevice.device_paired ? '✓ 已配对' : '未配对'}</p>
              </div>
            </div>
          </div>
        )}

        {/* 其他状态 */}
        <div className="p-4 border-b border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Zap size={16} /> 其他状态
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">舱盖状态</span>
              <p className="font-medium">{rawData.cover_state === 0 ? '关闭' : '打开'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">补光灯</span>
              <p className="font-medium">{rawData.supplement_light_state === 0 ? '关闭' : '开启'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">急停状态</span>
              <p className="font-medium">{rawData.emergency_stop_state === 0 ? '正常' : '已急停'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">静音模式</span>
              <p className="font-medium">{rawData.silent_mode === 0 ? '关闭' : '开启'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">电池存储模式</span>
              <p className="font-medium">{rawData.battery_store_mode || '-'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">推杆状态</span>
              <p className="font-medium">{rawData.putter_state || '-'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">归航点有效</span>
              <p className="font-medium">{rawData.home_position_is_valid ? '✓ 有效' : '无效'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 text-xs">首次上电</span>
              <p className="font-medium">{rawData.first_power_on ? '是' : '否'}</p>
            </div>
          </div>
        </div>

        {/* 告警信息 */}
        {device.alerts && device.alerts.length > 0 && (
          <div className="p-4 border-b border-gray-200">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Activity size={16} /> 告警信息
            </h4>
            <div className="space-y-2">
              {device.alerts.map((alert, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg text-sm ${
                    alert.level === 'critical' ? 'bg-red-50 text-red-800 border border-red-200' :
                    alert.level === 'warning' ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' :
                    'bg-gray-50 text-gray-800 border border-gray-200'
                  }`}
                >
                  <span className="font-bold">[{alert.level.toUpperCase()}]</span>
                  <span className="ml-2">{alert.message}</span>
                  {alert.code && <span className="ml-2 text-xs opacity-75">({alert.code})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 原始数据 (可折叠) */}
        <div className="p-4">
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700 flex items-center gap-2 hover:text-gray-900">
              <Database size={16} /> 原始JSON数据
              <span className="text-xs text-gray-400 group-open:hidden">点击展开</span>
              <span className="text-xs text-gray-400 hidden group-open:inline">点击收起</span>
            </summary>
            <pre className="mt-3 bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto max-h-80 font-mono">
              {JSON.stringify(device.raw, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  )
}
