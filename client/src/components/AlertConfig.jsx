import { useState, useEffect, useCallback, memo } from 'react'
import { Bell, Save, Send, Settings, ChevronDown, ChevronUp, WifiOff } from 'lucide-react'

const API = ''

// ─── 飞丢告警 单行卡片（memo 防止兄弟行更新时重渲染）───────────────────────
const LostRow = memo(function LostRow({ deviceId, name, cfg, onUpdate, expanded, onToggle }) {
  const enabled = cfg.enabled || false
  return (
    <div className={enabled ? 'bg-orange-50/60' : ''}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onUpdate(deviceId, 'enabled', !enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-orange-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-medium text-dji-black">{name}</p>
            <p className="text-xs text-dji-subtle">{deviceId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <span className="ui-badge bg-orange-100 text-orange-700 border border-orange-200">
              {cfg.thresholdMinutes || 30} 分钟
            </span>
          )}
          <button onClick={() => onToggle(deviceId)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-3 space-y-3 bg-dji-page border-t border-dji-border">
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" max="480"
              className="ui-input w-24 py-1.5"
              value={cfg.thresholdMinutes || 30}
              onChange={e => onUpdate(deviceId, 'thresholdMinutes', parseInt(e.target.value) || 30)}
            />
            <span className="text-xs text-dji-muted">分钟后推送（无人机离巢超过阈值时）</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onUpdate(deviceId, 'sendSnapshot', !(cfg.sendSnapshot !== false))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${cfg.sendSnapshot !== false ? 'bg-blue-500' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${cfg.sendSnapshot !== false ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
            <span className="text-xs text-dji-muted">告警时发送监控截图（外部/内部/无人机画面）</span>
          </div>
          <div>
            <label className="text-xs font-medium text-dji-ink">设备专属 Webhook（选填）</label>
            <input
              type="text"
              className="ui-input mt-1 py-1.5"
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
    <div className={enabled ? 'bg-red-50/60' : ''}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onUpdate(deviceId, 'offlineAlertEnabled', !enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-red-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-medium text-dji-black">{name}</p>
            <p className="text-xs text-dji-subtle">{deviceId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <span className="ui-badge bg-red-100 text-red-700 border border-red-200">
              {cfg.offlineRepeatMinutes ? `每 ${cfg.offlineRepeatMinutes} 分钟` : '单次'}
            </span>
          )}
          <button onClick={() => onToggle(deviceId)} className="text-gray-400 hover:text-gray-600 p-1">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-3 space-y-3 bg-dji-page border-t border-dji-border">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`imm-${deviceId}`}
              checked={cfg.offlineAlertImmediate !== false}
              onChange={e => onUpdate(deviceId, 'offlineAlertImmediate', e.target.checked)}
              className="rounded border-dji-border text-dji-black focus:ring-dji-black/20"
            />
            <label htmlFor={`imm-${deviceId}`} className="text-xs text-dji-muted">离线后立即推送一次</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="480"
              className="ui-input w-24 py-1.5"
              value={cfg.offlineRepeatMinutes || 0}
              onChange={e => onUpdate(deviceId, 'offlineRepeatMinutes', parseInt(e.target.value) || 0)}
            />
            <span className="text-xs text-dji-muted">分钟循环提醒（0 = 不循环）</span>
          </div>
          <div>
            <label className="text-xs font-medium text-dji-ink">设备专属 Webhook（选填）</label>
            <input
              type="text"
              className="ui-input mt-1 py-1.5"
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
      <div className="ui-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Settings size={16} className="text-dji-black" />
          <h3 className="ui-section-title text-sm">全局企业微信 Webhook</h3>
        </div>
        <p className="text-xs text-dji-muted mb-3">企业微信群机器人地址，设备未单独配置时使用此地址。</p>
        <div className="flex gap-2">
          <input
            type="text"
            className="ui-input flex-1"
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            value={globalWebhookUrl}
            onChange={e => setGlobalWebhookUrl(e.target.value)}
          />
          <button
            onClick={handleTest}
            disabled={testing}
            className="ui-btn-secondary !text-sm disabled:opacity-50"
          >
            <Send size={14} />
            {testing ? '发送中...' : '测试'}
          </button>
        </div>
      </div>

      {/* 告警类型 Tab */}
      <div className="ui-card overflow-hidden">
        {/* Tab 头 */}
        <div className="flex border-b border-slate-100 px-2 pt-2 gap-1">
          <button
            onClick={() => setActiveTab('lost')}
            className={`ui-tab ${activeTab === 'lost' ? 'ui-tab-active !bg-orange-500' : 'ui-tab-inactive !hover:text-orange-600 !hover:bg-orange-50'}`}
          >
            <Bell size={14} />
            飞丢告警
          </button>
          <button
            onClick={() => setActiveTab('offline')}
            className={`ui-tab ${activeTab === 'offline' ? 'ui-tab-active !bg-red-500' : 'ui-tab-inactive !hover:text-red-600 !hover:bg-red-50'}`}
          >
            <WifiOff size={14} />
            机场离线告警
          </button>
        </div>

        {/* Tab 操作栏 */}
        <div className="px-4 py-2.5 border-b border-dji-border flex items-center justify-between gap-3">
          <p className="text-xs text-dji-muted">
            {activeTab === 'lost'
              ? '无人机离巢超过设定时间未返回时推送告警'
              : '机场超过 2 分钟无数据时判定离线并推送'}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => selectAll(activeTab === 'lost' ? 'enabled' : 'offlineAlertEnabled', true)}
              className="ui-btn-secondary !text-xs"
            >全选</button>
            <button
              onClick={() => selectAll(activeTab === 'lost' ? 'enabled' : 'offlineAlertEnabled', false)}
              className="ui-btn-secondary !text-xs"
            >全不选</button>
          </div>
        </div>

        {/* 设备列表 */}
        <div className="divide-y divide-dji-border">
          {allDeviceIds.length === 0 ? (
            <div className="p-8 text-center text-dji-muted text-sm">暂无设备，等待 MQTT 数据...</div>
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
        className="ui-btn-primary w-full disabled:opacity-50"
      >
        <Save size={16} />
        {saving ? '保存中...' : '保存所有配置'}
      </button>
    </div>
  )
}
