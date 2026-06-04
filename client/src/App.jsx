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
import UserProfile from './components/UserProfile'
import ImageStudio from './components/ImageStudio'
import FloatingAssistant from './components/FloatingAssistant'
import { Activity, Wifi, WifiOff, LayoutDashboard, Bell, History, Users, Sparkles } from 'lucide-react'

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
  const [profileOpen, setProfileOpen] = useState(false)
  const wsRef = useRef(null)
  const alertUpdateTimerRef = useRef(null)

  // WebSocket连接（含自动重连）
  const reconnectTimerRef = useRef(null)
  const reconnectDelayRef = useRef(3000)
  const destroyedRef = useRef(false)

  useEffect(() => {
    if (!token) return undefined
    destroyedRef.current = false
    reconnectDelayRef.current = 3000

    function connect() {
      if (destroyedRef.current) return
      const websocket = new WebSocket(WS_URL)

      websocket.onopen = () => {
        console.log('[WS] 已连接')
        reconnectDelayRef.current = 3000
        setWsConnected(true)
      }

      websocket.onclose = () => {
        console.log('[WS] 已断开，稍后重连...')
        setWsConnected(false)
        wsRef.current = null
        if (!destroyedRef.current) {
          const delay = reconnectDelayRef.current
          reconnectDelayRef.current = Math.min(delay * 2, 30000)
          reconnectTimerRef.current = setTimeout(connect, delay)
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
  }, [token])

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
    if (!token) return

    if (!user) {
      apiFetch('/api/me')
        .then(async res => {
          if (!res.ok) throw new Error('会话已过期')
          return res.json()
        })
        .then(data => {
          localStorage.setItem('auth_user', JSON.stringify(data.user))
          setUser(data.user)
        })
        .catch(() => {
          localStorage.removeItem('auth_token')
          localStorage.removeItem('auth_user')
          setToken('')
          setUser(null)
        })
      return
    }

    apiFetch('/api/devices')
      .then(res => { if (res.status === 401) { setToken(''); setUser(null); localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user') } return res.json() })
      .then(data => setDevices(data.devices || []))
      .catch(err => console.error('获取设备列表失败:', err))
    
    apiFetch('/api/status')
      .then(res => res.json())
      .then(data => setMqttConnected(data.mqtt?.connected || false))
      .catch(err => console.error('获取状态失败:', err))
  }, [token, user])

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
    user?.role === 'admin' && { key: 'accounts', label: '账号管理', icon: Users },
    hasPermission('image-studio') && { key: 'image-studio', label: 'AI 生图', icon: Sparkles },
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
    setProfileOpen(false)
  }

  const handleUserUpdate = (nextUser) => {
    if (!nextUser) return
    localStorage.setItem('auth_user', JSON.stringify(nextUser))
    setUser(nextUser)
  }

  if (!token) {
    return <Login onLogin={(t, u) => { setToken(t); setUser(u) }} />
  }

  if (token && !user) {
    return (
      <div className="ui-page">
        <Header mqttConnected={mqttConnected} wsConnected={wsConnected} />
        <div className="max-w-7xl mx-auto px-4 py-6 text-sm text-dji-muted">正在恢复登录状态...</div>
      </div>
    )
  }

  return (
    <div className="ui-page">
      <Header 
        mqttConnected={mqttConnected} 
        wsConnected={wsConnected}
        user={user}
        onLogout={handleLogout}
        onOpenProfile={() => setProfileOpen(true)}
      />
      
      <main className="max-w-7xl mx-auto px-4 py-5">
        <nav className="ui-nav-bar-full mb-5" aria-label="主导航">
          {visibleTabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                aria-current={activeTab === tab.key ? 'page' : undefined}
                className={`ui-tab flex-1 sm:flex-none justify-center ${activeTab === tab.key ? 'ui-tab-active' : 'ui-tab-inactive'}`}
              >
                <Icon size={15} aria-hidden />
                {tab.label}
              </button>
            )
          })}
        </nav>
        {/* 连接状态提示 */}
        {!mqttConnected && (
          <div className="mb-4 p-3.5 ui-card flex items-center gap-3 border-amber-200 bg-amber-50" role="alert">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
              <WifiOff className="text-amber-700" size={16} />
            </span>
            <div>
              <p className="text-sm font-medium text-amber-900">MQTT 未连接</p>
              <p className="text-xs text-amber-800/80 mt-0.5">正在尝试重连，设备数据可能延迟</p>
            </div>
          </div>
        )}

        {/* 监控内容（仅 monitor tab 显示） */}
        {activeTab === 'monitor' && hasPermission('monitor') && (
        <section aria-labelledby="monitor-heading">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="monitor-heading" className="text-xl font-semibold text-slate-800 tracking-tight">实时监控</h2>
              <p className="text-sm text-slate-500 mt-1 tabular-nums">
                {stats.total} 台设备 · {stats.normal} 正常
                {stats.warning > 0 && <span className="text-amber-600"> · {stats.warning} 警告</span>}
                {stats.critical > 0 && <span className="text-red-600"> · {stats.critical} 严重</span>}
                <span className="text-slate-400"> · {alerts.length} 条近期告警</span>
              </p>
            </div>
            {statusFilter && (
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                className="ui-btn-secondary shrink-0"
              >
                清除状态筛选
              </button>
            )}
          </div>

        <StatusPanel 
          stats={stats} 
          onFilter={setStatusFilter}
          activeFilter={statusFilter}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5 lg:items-stretch">
          <div className="lg:col-span-1 flex flex-col min-h-0">
            <DeviceList 
              devices={filteredAirportDevices} 
              healthAlerts={healthAlerts}
              onSelect={setSelectedDevice}
              selectedId={selectedDevice?.deviceId}
              title="机场设备"
              accent="blue"
              filterActive={statusFilter !== null}
              onClearFilter={() => setStatusFilter(null)}
              onCockpit={setCockpitDevice}
              className="flex-1"
            />
          </div>

          <div className="lg:col-span-1 flex flex-col min-h-0">
            <DeviceList 
              devices={filteredDroneDevices} 
              healthAlerts={healthAlerts}
              onSelect={setSelectedDevice}
              selectedId={selectedDevice?.deviceId}
              title="无人机设备"
              accent="indigo"
              filterActive={statusFilter !== null}
              onClearFilter={() => setStatusFilter(null)}
              className="flex-1"
            />
          </div>
          
          <div className="lg:col-span-1 flex flex-col min-h-0">
            <AlertList alerts={alerts} className="flex-1" />
          </div>
        </div>

        </section>)}

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

        {activeTab === 'image-studio' && hasPermission('image-studio') && (
          <ImageStudio />
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

        {profileOpen && user && (
          <UserProfile
            user={user}
            onClose={() => setProfileOpen(false)}
            onUserUpdate={handleUserUpdate}
          />
        )}
      </main>

      {hasPermission('ai-assistant') && user && (
        <FloatingAssistant
          alertCount={alerts.length}
          context={{
            stats,
            mqttConnected,
            wsConnected,
            alerts: alerts.slice(0, 12).map((a) => ({
              deviceId: a.deviceId,
              deviceName: a.deviceName,
              type: a.type,
              level: a.level,
              message: a.message,
            })),
            selectedDevice: selectedDevice
              ? {
                  deviceId: selectedDevice.deviceId,
                  name: selectedDevice.name,
                  status: selectedDevice.status,
                  windSpeed: selectedDevice.windSpeed,
                  battery: selectedDevice.battery,
                }
              : null,
          }}
        />
      )}
    </div>
  )
}

export default App
