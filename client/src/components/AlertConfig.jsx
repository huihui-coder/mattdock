import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import {
  Bell, Save, Send, Settings, WifiOff, Search, Download, ChevronRight,
  ChevronDown, PanelLeftClose, PanelLeft, Pencil, FlaskConical,
} from 'lucide-react'
import ListPagination, { paginateSlice } from './ListPagination'
import { withScopeQuery } from '../lib/scope-query'

const API = ''

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(`${API}${url}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

function ToggleSwitch({ enabled, onChange, accent = 'orange', label }) {
  const colors = {
    orange: enabled ? 'bg-orange-500' : 'bg-slate-300',
    red: enabled ? 'bg-red-500' : 'bg-slate-300',
    blue: enabled ? 'bg-blue-600' : 'bg-slate-300',
  }
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${colors[accent] || colors.orange}`}
      aria-pressed={enabled}
      aria-label={label}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`}
      />
    </button>
  )
}

function AiAnalysisToggle({ deviceId, cfg, onUpdate, hint }) {
  const enabled = cfg.aiAnalysisEnabled !== false
  return (
    <div className="flex items-center gap-3">
      <ToggleSwitch
        enabled={enabled}
        onChange={(v) => onUpdate(deviceId, 'aiAnalysisEnabled', v)}
        accent="blue"
        label="告警后 AI 多模态分析"
      />
      <span className="text-xs text-slate-500">
        {hint || '告警后 AI 多模态分析（结合监控画面与历史记录推送结论）'}
      </span>
    </div>
  )
}

function AlertStatusBadge({ enabled, variant = 'lost' }) {
  if (enabled) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
        variant === 'offline'
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-orange-50 text-orange-700 border-orange-200'
      }`}>
        已开启
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
      已关闭
    </span>
  )
}

function getStrategySummary(cfg, alertType) {
  if (alertType === 'lost') {
    if (!cfg.enabled) return '—'
    const parts = [`离巢 ${cfg.thresholdMinutes || 30} 分钟`]
    if (cfg.sendSnapshot !== false) parts.push('截图')
    if (cfg.aiAnalysisEnabled !== false) parts.push('AI 分析')
    return parts.join(' · ')
  }
  if (!cfg.offlineAlertEnabled) return '—'
  const parts = []
  if (cfg.offlineAlertImmediate !== false) parts.push('立即推送')
  if (cfg.offlineRepeatMinutes > 0) parts.push(`每 ${cfg.offlineRepeatMinutes} 分钟`)
  else parts.push('单次')
  if (cfg.aiAnalysisEnabled !== false) parts.push('AI 分析')
  return parts.join(' · ')
}

function DeviceAlertDetailPanel({ alertType, deviceId, cfg, onUpdate, onTriggerTest, triggering }) {
  if (alertType === 'lost') {
    return (
      <div className="px-4 py-4 space-y-3 bg-slate-50 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <input
            type="number" min="1" max="480"
            className="ui-input w-24 !py-1.5"
            value={cfg.thresholdMinutes || 30}
            onChange={(e) => onUpdate(deviceId, 'thresholdMinutes', parseInt(e.target.value, 10) || 30)}
          />
          <span className="text-xs text-slate-500">分钟后推送（无人机离巢超过阈值时）</span>
        </div>
        <div className="flex items-center gap-3">
          <ToggleSwitch
            enabled={cfg.sendSnapshot !== false}
            onChange={(v) => onUpdate(deviceId, 'sendSnapshot', v)}
            accent="blue"
            label="告警时发送监控截图"
          />
          <span className="text-xs text-slate-500">告警时发送监控截图（外部/内部/无人机画面）</span>
        </div>
        <AiAnalysisToggle deviceId={deviceId} cfg={cfg} onUpdate={onUpdate} />
        <div>
          <label className="text-xs font-medium text-slate-700">设备专属 Webhook（选填）</label>
          <input
            type="text"
            className="ui-input mt-1 !py-1.5"
            placeholder="留空则使用全局 Webhook"
            value={cfg.webhookUrl || ''}
            onChange={(e) => onUpdate(deviceId, 'webhookUrl', e.target.value)}
          />
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={() => onTriggerTest(deviceId)}
            disabled={triggering}
            className="ui-btn-secondary !text-xs disabled:opacity-50 cursor-pointer"
          >
            <FlaskConical size={13} />
            {triggering ? '发送中…' : '立即测试飞丢告警'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-3 bg-slate-50 border-t border-slate-100">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`imm-${deviceId}`}
          checked={cfg.offlineAlertImmediate !== false}
          onChange={(e) => onUpdate(deviceId, 'offlineAlertImmediate', e.target.checked)}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
        />
        <label htmlFor={`imm-${deviceId}`} className="text-xs text-slate-500">离线后立即推送一次</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number" min="0" max="480"
          className="ui-input w-24 !py-1.5"
          value={cfg.offlineRepeatMinutes || 0}
          onChange={(e) => onUpdate(deviceId, 'offlineRepeatMinutes', parseInt(e.target.value, 10) || 0)}
        />
        <span className="text-xs text-slate-500">分钟循环提醒（0 = 不循环）</span>
      </div>
      <AiAnalysisToggle
        deviceId={deviceId}
        cfg={cfg}
        onUpdate={onUpdate}
        hint="告警后 AI 分析网络/市电稳定性，并结合历史记录推送结论"
      />
      <div>
        <label className="text-xs font-medium text-slate-700">设备专属 Webhook（选填）</label>
        <input
          type="text"
          className="ui-input mt-1 !py-1.5"
          placeholder="留空则使用全局 Webhook"
          value={cfg.webhookUrl || ''}
          onChange={(e) => onUpdate(deviceId, 'webhookUrl', e.target.value)}
        />
      </div>
    </div>
  )
}

function DeviceGroupSidebar({
  collapsed, onToggleCollapse, selectedId, onSelect,
  allCount, regions, devices, deviceRegionMap, getDeviceName,
}) {
  const [expandedRegions, setExpandedRegions] = useState({})

  const toggleRegion = (id) => {
    setExpandedRegions((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 border-r border-slate-200 bg-slate-50/80 flex flex-col items-center py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200/60 cursor-pointer"
          aria-label="展开设备分组"
        >
          <PanelLeft size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="w-52 shrink-0 border-r border-slate-200 bg-slate-50/50 flex flex-col min-h-0">
      <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-slate-700">设备分组</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 cursor-pointer"
          aria-label="收起设备分组"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <button
          type="button"
          onClick={() => onSelect('all')}
          className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
            selectedId === 'all'
              ? 'bg-orange-50 text-orange-700 font-medium'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          全部设备
          <span className="text-slate-400 font-normal ml-1">({allCount})</span>
        </button>

        {regions.length > 0 ? regions.map((region) => {
          const regionDevices = devices.filter((id) => deviceRegionMap[id] === region.id)
          const open = expandedRegions[region.id] !== false
          return (
            <div key={region.id}>
              <button
                type="button"
                onClick={() => {
                  toggleRegion(region.id)
                  onSelect(`region:${region.id}`)
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center gap-1 transition-colors cursor-pointer ${
                  selectedId === `region:${region.id}`
                    ? 'bg-orange-50 text-orange-700 font-medium'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {open ? <ChevronDown size={14} className="shrink-0 text-slate-400" /> : <ChevronRight size={14} className="shrink-0 text-slate-400" />}
                <span className="truncate">{region.name}</span>
                <span className="text-slate-400 font-normal shrink-0">({regionDevices.length})</span>
              </button>
              {open && regionDevices.map((deviceId) => (
                <button
                  key={deviceId}
                  type="button"
                  onClick={() => onSelect(deviceId)}
                  className={`w-full text-left pl-7 pr-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate ${
                    selectedId === deviceId
                      ? 'bg-orange-50 text-orange-700 font-medium'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title={getDeviceName(deviceId)}
                >
                  {getDeviceName(deviceId)}
                </button>
              ))}
            </div>
          )
        }) : devices.map((deviceId) => (
          <button
            key={deviceId}
            type="button"
            onClick={() => onSelect(deviceId)}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate ${
              selectedId === deviceId
                ? 'bg-orange-50 text-orange-700 font-medium'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
            title={getDeviceName(deviceId)}
          >
            {getDeviceName(deviceId)}
          </button>
        ))}
      </nav>
    </aside>
  )
}

export default function AlertConfig({ devices, user, scopeRegionId }) {
  const [alertType, setAlertType] = useState('lost')
  const [globalWebhookUrl, setGlobalWebhookUrl] = useState('')
  const [regionWebhooks, setRegionWebhooks] = useState({})
  const [leafRegions, setLeafRegions] = useState([])
  const [deviceRegionMap, setDeviceRegionMap] = useState({})
  const [deviceConfigs, setDeviceConfigs] = useState({})
  const [saving, setSaving] = useState(false)
  const [testingRegion, setTestingRegion] = useState(null)
  const [triggeringLost, setTriggeringLost] = useState({})
  const [message, setMessage] = useState(null)
  const [deviceNameMap, setDeviceNameMap] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedNodeId, setSelectedNodeId] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [webhookEditing, setWebhookEditing] = useState(false)

  const isMultiRegion = leafRegions.length > 1

  useEffect(() => {
    apiFetch(withScopeQuery('/api/alert-config', scopeRegionId))
      .then((r) => r.json())
      .then((data) => {
        setGlobalWebhookUrl(data.globalWebhookUrl || '')
        setRegionWebhooks(data.regionWebhooks || {})
        setLeafRegions(data.leafRegions || [])
        setDeviceRegionMap(data.deviceRegionMap || {})
        setDeviceConfigs(data.deviceConfigs || {})
        setDeviceNameMap(data.deviceNameMap || {})
      })
      .catch(() => {})
  }, [scopeRegionId])

  const allDeviceIds = useMemo(() => devices.map((d) => d.deviceId), [devices])

  const getDeviceName = useCallback((deviceId) => {
    const live = devices.find((d) => d.deviceId === deviceId)
    if (live?.deviceName && live.deviceName !== deviceId) return live.deviceName
    if (deviceNameMap[deviceId]) return deviceNameMap[deviceId]
    return deviceId
  }, [devices, deviceNameMap])

  const resolveWebhookForDevice = useCallback((deviceId) => {
    const cfg = deviceConfigs[deviceId] || {}
    if (cfg.webhookUrl) return cfg.webhookUrl
    const rid = deviceRegionMap[deviceId]
      || devices.find((d) => d.deviceId === deviceId)?.regionId
    if (rid && regionWebhooks[rid]) return regionWebhooks[rid]
    return globalWebhookUrl
  }, [deviceConfigs, deviceRegionMap, devices, regionWebhooks, globalWebhookUrl])

  const isDeviceEnabled = useCallback((deviceId) => {
    const cfg = deviceConfigs[deviceId] || {}
    return alertType === 'lost' ? !!cfg.enabled : !!cfg.offlineAlertEnabled
  }, [deviceConfigs, alertType])

  const filteredDeviceIds = useMemo(() => {
    let ids = [...allDeviceIds]

    if (selectedNodeId !== 'all') {
      if (selectedNodeId.startsWith('region:')) {
        const rid = selectedNodeId.slice(7)
        ids = ids.filter((id) => deviceRegionMap[id] === rid)
      } else {
        ids = ids.filter((id) => id === selectedNodeId)
      }
    }

    const q = search.trim().toLowerCase()
    if (q) {
      ids = ids.filter((id) => {
        const name = getDeviceName(id).toLowerCase()
        return name.includes(q) || id.toLowerCase().includes(q)
      })
    }

    if (statusFilter === 'enabled') ids = ids.filter((id) => isDeviceEnabled(id))
    if (statusFilter === 'disabled') ids = ids.filter((id) => !isDeviceEnabled(id))

    return ids
  }, [allDeviceIds, selectedNodeId, deviceRegionMap, search, statusFilter, getDeviceName, isDeviceEnabled])

  useEffect(() => { setPage(1) }, [search, statusFilter, selectedNodeId, alertType, allDeviceIds.length])

  const pagedDeviceIds = useMemo(
    () => paginateSlice(filteredDeviceIds, page, pageSize),
    [filteredDeviceIds, page, pageSize],
  )

  const webhookConfigured = isMultiRegion
    ? leafRegions.some((r) => regionWebhooks[r.id])
    : !!globalWebhookUrl.trim()

  const showMsg = useCallback((text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const payload = isMultiRegion
        ? { regionWebhooks, deviceConfigs }
        : { globalWebhookUrl, deviceConfigs }
      await apiFetch(withScopeQuery('/api/alert-config', scopeRegionId), {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      showMsg('配置已保存')
      setWebhookEditing(false)
    } catch {
      showMsg('保存失败', 'error')
    }
    setSaving(false)
  }, [globalWebhookUrl, regionWebhooks, deviceConfigs, isMultiRegion, showMsg, scopeRegionId])

  const handleTriggerLost = useCallback(async (deviceId) => {
    const webhookUrl = resolveWebhookForDevice(deviceId)
    if (!webhookUrl) {
      showMsg('请先配置 Webhook（区域全局或设备专属）', 'error')
      return
    }
    setTriggeringLost((prev) => ({ ...prev, [deviceId]: true }))
    try {
      const res = await apiFetch('/api/alert-config/trigger-lost', {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        showMsg(data.error || '触发失败', 'error')
        return
      }
      showMsg(`飞丢告警测试已触发（pid ${data.pid || '—'}），请查看企业微信群与终端日志`)
    } catch {
      showMsg('触发失败', 'error')
    } finally {
      setTriggeringLost((prev) => ({ ...prev, [deviceId]: false }))
    }
  }, [resolveWebhookForDevice, showMsg])

  const handleTest = useCallback(async (regionId) => {
    const webhookUrl = isMultiRegion ? regionWebhooks[regionId] : globalWebhookUrl
    if (!webhookUrl) return showMsg('请先填写 Webhook URL', 'error')
    setTestingRegion(regionId || 'single')
    try {
      await apiFetch('/api/alert-config/test', {
        method: 'POST',
        body: JSON.stringify({ webhookUrl }),
      })
      showMsg('测试消息已发送，请查看企业微信群')
    } catch {
      showMsg('发送失败', 'error')
    }
    setTestingRegion(null)
  }, [globalWebhookUrl, regionWebhooks, isMultiRegion, showMsg])

  const updateDevice = useCallback((deviceId, key, value) => {
    setDeviceConfigs((prev) => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], [key]: value },
    }))
  }, [])

  const selectAll = useCallback((key, val) => {
    setDeviceConfigs((prev) => {
      const next = { ...prev }
      allDeviceIds.forEach((id) => { next[id] = { ...next[id], [key]: val } })
      return next
    })
  }, [allDeviceIds])

  const exportConfig = useCallback(() => {
    const payload = isMultiRegion
      ? { regionWebhooks, deviceConfigs }
      : { globalWebhookUrl, deviceConfigs }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `告警配置_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [globalWebhookUrl, regionWebhooks, deviceConfigs, isMultiRegion])

  const enabledKey = alertType === 'lost' ? 'enabled' : 'offlineAlertEnabled'

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div>
        <h1 className="text-lg font-semibold text-slate-800 tracking-tight">告警配置</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          管理飞丢与机场离线告警规则，配置企业微信推送与 AI 分析策略
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm font-medium ${
          message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* 全局 Webhook */}
      {isMultiRegion ? (
        <div className="space-y-3">
          {leafRegions.map((region) => (
            <div key={region.id} className="ui-card p-4">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                    <Settings size={16} className="text-blue-600" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{region.name} · 告警推送方式</p>
                    <p className="text-xs text-slate-500 mt-0.5">仅该区域设备未单独配置时使用此地址</p>
                    {(webhookEditing || !regionWebhooks[region.id]) ? (
                      <input
                        type="text"
                        className="ui-input mt-2 !py-1.5 text-sm"
                        placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                        value={regionWebhooks[region.id] || ''}
                        onChange={(e) => setRegionWebhooks((prev) => ({ ...prev, [region.id]: e.target.value }))}
                      />
                    ) : (
                      <p className="text-xs text-slate-600 mt-2 truncate font-mono">{regionWebhooks[region.id]}</p>
                    )}
                    <p className="text-xs mt-1.5 flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${regionWebhooks[region.id] ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={regionWebhooks[region.id] ? 'text-emerald-700' : 'text-slate-400'}>
                        {regionWebhooks[region.id] ? '连接正常' : '未配置'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" onClick={() => handleTest(region.id)} disabled={testingRegion === region.id}
                    className="ui-btn-secondary !text-xs cursor-pointer disabled:opacity-50">
                    <Send size={13} />
                    {testingRegion === region.id ? '发送中…' : '测试'}
                  </button>
                  <button type="button" onClick={() => setWebhookEditing((v) => !v)}
                    className="ui-btn-ghost !text-xs cursor-pointer">
                    {webhookEditing ? '收起' : '修改配置'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ui-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                <Settings size={16} className="text-blue-600" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">
                  {leafRegions[0]?.name || user?.regionName || '当前区域'} · 告警推送方式
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  本区域设备未单独配置时使用此地址。AI 分析需在服务端配置 ARK_API_KEY。
                </p>
                {(webhookEditing || !globalWebhookUrl) ? (
                  <input
                    type="text"
                    className="ui-input mt-2 !py-1.5 text-sm"
                    placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                    value={globalWebhookUrl}
                    onChange={(e) => setGlobalWebhookUrl(e.target.value)}
                  />
                ) : (
                  <p className="text-xs text-slate-600 mt-2 truncate font-mono">{globalWebhookUrl}</p>
                )}
                <p className="text-xs mt-1.5 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${webhookConfigured ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className={webhookConfigured ? 'text-emerald-700' : 'text-slate-400'}>
                    {webhookConfigured ? '连接正常' : '未配置'}
                  </span>
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => handleTest(null)} disabled={testingRegion === 'single'}
                className="ui-btn-secondary !text-xs cursor-pointer disabled:opacity-50">
                <Send size={13} />
                {testingRegion === 'single' ? '发送中…' : '测试'}
              </button>
              <button type="button" onClick={() => setWebhookEditing((v) => !v)}
                className="ui-btn-ghost !text-xs cursor-pointer">
                {webhookEditing ? '收起' : '修改配置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 筛选与批量操作 */}
      <div className="ui-card px-4 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="relative min-w-[200px] flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索设备名称 / 编号"
                className="ui-input !pl-9 !py-2 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ui-input !w-auto !py-2 !pr-8 min-w-[108px] cursor-pointer text-sm"
            >
              <option value="all">全部状态</option>
              <option value="enabled">已开启</option>
              <option value="disabled">已关闭</option>
            </select>
            <select
              value={alertType}
              onChange={(e) => setAlertType(e.target.value)}
              className="ui-input !w-auto !py-2 !pr-8 min-w-[120px] cursor-pointer text-sm"
            >
              <option value="lost">飞丢告警</option>
              <option value="offline">机场离线告警</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button type="button" onClick={() => selectAll('aiAnalysisEnabled', true)}
              className="ui-btn-secondary !text-xs cursor-pointer">AI 全开</button>
            <button type="button" onClick={() => selectAll('aiAnalysisEnabled', false)}
              className="ui-btn-secondary !text-xs cursor-pointer">AI 全关</button>
            <button type="button" onClick={() => selectAll(enabledKey, true)}
              className="ui-btn-secondary !text-xs cursor-pointer">全选</button>
            <button type="button" onClick={() => selectAll(enabledKey, false)}
              className="ui-btn-secondary !text-xs cursor-pointer">全不选</button>
            <button type="button" onClick={exportConfig}
              className="ui-btn-secondary !text-xs cursor-pointer">
              <Download size={13} />
              导出配置
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="ui-btn-primary !text-xs !py-2 cursor-pointer disabled:opacity-50">
              <Save size={14} />
              {saving ? '保存中…' : '保存配置'}
            </button>
          </div>
        </div>
      </div>

      {/* 主列表：左侧分组 + 右侧表格 */}
      <div className="ui-card overflow-hidden flex flex-col min-h-[520px]">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0">
          {alertType === 'lost' ? (
            <Bell size={15} className="text-orange-500" />
          ) : (
            <WifiOff size={15} className="text-red-500" />
          )}
          <h2 className="text-sm font-semibold text-slate-800">
            告警规则列表
            <span className="text-slate-400 font-normal ml-1">({filteredDeviceIds.length})</span>
          </h2>
          <p className="text-xs text-slate-400 hidden sm:block ml-2">
            {alertType === 'lost'
              ? '无人机离巢超过设定时间未返回时推送'
              : '机场超过 2 分钟无数据时判定离线并推送'}
          </p>
        </div>

        <div className="flex flex-1 min-h-0">
          <DeviceGroupSidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            selectedId={selectedNodeId}
            onSelect={setSelectedNodeId}
            allCount={allDeviceIds.length}
            regions={leafRegions}
            devices={allDeviceIds}
            deviceRegionMap={deviceRegionMap}
            getDeviceName={getDeviceName}
          />

          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            <div className="flex-1 overflow-auto">
              {filteredDeviceIds.length === 0 ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  {allDeviceIds.length === 0 ? '暂无设备，等待 MQTT 数据…' : '没有匹配的设备'}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-[1]">
                    <tr className="text-xs text-slate-400 border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left font-medium w-14">开关</th>
                      <th className="px-3 py-2.5 text-left font-medium">设备名称</th>
                      <th className="px-3 py-2.5 text-left font-medium hidden md:table-cell">设备编号</th>
                      <th className="px-3 py-2.5 text-left font-medium w-20">状态</th>
                      <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell">告警策略</th>
                      <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell w-28">推送方式</th>
                      <th className="px-4 py-2.5 text-right font-medium w-36">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {pagedDeviceIds.map((deviceId) => {
                      const cfg = deviceConfigs[deviceId] || {}
                      const enabled = isDeviceEnabled(deviceId)
                      const isExpanded = expandedId === deviceId
                      const isHighlighted = selectedNodeId === deviceId
                      const pushLabel = cfg.webhookUrl ? '设备 Webhook' : '企业微信'

                      return (
                        <Fragment key={deviceId}>
                          <tr
                            className={`transition-colors ${
                              isHighlighted ? 'bg-orange-50/70' : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="px-4 py-2.5">
                              <ToggleSwitch
                                enabled={enabled}
                                onChange={(v) => updateDevice(deviceId, enabledKey, v)}
                                accent={alertType === 'offline' ? 'red' : 'orange'}
                                label={`${getDeviceName(deviceId)} 告警开关`}
                              />
                            </td>
                            <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[160px] truncate" title={getDeviceName(deviceId)}>
                              {getDeviceName(deviceId)}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 text-xs font-mono hidden md:table-cell max-w-[140px] truncate" title={deviceId}>
                              {deviceId}
                            </td>
                            <td className="px-3 py-2.5">
                              <AlertStatusBadge enabled={enabled} variant={alertType} />
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 text-xs hidden lg:table-cell max-w-[200px] truncate" title={getStrategySummary(cfg, alertType)}>
                              {getStrategySummary(cfg, alertType)}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 text-xs hidden sm:table-cell">{pushLabel}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(isExpanded ? null : deviceId)}
                                  className="text-xs text-blue-600 hover:text-blue-800 px-1.5 py-0.5 rounded cursor-pointer transition-colors inline-flex items-center gap-0.5"
                                >
                                  <Pencil size={12} />
                                  编辑
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/50">
                              <td colSpan={7} className="p-0">
                                <DeviceAlertDetailPanel
                                  alertType={alertType}
                                  deviceId={deviceId}
                                  cfg={cfg}
                                  onUpdate={updateDevice}
                                  onTriggerTest={handleTriggerLost}
                                  triggering={!!triggeringLost[deviceId]}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <ListPagination
              total={filteredDeviceIds.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              className="px-4 py-3 border-t border-slate-100 shrink-0"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
