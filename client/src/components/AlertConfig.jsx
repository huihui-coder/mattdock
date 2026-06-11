import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import {
  Bell, Save, Send, Settings, WifiOff, Search, Download, ChevronRight,
  ChevronDown, PanelLeftClose, PanelLeft, Pencil, FlaskConical, Webhook,
} from 'lucide-react'
import ListPagination, { paginateSlice } from './ListPagination'
import WebhookProfilesPanel from './WebhookProfilesPanel'
import { TYPE_LABELS, WebhookTypeIcon } from './WebhookTypeIcon'
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

function DeviceAlertDetailPanel({ alertType, deviceId, cfg, onUpdate, onTriggerTest, triggering, webhookProfiles }) {
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
          <label className="text-xs font-medium text-slate-700">推送 Webhook（选填）</label>
          <select
            className="ui-input mt-1 !py-1.5 cursor-pointer"
            value={cfg.webhookProfileId || ''}
            onChange={(e) => onUpdate(deviceId, 'webhookProfileId', e.target.value || undefined)}
          >
            <option value="">继承组织默认</option>
            {webhookProfiles.filter((p) => p.enabled !== false).map((p) => (
              <option key={p.id} value={p.id}>{p.name}（{TYPE_LABELS[p.type] || p.type}）</option>
            ))}
          </select>
            <input
              type="text"
            className="ui-input mt-2 !py-1.5"
            placeholder="或填写设备专属 URL（优先级高于上方选择）"
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
        <label className="text-xs font-medium text-slate-700">推送 Webhook（选填）</label>
        <select
          className="ui-input mt-1 !py-1.5 cursor-pointer"
          value={cfg.webhookProfileId || ''}
          onChange={(e) => onUpdate(deviceId, 'webhookProfileId', e.target.value || undefined)}
        >
          <option value="">继承组织默认</option>
            {webhookProfiles.filter((p) => p.enabled !== false).map((p) => (
            <option key={p.id} value={p.id}>{p.name}（{TYPE_LABELS[p.type] || p.type}）</option>
          ))}
        </select>
            <input
              type="text"
          className="ui-input mt-2 !py-1.5"
          placeholder="或填写设备专属 URL（优先级高于上方选择）"
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
  const [globalWebhookProfileId, setGlobalWebhookProfileId] = useState('')
  const [regionWebhooks, setRegionWebhooks] = useState({})
  const [regionWebhookProfileIds, setRegionWebhookProfileIds] = useState({})
  const [webhookProfiles, setWebhookProfiles] = useState([])
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
  const [profilesVersion, setProfilesVersion] = useState(0)
  const [configTab, setConfigTab] = useState('rules')

  const isMultiRegion = leafRegions.length > 1

  const loadWebhookProfiles = useCallback(() => {
    apiFetch('/api/webhook-profiles')
      .then((r) => r.json())
      .then((data) => setWebhookProfiles(data.profiles || []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadWebhookProfiles() }, [loadWebhookProfiles, profilesVersion])

  useEffect(() => {
    apiFetch(withScopeQuery('/api/alert-config', scopeRegionId))
      .then((r) => r.json())
      .then((data) => {
        setGlobalWebhookUrl(data.globalWebhookUrl || '')
        setGlobalWebhookProfileId(data.globalWebhookProfileId || '')
        setRegionWebhooks(data.regionWebhooks || {})
        setRegionWebhookProfileIds(data.regionWebhookProfileIds || {})
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

  const profileById = useMemo(() => {
    const map = {}
    webhookProfiles.forEach((p) => { map[p.id] = p })
    return map
  }, [webhookProfiles])

  const resolveWebhookForDevice = useCallback((deviceId) => {
    const cfg = deviceConfigs[deviceId] || {}
    if (cfg.webhookUrl) return cfg.webhookUrl
    if (cfg.webhookProfileId && profileById[cfg.webhookProfileId]?.url) {
      return profileById[cfg.webhookProfileId].url
    }
    const rid = deviceRegionMap[deviceId]
      || devices.find((d) => d.deviceId === deviceId)?.regionId
    const regionProfileId = rid ? regionWebhookProfileIds[rid] : globalWebhookProfileId
    if (regionProfileId && profileById[regionProfileId]?.url) {
      return profileById[regionProfileId].url
    }
    if (rid && regionWebhooks[rid]) return regionWebhooks[rid]
    return globalWebhookUrl
  }, [deviceConfigs, deviceRegionMap, devices, regionWebhooks, globalWebhookUrl, regionWebhookProfileIds, globalWebhookProfileId, profileById])

  const getPushProfile = useCallback((deviceId) => {
    const cfg = deviceConfigs[deviceId] || {}
    if (cfg.webhookUrl) return { type: 'custom', name: '设备 URL' }
    if (cfg.webhookProfileId && profileById[cfg.webhookProfileId]) {
      return profileById[cfg.webhookProfileId]
    }
    const rid = deviceRegionMap[deviceId]
    const regionProfileId = rid ? regionWebhookProfileIds[rid] : globalWebhookProfileId
    if (regionProfileId && profileById[regionProfileId]) {
      return profileById[regionProfileId]
    }
    return { type: null, name: '组织默认' }
  }, [deviceConfigs, deviceRegionMap, profileById, regionWebhookProfileIds, globalWebhookProfileId])

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


  const enabledProfiles = useMemo(
    () => webhookProfiles.filter((p) => p.enabled !== false),
    [webhookProfiles],
  )

  const showMsg = useCallback((text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const payload = isMultiRegion
        ? { regionWebhookProfileIds, regionWebhooks, deviceConfigs }
        : { globalWebhookProfileId, globalWebhookUrl, deviceConfigs }
      await apiFetch(withScopeQuery('/api/alert-config', scopeRegionId), {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      showMsg('配置已保存')
    } catch {
      showMsg('保存失败', 'error')
    }
    setSaving(false)
  }, [globalWebhookUrl, globalWebhookProfileId, regionWebhooks, regionWebhookProfileIds, deviceConfigs, isMultiRegion, showMsg, scopeRegionId])

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
    const profileId = isMultiRegion ? regionWebhookProfileIds[regionId] : globalWebhookProfileId
    if (profileId) {
      setTestingRegion(regionId || 'single')
      try {
        const res = await apiFetch(`/api/webhook-profiles/${encodeURIComponent(profileId)}/test`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        showMsg('测试消息已发送，请查看对应群聊')
        setProfilesVersion((v) => v + 1)
      } catch (err) {
        showMsg(err.message || '发送失败', 'error')
      }
      setTestingRegion(null)
      return
    }
    const webhookUrl = isMultiRegion ? regionWebhooks[regionId] : globalWebhookUrl
    if (!webhookUrl) return showMsg('请先选择 Webhook 或填写推送地址', 'error')
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
  }, [globalWebhookUrl, globalWebhookProfileId, regionWebhooks, regionWebhookProfileIds, isMultiRegion, showMsg])

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
      ? { regionWebhookProfileIds, regionWebhooks, deviceConfigs }
      : { globalWebhookProfileId, globalWebhookUrl, deviceConfigs }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `告警配置_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [globalWebhookUrl, globalWebhookProfileId, regionWebhooks, regionWebhookProfileIds, deviceConfigs, isMultiRegion])

  const enabledKey = alertType === 'lost' ? 'enabled' : 'offlineAlertEnabled'

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div>
        <h1 className="text-lg font-semibold text-slate-800 tracking-tight">告警配置</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {configTab === 'webhook'
            ? '集中管理 Webhook 连接池，并为各组织绑定告警推送方式'
            : '管理飞丢与机场离线告警规则，配置 AI 分析策略'}
        </p>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm font-medium ${
          message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="ui-card px-3 py-2.5">
        <div className="ui-nav-bar w-full sm:w-auto overflow-x-auto" role="tablist" aria-label="告警配置模块">
          <button
            type="button"
            role="tab"
            aria-selected={configTab === 'rules'}
            onClick={() => setConfigTab('rules')}
            className={`ui-tab whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 ${
              configTab === 'rules' ? 'ui-tab-active' : 'ui-tab-inactive'
            }`}
          >
            <Bell size={14} aria-hidden />
            告警规则
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={configTab === 'webhook'}
            onClick={() => setConfigTab('webhook')}
            className={`ui-tab whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 ${
              configTab === 'webhook' ? 'ui-tab-active' : 'ui-tab-inactive'
            }`}
          >
            <Webhook size={14} aria-hidden />
            Webhook 配置
          </button>
        </div>
      </div>

      {configTab === 'webhook' && (
        <>
          <WebhookProfilesPanel onChanged={() => setProfilesVersion((v) => v + 1)} />

          {/* 告警推送方式绑定 */}
          <section className="ui-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Settings size={16} className="text-blue-600" aria-hidden />
                  <h2 className="text-sm font-semibold text-slate-800">告警推送方式</h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  为各组织选择 Webhook 配置；设备未单独指定时将继承此处设置。仍可直接填写 URL 作为兼容备用。
                </p>
              </div>
          <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="ui-btn-primary !text-xs !py-2 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? '保存中…' : '保存推送配置'}
          </button>
        </div>
            <div className="p-4 space-y-3">
          {(isMultiRegion ? leafRegions : (leafRegions.length ? leafRegions : [{ id: 'default', name: user?.regionName || '当前区域' }])).map((region) => {
            const rid = region.id
            const profileId = isMultiRegion ? (regionWebhookProfileIds[rid] || '') : globalWebhookProfileId
            const legacyUrl = isMultiRegion ? (regionWebhooks[rid] || '') : globalWebhookUrl
            const selectedProfile = profileId ? profileById[profileId] : null
            const configured = !!(profileId || legacyUrl.trim())
            const setProfileId = (value) => {
              if (isMultiRegion) {
                setRegionWebhookProfileIds((prev) => ({ ...prev, [rid]: value }))
              } else {
                setGlobalWebhookProfileId(value)
              }
            }
            const setLegacyUrl = (value) => {
              if (isMultiRegion) {
                setRegionWebhooks((prev) => ({ ...prev, [rid]: value }))
              } else {
                setGlobalWebhookUrl(value)
              }
            }
            return (
              <div key={rid} className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
                <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-sm font-medium text-slate-800">{region.name}</p>
                    <label className="block">
                      <span className="text-xs text-slate-500">关联 Webhook</span>
                      <select
                        value={profileId}
                        onChange={(e) => setProfileId(e.target.value)}
                        className="ui-input mt-1 !py-1.5 text-sm cursor-pointer"
                      >
                        <option value="">未选择</option>
                        {enabledProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}（{TYPE_LABELS[p.type] || p.type}）</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-500">备用 URL（可选，兼容旧配置）</span>
                      <input
                        type="text"
                        className="ui-input mt-1 !py-1.5 text-sm font-mono"
                        placeholder="未选 Webhook 时可直接填写 URL"
                        value={legacyUrl}
                        onChange={(e) => setLegacyUrl(e.target.value)}
                      />
                    </label>
                    {selectedProfile && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <WebhookTypeIcon type={selectedProfile.type} size={16} />
                        <span>{selectedProfile.name}</span>
                      </div>
                    )}
                    <p className="text-xs flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${configured ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className={configured ? 'text-emerald-700' : 'text-slate-400'}>
                        {selectedProfile
                          ? `已绑定：${selectedProfile.name}`
                          : legacyUrl.trim()
                            ? '使用备用 URL'
                            : '未配置推送'}
                      </span>
                    </p>
                  </div>
          <div className="flex gap-2 shrink-0">
            <button
                      type="button"
                      onClick={() => handleTest(isMultiRegion ? rid : null)}
                      disabled={testingRegion === (isMultiRegion ? rid : 'single') || !configured}
                      className="ui-btn-secondary !text-xs cursor-pointer disabled:opacity-50"
                    >
                      <Send size={13} />
                      {testingRegion === (isMultiRegion ? rid : 'single') ? '发送中…' : '测试'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
            </div>
          </section>
        </>
      )}

      {configTab === 'rules' && (
        <>
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
                      const pushProfile = getPushProfile(deviceId)
                      const pushLabel = pushProfile.name

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
                            <td className="px-3 py-2.5 text-slate-600 text-xs hidden sm:table-cell">
                              <span className="inline-flex items-center gap-1.5 max-w-[120px]">
                                {pushProfile.type && pushProfile.type !== 'custom' && (
                                  <WebhookTypeIcon type={pushProfile.type} size={14} />
                                )}
                                <span className="truncate" title={pushLabel}>{pushLabel}</span>
                              </span>
                            </td>
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
                                  webhookProfiles={webhookProfiles}
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
        </>
      )}
    </div>
  )
}
