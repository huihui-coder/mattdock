import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Header from './components/Header'
import StatusPanel from './components/StatusPanel'
import DeviceList from './components/DeviceList'
import DeviceDetail from './components/DeviceDetail'
import AlertList from './components/AlertList'
import AlertConfig from './components/AlertConfig'
import FlightDashboard from './components/FlightDashboard'
import Login from './components/Login'
import VirtualCockpit from './components/VirtualCockpit'
import AccountManager from './components/AccountManager'
import { Activity, Wifi, WifiOff, LayoutDashboard, Bell, History, Users } from 'lucide-react'

const IS_PROD = import.meta.env.PROD

function getToken() { return localStorage.getItem('auth_token') || '' }
function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('auth_user') || 'null') } catch { return null }
}
function apiFetch(url, opts = {}) {
  const token = getToken()
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-auth-token': token } })
}

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const MAX_ALERTS = 20  // 限制风速告警数量
const MAX_HEALTH_ALERTS_PER_DEVICE = 5  // 每个设备最多保留5条健康告警
const ALERT_UPDATE_INTERVAL = 5000  // 告警列表更新间隔（毫秒）

function App() {
  const [token, setToken] = useState(getToken())
  const [user, setUser] = useState(getStoredUser())
  const [activeTab, setActiveTab] = useState('monitor') // 'monitor' | 'alert-config'
  const [mqttConnected, setMqttConnected] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [devices, setDevices] = useState([])
  const [alerts, setAlerts] = useState([])
  const [alertsBuffer, setAlertsBuffer] = useState([])  // 告警缓冲区
  const [healthAlerts, setHealthAlerts] = useState({}) // 按设备ID存储健康告警
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [statusFilter, setStatusFilter] = useState(null)  // 状态筛选：null/warning/critical
  const [cockpitDevice, setCockpitDevice] = useState(null)
  const wsRef = useRef(null)
  const alertUpdateTimerRef = useRef(null)

  // WebSocket连接（含自动重连）
  const reconnectTimerRef = useRef(null)
  const destroyedRef = useRef(false)

  useEffect(() => {
    destroyedRef.current = false

    function connect() {
      if (destroyedRef.current) return
      const websocket = new WebSocket(WS_URL)

      websocket.onopen = () => {
        console.log('[WS] 已连接')
        setWsConnected(true)
      }

      websocket.onclose = () => {
        console.log('[WS] 已断开，3秒后重连...')
        setWsConnected(false)
        wsRef.current = null
        if (!destroyedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 3000)
        }
      }

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data)
        handleMessage(data)
      }

      websocket.onerror = () => {
        websocket.close()
      }

      wsRef.current = websocket
    }

    connect()

    return () => {
      destroyedRef.current = true
      clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    }
  }, [])

  // 告警列表定期更新（每5秒）
  useEffect(() => {
    // 定时更新告警列表
    const updateAlerts = () => {
      setAlertsBuffer(prevBuffer => {
        if (prevBuffer.length > 0) {
          setAlerts(prev => {
            // 合并缓冲区和现有告警
            const merged = [...prevBuffer, ...prev]
            // 去重：同类型、同级别、同设备只保留一个（保留最新的）
            const deduplicated = merged.filter((alert, idx, arr) => {
              const firstIdx = arr.findIndex(a => 
                a.metric === alert.metric && 
                a.type === alert.type && 
                a.deviceId === alert.deviceId
              )
              return firstIdx === idx
            })
            return deduplicated.slice(0, MAX_ALERTS)
          })
          return []  // 清空缓冲区
        }
        return prevBuffer
      })
    }

    // 启动定时器
    alertUpdateTimerRef.current = setInterval(updateAlerts, ALERT_UPDATE_INTERVAL)

    // 清理定时器
    return () => {
      if (alertUpdateTimerRef.current) {
        clearInterval(alertUpdateTimerRef.current)
      }
    }
  }, [])  // 只在组件挂载时执行一次

  // 处理WebSocket消息 - 直接覆盖，不累积
  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case 'connection':
        setMqttConnected(data.status === 'connected')
        break
      case 'device_data':
        // 直接更新设备数据，覆盖之前的
        setDevices(prev => {
          const index = prev.findIndex(d => d.deviceId === data.processed.deviceId)
          const newDevice = {
            ...data.processed,
            raw: data.raw,
            topic: data.topic
          }
          if (index >= 0) {
            // 更新已存在的设备
            const updated = [...prev]
            updated[index] = newDevice
            return updated
          }
          // 新设备，添加到列表
          return [...prev, newDevice]
        })
        break
      case 'alert':
        // 将告警放入缓冲区，等待定时更新
        setAlertsBuffer(prev => {
          const newAlert = {
            ...data.alert,
            deviceId: data.deviceId,
            deviceName: data.deviceName,
            topic: data.topic,
            timestamp: data.timestamp,
            id: Date.now()
          }
          // 去重：同类型、同级别、同设备只保留一个
          const merged = [newAlert, ...prev].filter((alert, idx, arr) => {
            const firstIdx = arr.findIndex(a => 
              a.metric === alert.metric && 
              a.type === alert.type && 
              a.deviceId === alert.deviceId
            )
            return firstIdx === idx
          })
          return merged.slice(0, MAX_ALERTS * 2)
        })
        break
      case 'health_alert':
        // 存储健康告警，按设备ID分组，限制数量
        setHealthAlerts(prev => {
          const existing = prev[data.deviceId] || []
          // 合并新旧告警，去重（按code），保留最新的
          const merged = [...data.healthAlerts, ...existing]
            .filter((alert, idx, arr) => 
              arr.findIndex(a => a.code === alert.code) === idx
            )
            .slice(0, MAX_HEALTH_ALERTS_PER_DEVICE)
          return {
            ...prev,
            [data.deviceId]: merged
          }
        })
        break
      default:
        break
    }
  }, [])

  // 获取初始设备列表
  useEffect(() => {
    apiFetch('/api/devices')
      .then(res => { if (res.status === 401) { setToken(''); localStorage.removeItem('auth_token') } return res.json() })
      .then(data => setDevices(data.devices || []))
      .catch(err => console.error('获取设备列表失败:', err))
    
    apiFetch('/api/status')
      .then(res => res.json())
      .then(data => setMqttConnected(data.mqtt?.connected || false))
      .catch(err => console.error('获取状态失败:', err))
  }, [token])

  // 统计数据
  const airportDevices = devices.filter(d => d.deviceType === 'airport' || d.deviceType === 'remote')
  const droneDevices = devices.filter(d => d.deviceType === 'drone')
  
  // 根据状态筛选设备
  const filteredAirportDevices = statusFilter 
    ? airportDevices.filter(d => d.status === statusFilter)
    : airportDevices
  const filteredDroneDevices = statusFilter
    ? droneDevices.filter(d => d.status === statusFilter)
    : droneDevices
  
  const stats = {
    total: devices.length,
    airport: airportDevices.length,
    drone: droneDevices.length,
    normal: devices.filter(d => d.status === 'normal').length,
    warning: devices.filter(d => d.status === 'warning').length,
    critical: devices.filter(d => d.status === 'critical').length
  }

  const hasPermission = (p) => user?.role === 'admin' || user?.permissions?.includes(p)
  const visibleTabs = [
    hasPermission('monitor') && { key: 'monitor', label: '实时监控', icon: LayoutDashboard },
    hasPermission('alert-config') && { key: 'alert-config', label: '离巢告警配置', icon: Bell },
    hasPermission('flight-records') && { key: 'flight-records', label: '飞行记录', icon: History },
    user?.role === 'admin' && { key: 'accounts', label: '账号管理', icon: Users }
  ].filter(Boolean)

  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.find(t => t.key === activeTab)) setActiveTab(visibleTabs[0].key)
  }, [user, activeTab])

  const handleLogout = async () => {
    try { await apiFetch('/api/logout', { method: 'POST' }) } catch {}
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    setToken('')
    setUser(null)
  }

  // 未登录（生产模式）显示登录页
  if (IS_PROD && !token) {
    return <Login onLogin={(t, u) => { setToken(t); setUser(u) }} />
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        mqttConnected={mqttConnected} 
        wsConnected={wsConnected}
        user={user}
        onLogout={handleLogout}
      />
      
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Tab 切换 */}
        <div className="flex gap-1 mb-4 bg-white rounded-lg p-1 shadow-sm border border-gray-200 w-fit">
          {visibleTabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            )
          })}
        </div>
        {/* 连接状态提示 */}
        {!mqttConnected && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2">
            <WifiOff className="text-yellow-600" size={20} />
            <span className="text-yellow-800">MQTT服务未连接，正在尝试重连...</span>
          </div>
        )}

        {/* 监控内容（仅 monitor tab 显示） */}
        {activeTab === 'monitor' && hasPermission('monitor') && <>
        {/* 状态概览 */}
        <StatusPanel 
          stats={stats} 
          onFilter={setStatusFilter}
          activeFilter={statusFilter}
        />

        {/* 主内容区 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          {/* 机场设备列表 */}
          <div className="lg:col-span-1">
            <DeviceList 
              devices={filteredAirportDevices} 
              healthAlerts={healthAlerts}
              onSelect={setSelectedDevice}
              selectedId={selectedDevice?.deviceId}
              title="机场设备"
              filterActive={statusFilter !== null}
              onClearFilter={() => setStatusFilter(null)}
              onCockpit={setCockpitDevice}
            />
          </div>

          {/* 无人机设备列表 */}
          <div className="lg:col-span-1">
            <DeviceList 
              devices={filteredDroneDevices} 
              healthAlerts={healthAlerts}
              onSelect={setSelectedDevice}
              selectedId={selectedDevice?.deviceId}
              title="无人机设备"
              filterActive={statusFilter !== null}
              onClearFilter={() => setStatusFilter(null)}
            />
          </div>
          
          {/* 告警列表 */}
          <div className="lg:col-span-1">
            <AlertList alerts={alerts} />
          </div>
        </div>

        </>}

        {/* 告警配置页 */}
        {activeTab === 'alert-config' && hasPermission('alert-config') && (
          <AlertConfig devices={devices} />
        )}

        {/* 飞行记录页 */}
        {activeTab === 'flight-records' && hasPermission('flight-records') && (
          <FlightDashboard />
        )}

        {activeTab === 'accounts' && user?.role === 'admin' && (
          <AccountManager />
        )}

        {/* 设备详情弹窗 */}
        {selectedDevice && (
          <DeviceDetail 
            device={selectedDevice} 
            onClose={() => setSelectedDevice(null)} 
          />
        )}

        {/* 虚拟座舱 */}
        {cockpitDevice && (
          <VirtualCockpit
            device={cockpitDevice}
            onClose={() => setCockpitDevice(null)}
          />
        )}
      </main>
    </div>
  )
}

export default App
