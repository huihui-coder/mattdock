import { useState, useEffect, useCallback, memo } from 'react'
import { Bell, Save, Send, Settings, ChevronDown, ChevronUp, WifiOff } from 'lucide-react'

const API = ''

// ─── 飞丢告警 单行卡片（memo 防止兄弟行更新时重渲染）───────────────────────
const LostRow = memo(function LostRow({ deviceId, name, cfg, onUpdate, expanded, onToggle }) {
  const enabled = cfg.enabled || false
  return (
    <div className={enabled ? 'bg-orange-50' : ''}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onUpdate(deviceId, 'enabled', !enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-orange-500' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-800">{name}</p>
            <p className="text-xs text-gray-400">{deviceId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
              {cfg.thresholdMinutes || 30} 分钟
            </span>
          )}
          <button onClick={() => onToggle(deviceId)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-3 space-y-3 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" max="480"
              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={cfg.thresholdMinutes || 30}
              onChange={e => onUpdate(deviceId, 'thresholdMinutes', parseInt(e.target.value) || 30)}
            />
            <span className="text-xs text-gray-500">分钟后推送（无人机离巢超过阈值时）</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onUpdate(deviceId, 'sendSnapshot', !(cfg.sendSnapshot !== false))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${cfg.sendSnapshot !== false ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${cfg.sendSnapshot !== false ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
            <span className="text-xs text-gray-500">告警时发送监控截图（外部/内部/无人机画面）</span>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">设备专属 Webhook（选填）</label>
            <input
              type="text"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="留空则使用全局 Webhook"
              value={cfg.webhookUrl || ''}
              onChange={e => onUpdate(deviceId, 'webhookUrl', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
})

// ─── 机场离线告警 单行卡片 ───────────────────────────────────────────────────
const OfflineRow = memo(function OfflineRow({ deviceId, name, cfg, onUpdate, expanded, onToggle }) {
  const enabled = cfg.offlineAlertEnabled || false
  return (
    <div className={enabled ? 'bg-red-50' : ''}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onUpdate(deviceId, 'offlineAlertEnabled', !enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-red-500' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-800">{name}</p>
            <p className="text-xs text-gray-400">{deviceId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <span className="text-xs text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
              {cfg.offlineRepeatMinutes ? `每 ${cfg.offlineRepeatMinutes} 分钟` : '单次'}
            </span>
          )}
          <button onClick={() => onToggle(deviceId)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-3 space-y-3 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`imm-${deviceId}`}
              checked={cfg.offlineAlertImmediate !== false}
              onChange={e => onUpdate(deviceId, 'offlineAlertImmediate', e.target.checked)}
              className="rounded"
            />
            <label htmlFor={`imm-${deviceId}`} className="text-xs text-gray-600">离线后立即推送一次</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="480"
              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              value={cfg.offlineRepeatMinutes || 0}
              onChange={e => onUpdate(deviceId, 'offlineRepeatMinutes', parseInt(e.target.value) || 0)}
            />
            <span className="text-xs text-gray-500">分钟循环提醒（0 = 不循环）</span>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">设备专属 Webhook（选填）</label>
            <input
              type="text"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="留空则使用全局 Webhook"
              value={cfg.webhookUrl || ''}
              onChange={e => onUpdate(deviceId, 'webhookUrl', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
})

// ─── 主组件 ──────────────────────────────────────────────────────────────────
export default function AlertConfig({ devices }) {
  const [activeTab, setActiveTab] = useState('lost')       // 'lost' | 'offline'
  const [globalWebhookUrl, setGlobalWebhookUrl] = useState('')
  const [deviceConfigs, setDeviceConfigs] = useState({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState(null)
  const [expandedLost, setExpandedLost] = useState({})
  const [expandedOffline, setExpandedOffline] = useState({})

  useEffect(() => {
    fetch(`${API}/api/alert-config`)
      .then(r => r.json())
      .then(data => {
        setGlobalWebhookUrl(data.globalWebhookUrl || '')
        setDeviceConfigs(data.deviceConfigs || {})
      })
      .catch(() => {})
  }, [])

  const showMsg = useCallback((text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await fetch(`${API}/api/alert-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalWebhookUrl, deviceConfigs })
      })
      showMsg('配置已保存')
    } catch {
      showMsg('保存失败', 'error')
    }
    setSaving(false)
  }, [globalWebhookUrl, deviceConfigs, showMsg])

  const handleTest = useCallback(async () => {
    if (!globalWebhookUrl) return showMsg('请先填写 Webhook URL', 'error')
    setTesting(true)
    try {
      await fetch(`${API}/api/alert-config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: globalWebhookUrl, snapshotDeviceId: 'NEST20202412U002', snapshotStream: 'out' })
      })
      showMsg('测试消息已发送，请查看企业微信群')
    } catch {
      showMsg('发送失败', 'error')
    }
    setTesting(false)
  }, [globalWebhookUrl, showMsg])

  // 更新单个设备的某个字段（稳定引用，memo 子组件不重建）
  const updateDevice = useCallback((deviceId, key, value) => {
    setDeviceConfigs(prev => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], [key]: value }
    }))
  }, [])

  const toggleLost = useCallback(id => setExpandedLost(prev => ({ ...prev, [id]: !prev[id] })), [])
  const toggleOffline = useCallback(id => setExpandedOffline(prev => ({ ...prev, [id]: !prev[id] })), [])

  const allDeviceIds = [
    ...new Set([...devices.map(d => d.deviceId), ...Object.keys(deviceConfigs)])
  ]

  const getDeviceName = (deviceId) => {
    const d = devices.find(d => d.deviceId === deviceId)
    return d ? (d.deviceName || deviceId) : deviceId
  }

  const selectAll = useCallback((key, val) => {
    setDeviceConfigs(prev => {
      const next = { ...prev }
      allDeviceIds.forEach(id => { next[id] = { ...next[id], [key]: val } })
      return next
    })
  }, [allDeviceIds])

  return (
    <div className="space-y-4">
      {/* 消息提示 */}
      {message && (
        <div className={`p-3 rounded-lg text-sm font-medium ${
          message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* 全局 Webhook */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Settings size={16} className="text-gray-600" />
          <h3 className="font-semibold text-gray-800">全局企业微信 Webhook</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">企业微信群机器人地址，设备未单独配置时使用此地址。</p>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            value={globalWebhookUrl}
            onChange={e => setGlobalWebhookUrl(e.target.value)}
          />
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <Send size={14} />
            {testing ? '发送中...' : '测试'}
          </button>
        </div>
      </div>

      {/* 告警类型 Tab */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Tab 头 */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('lost')}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'lost'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Bell size={14} />
            🚁 飞丢告警
          </button>
          <button
            onClick={() => setActiveTab('offline')}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'offline'
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <WifiOff size={14} />
            🔴 机场离线告警
          </button>
        </div>

        {/* Tab 操作栏 */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {activeTab === 'lost'
              ? '无人机离巢超过设定时间未返回时推送告警'
              : '机场超过 2 分钟无数据时判定离线并推送'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => selectAll(activeTab === 'lost' ? 'enabled' : 'offlineAlertEnabled', true)}
              className={`text-xs px-3 py-1 border rounded-lg transition-colors ${
                activeTab === 'lost'
                  ? 'bg-orange-50 hover:bg-orange-100 text-orange-600 border-orange-200'
                  : 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200'
              }`}
            >全选</button>
            <button
              onClick={() => selectAll(activeTab === 'lost' ? 'enabled' : 'offlineAlertEnabled', false)}
              className="text-xs px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 rounded-lg transition-colors"
            >全不选</button>
          </div>
        </div>

        {/* 设备列表 */}
        <div className="divide-y divide-gray-100">
          {allDeviceIds.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">暂无设备，等待 MQTT 数据...</div>
          ) : activeTab === 'lost' ? (
            allDeviceIds.map(deviceId => (
              <LostRow
                key={deviceId}
                deviceId={deviceId}
                name={getDeviceName(deviceId)}
                cfg={deviceConfigs[deviceId] || {}}
                onUpdate={updateDevice}
                expanded={!!expandedLost[deviceId]}
                onToggle={toggleLost}
              />
            ))
          ) : (
            allDeviceIds.map(deviceId => (
              <OfflineRow
                key={deviceId}
                deviceId={deviceId}
                name={getDeviceName(deviceId)}
                cfg={deviceConfigs[deviceId] || {}}
                onUpdate={updateDevice}
                expanded={!!expandedOffline[deviceId]}
                onToggle={toggleOffline}
              />
            ))
          )}
        </div>
      </div>

      {/* 保存 */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? '保存中...' : '保存所有配置'}
      </button>
    </div>
  )
}
