import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MapPin,
  Network,
  Plus,
  Radio,
  Save,
  Snowflake,
  Users,
} from 'lucide-react'
import { clearStreamUrlCache } from '../lib/stream-url'

const PERMISSION_LABELS = {
  monitor: '实时监控',
  'alert-config': '离巢告警',
  'flight-records': '飞行记录',
  'device-config': '设备管理',
  'image-studio': 'AI 生图',
  'ai-assistant': '飞行助手',
  'audit-log': '操作日志',
}

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() } })
}

function findTreeNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node
    const found = findTreeNode(node.children, id)
    if (found) return found
  }
  return null
}

function collectAllIds(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node.id)
    collectAllIds(node.children, out)
  }
  return out
}

function RegionFolderItem({
  node,
  depth,
  selectedId,
  expandedIds,
  onToggleExpand,
  onSelect,
}) {
  const hasChildren = node.children?.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = node.id === selectedId

  return (
    <div>
      <div
        className={`flex w-full items-center gap-0.5 rounded-lg text-sm transition-colors duration-200 ${
          isSelected ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20' : 'text-dji-ink hover:bg-slate-50'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className={`flex h-8 w-7 shrink-0 items-center justify-center rounded-md cursor-pointer transition-colors ${
              isSelected ? 'hover:bg-blue-500/80' : 'hover:bg-slate-200/80'
            }`}
            aria-label={isExpanded ? '收起' : '展开'}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left cursor-pointer"
        >
          {isExpanded && hasChildren ? (
            <FolderOpen size={15} className={`shrink-0 ${isSelected ? 'text-blue-100' : 'text-blue-500'}`} aria-hidden />
          ) : (
            <Folder size={15} className={`shrink-0 ${isSelected ? 'text-blue-100' : 'text-slate-400'}`} aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
          <span className={`shrink-0 tabular-nums text-[11px] ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
            {node.userCount ?? 0}
          </span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <RegionFolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StatChip({ label, value }) {
  return (
    <div className="rounded-lg border border-dji-border bg-slate-50/80 px-3 py-2 min-w-[72px]">
      <p className="text-[11px] text-dji-muted">{label}</p>
      <p className="text-base font-semibold tabular-nums text-dji-black leading-tight mt-0.5">{value}</p>
    </div>
  )
}

function RegionDetailHeader({ node, onAddChild, onFreeze, freezingId }) {
  return (
    <div className="rounded-xl border border-dji-border bg-white p-4 shadow-dji-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 border border-dji-border">
            <Building2 size={22} className="text-slate-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-dji-black truncate">{node.name}</h3>
              {node.frozen && (
                <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  已固化
                </span>
              )}
            </div>
            <p className="font-mono text-xs text-dji-subtle mt-0.5">{node.id}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onAddChild(node)}
            className="ui-btn-secondary cursor-pointer"
          >
            <Plus size={14} aria-hidden />
            添加下级
          </button>
          <button
            type="button"
            onClick={() => onFreeze(node)}
            disabled={freezingId === node.id}
            className="ui-btn-secondary cursor-pointer disabled:opacity-50"
          >
            <Snowflake size={14} className={freezingId === node.id ? 'animate-spin' : ''} aria-hidden />
            {freezingId === node.id ? '固化中…' : '固化配置'}
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <StatChip label="绑定账号" value={node.userCount ?? 0} />
        <StatChip label="设备映射" value={node.mappingCount ?? 0} />
        <StatChip label="在线设备" value={node.deviceCount ?? 0} />
        <StatChip label="下级区域" value={node.children?.length ?? 0} />
      </div>
    </div>
  )
}

function RegionChildrenSection({ node, onSelect, onAddChild, onFreeze, freezingId }) {
  const children = node.children || []

  if (!children.length) {
    return (
      <section className="rounded-xl border border-dji-border bg-white shadow-dji-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-dji-border bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Network size={16} className="text-dji-black" aria-hidden />
            <h3 className="ui-section-title text-sm">下级区域</h3>
          </div>
          <button type="button" onClick={() => onAddChild(node)} className="ui-btn-secondary !text-xs cursor-pointer">
            <Plus size={13} aria-hidden />
            添加
          </button>
        </div>
        <p className="text-sm text-dji-subtle px-4 py-8 text-center">该区域暂无下级，可作为叶子节点独立管理数据。</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-dji-border bg-white shadow-dji-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-dji-border bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-dji-black" aria-hidden />
          <h3 className="ui-section-title text-sm">下级区域</h3>
          <span className="text-xs text-dji-subtle tabular-nums">{children.length} 个</span>
        </div>
        <button type="button" onClick={() => onAddChild(node)} className="ui-btn-secondary !text-xs cursor-pointer">
          <Plus size={13} aria-hidden />
          添加
        </button>
      </div>
      <div className="divide-y divide-dji-border/60">
        {children.map((child) => (
          <div
            key={child.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/80 transition-colors duration-200"
          >
            <button
              type="button"
              onClick={() => onSelect(child.id)}
              className="flex min-w-0 flex-1 items-start gap-3 text-left cursor-pointer group"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 border border-dji-border group-hover:border-blue-200 transition-colors">
                <Building2 size={16} className="text-slate-600" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm text-dji-black truncate">{child.name}</p>
                <p className="font-mono text-[11px] text-dji-subtle mt-0.5">{child.id}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-dji-muted">
                  <span><span className="tabular-nums text-dji-ink">{child.userCount ?? 0}</span> 账号</span>
                  <span><span className="tabular-nums text-dji-ink">{child.mappingCount ?? 0}</span> 映射</span>
                  <span><span className="tabular-nums text-dji-ink">{child.deviceCount ?? 0}</span> 设备</span>
                </div>
              </div>
            </button>
            <div className="flex items-center gap-2 shrink-0 pl-12 sm:pl-0">
              {child.frozen && (
                <span className="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700">
                  已固化
                </span>
              )}
              <button
                type="button"
                onClick={() => onFreeze(child)}
                disabled={freezingId === child.id}
                className="ui-btn-secondary !text-xs cursor-pointer disabled:opacity-50"
              >
                <Snowflake size={12} className={freezingId === child.id ? 'animate-spin' : ''} aria-hidden />
                固化
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RegionConnectivityForm({ regionId, regionName, defaultRegionId, onSaved }) {
  const [connForm, setConnForm] = useState({
    mqttBroker: '',
    mqttUser: '',
    mqttPass: '',
    mqttClientId: '',
    mqttTopics: '',
    streamBase: '',
    streamToken: '',
  })
  const [connMeta, setConnMeta] = useState({ usesEnvDefaults: false, passwordSet: false, tokenSet: false })
  const [connLoading, setConnLoading] = useState(false)
  const [connSaving, setConnSaving] = useState(false)
  const [connError, setConnError] = useState('')
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!regionId) return undefined
    let cancelled = false
    setConnLoading(true)
    setConnError('')
    apiFetch(`/api/regions/${encodeURIComponent(regionId)}/connectivity`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载连接配置失败')
        if (cancelled) return
        setConnMeta({
          usesEnvDefaults: !!data.usesEnvDefaults,
          passwordSet: !!data.mqtt?.passwordSet,
          tokenSet: !!data.stream?.tokenSet,
        })
        setConnForm({
          mqttBroker: data.mqtt?.brokerUrl || '',
          mqttUser: data.mqtt?.username || '',
          mqttPass: '',
          mqttClientId: data.mqtt?.clientId || '',
          mqttTopics: data.mqtt?.topics || '',
          streamBase: data.stream?.baseUrl || '',
          streamToken: '',
        })
      })
      .catch((err) => { if (!cancelled) setConnError(err.message) })
      .finally(() => { if (!cancelled) setConnLoading(false) })
    return () => { cancelled = true }
  }, [regionId])

  const saveConnectivity = async (e) => {
    e.preventDefault()
    setConnSaving(true)
    setConnError('')
    try {
      const body = {
        mqtt: {
          brokerUrl: connForm.mqttBroker,
          username: connForm.mqttUser,
          clientId: connForm.mqttClientId,
          topics: connForm.mqttTopics,
        },
        stream: {
          baseUrl: connForm.streamBase,
        },
      }
      if (connForm.mqttPass.trim()) body.mqtt.password = connForm.mqttPass.trim()
      if (connForm.streamToken.trim()) body.stream.token = connForm.streamToken.trim()
      const res = await apiFetch(`/api/regions/${encodeURIComponent(regionId)}/connectivity`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      clearStreamUrlCache()
      setConnMeta({
        usesEnvDefaults: false,
        passwordSet: data.connectivity?.mqtt?.passwordSet ?? true,
        tokenSet: data.connectivity?.stream?.tokenSet ?? !!connForm.streamToken.trim(),
      })
      setConnForm((prev) => ({ ...prev, mqttPass: '', streamToken: '' }))
      onSaved?.()
    } catch (err) {
      setConnError(err.message)
    }
    setConnSaving(false)
  }

  const isDefaultEnv = regionId === defaultRegionId && connMeta.usesEnvDefaults

  return (
    <section className="rounded-xl border border-dji-border bg-white shadow-dji-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 border-b border-dji-border bg-slate-50/50 text-left cursor-pointer hover:bg-slate-50 transition-colors duration-200"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Radio size={16} className="text-dji-black shrink-0" aria-hidden />
          <h3 className="ui-section-title text-sm">数据连接</h3>
          <span className="text-xs text-dji-subtle truncate hidden sm:inline">MQTT · 推流</span>
        </div>
        <ChevronDown
          size={16}
          className={`text-dji-subtle shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="p-4">
          <p className="text-xs text-dji-subtle mb-4 leading-relaxed">
            叶子区域需单独配置 MQTT 与推流；上级区域仅作组织汇总，通常无需连接。
            推流示例：<span className="font-mono text-[11px] text-dji-muted">…/live/设备SN_out.live.flv?token=…</span>
          </p>
          {isDefaultEnv && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
              当前使用全局 .env。Client ID 须与 <span className="font-mono">MQTT_CLIENT_ID</span> 一致，保存后写入本区域独立文件。
            </p>
          )}
          {connError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{connError}</p>
          )}
          {connLoading ? (
            <p className="text-sm text-dji-subtle py-4 text-center">加载连接配置…</p>
          ) : (
            <form onSubmit={saveConnectivity} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs text-dji-muted mb-1">MQTT 地址</label>
                <input
                  value={connForm.mqttBroker}
                  onChange={(e) => setConnForm({ ...connForm, mqttBroker: e.target.value })}
                  placeholder="tcp://smartcity.zhifei.tech:1883"
                  className="ui-input w-full font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dji-muted mb-1">MQTT 账号</label>
                <input
                  value={connForm.mqttUser}
                  onChange={(e) => setConnForm({ ...connForm, mqttUser: e.target.value })}
                  className="ui-input w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-dji-muted mb-1">
                  MQTT 密码{connMeta.passwordSet && !connForm.mqttPass ? '（已设置，留空不修改）' : ''}
                </label>
                <input
                  type="password"
                  value={connForm.mqttPass}
                  onChange={(e) => setConnForm({ ...connForm, mqttPass: e.target.value })}
                  className="ui-input w-full"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-xs text-dji-muted mb-1">Client ID</label>
                <input
                  value={connForm.mqttClientId}
                  onChange={(e) => setConnForm({ ...connForm, mqttClientId: e.target.value })}
                  placeholder={`monitor-${regionId}`}
                  className="ui-input w-full font-mono text-sm"
                />
                <p className="text-[11px] text-dji-subtle mt-1">须与平台登记一致（如 666）。</p>
              </div>
              <div>
                <label className="block text-xs text-dji-muted mb-1">订阅主题</label>
                <input
                  value={connForm.mqttTopics}
                  onChange={(e) => setConnForm({ ...connForm, mqttTopics: e.target.value })}
                  placeholder="thing/product/+/osd,..."
                  className="ui-input w-full font-mono text-sm"
                />
              </div>
              <div className="md:col-span-2 border-t border-dji-border pt-3 mt-1">
                <label className="block text-xs text-dji-muted mb-1">推流基址</label>
                <input
                  value={connForm.streamBase}
                  onChange={(e) => setConnForm({ ...connForm, streamBase: e.target.value })}
                  placeholder="https://live.zhifei.tech:24143/live"
                  className="ui-input w-full font-mono text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-dji-muted mb-1">
                  推流 Token{connMeta.tokenSet && !connForm.streamToken ? '（已设置，留空不修改）' : ''}
                </label>
                <input
                  value={connForm.streamToken}
                  onChange={(e) => setConnForm({ ...connForm, streamToken: e.target.value })}
                  placeholder="HYw7R8A8KQRGD7kURsBqKZx0PMZIZKAO"
                  className="ui-input w-full font-mono text-sm"
                />
              </div>
              <div className="md:col-span-2 flex justify-end pt-1">
                <button type="submit" disabled={connSaving} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
                  <Save size={14} aria-hidden />
                  {connSaving ? '保存并重连…' : '保存连接配置'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}

function RegionAccountList({ users, regionName }) {
  if (!users.length) {
    return (
      <p className="text-sm text-dji-subtle py-8 text-center">
        「{regionName}」暂无绑定账号，可在账号管理中创建并指定区域。
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-dji-border text-dji-muted">
            <th className="text-left py-2.5 px-4 font-medium">用户名</th>
            <th className="text-left py-2.5 font-medium">状态</th>
            <th className="text-left py-2.5 font-medium">角色</th>
            <th className="text-left py-2.5 font-medium">权限</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username} className="border-b border-dji-border/50 hover:bg-slate-50/80 transition-colors duration-200 last:border-0">
              <td className="py-2.5 px-4">
                <div className="flex items-center gap-2">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" className="w-7 h-7 rounded-full object-cover border border-dji-border" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-slate-100 border border-dji-border flex items-center justify-center text-xs text-dji-muted">
                      {u.username.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="font-medium text-dji-black">{u.username}</span>
                </div>
              </td>
              <td className="py-2.5">
                {u.online ? (
                  <span className="inline-flex items-center gap-1.5 text-dji-ink">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    在线
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-dji-subtle">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    离线
                  </span>
                )}
              </td>
              <td className="py-2.5 text-dji-muted">{u.role === 'admin' ? '管理员' : '普通账号'}</td>
              <td className="py-2.5 text-dji-muted max-w-[220px] truncate" title={
                u.role === 'admin'
                  ? '全部权限'
                  : (u.permissions || []).map((p) => PERMISSION_LABELS[p] || p).join('、') || '无'
              }>
                {u.role === 'admin'
                  ? '全部权限'
                  : (u.permissions || []).map((p) => PERMISSION_LABELS[p] || p).join('、') || '无'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function RegionSettings() {
  const [tree, setTree] = useState([])
  const [regions, setRegions] = useState([])
  const [users, setUsers] = useState([])
  const [defaultRegionId, setDefaultRegionId] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [form, setForm] = useState({ id: '', name: '', parentId: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [freezingId, setFreezingId] = useState('')
  const [showForm, setShowForm] = useState(false)

  const loadRegions = useCallback(async () => {
    const [regionsRes, usersRes] = await Promise.all([
      apiFetch('/api/regions'),
      apiFetch('/api/users'),
    ])
    const data = await regionsRes.json()
    const usersData = await usersRes.json()
    if (!regionsRes.ok) throw new Error(data.error || '加载区域失败')
    if (!usersRes.ok) throw new Error(usersData.error || '加载账号失败')
    setRegions(data.regions || [])
    setTree(data.tree || [])
    setDefaultRegionId(data.defaultRegionId || '')
    setUsers(usersData.users || [])
    return data.tree || []
  }, [])

  useEffect(() => {
    loadRegions()
      .then((loadedTree) => {
        const allIds = collectAllIds(loadedTree)
        setExpandedIds(new Set(allIds))
        setSelectedRegionId((prev) => prev || loadedTree[0]?.id || '')
      })
      .catch((err) => setError(err.message))
  }, [loadRegions])

  const selectedNode = useMemo(
    () => findTreeNode(tree, selectedRegionId),
    [tree, selectedRegionId],
  )

  const regionUsers = useMemo(
    () => users.filter((u) => u.regionId === selectedRegionId),
    [users, selectedRegionId],
  )

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openAddChild = (parent) => {
    setForm({ id: '', name: '', parentId: parent?.id || '' })
    setShowForm(true)
    setError('')
  }

  const createRegion = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/regions', {
        method: 'POST',
        body: JSON.stringify({
          id: form.id,
          name: form.name,
          parentId: form.parentId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建区域失败')
      setForm({ id: '', name: '', parentId: '' })
      setShowForm(false)
      const loadedTree = await loadRegions()
      setExpandedIds(new Set(collectAllIds(loadedTree)))
      if (form.id) setSelectedRegionId(form.id)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const freezeOnline = async (region) => {
    const ok = window.confirm(
      `将当前线上配置写入「${region.name}」。\n\n固化后仅使用区域文件，不再读代码内置配置。\n\n确定继续？`,
    )
    if (!ok) return
    setFreezingId(region.id)
    setError('')
    try {
      const res = await apiFetch(`/api/regions/${encodeURIComponent(region.id)}/freeze-online`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '固化失败')
      await loadRegions()
    } catch (err) {
      setError(err.message)
    }
    setFreezingId('')
  }

  const parentLabel = form.parentId
    ? regions.find((r) => r.id === form.parentId)?.name || form.parentId
    : '无（顶级）'

  return (
    <div className="ui-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-b border-dji-border bg-white">
        <div>
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-dji-black" aria-hidden />
            <h2 className="ui-section-title">区域管理</h2>
          </div>
          <p className="text-sm text-dji-muted mt-1">
            左侧选择区域，右侧查看配置、下级与账号
          </p>
        </div>
        <button
          type="button"
          onClick={() => openAddChild(null)}
          className="ui-btn-primary shrink-0 cursor-pointer"
        >
          <Plus size={14} aria-hidden />
          新建顶级区域
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4">
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row min-h-[480px]">
        <aside className="w-full lg:w-[240px] shrink-0 border-b lg:border-b-0 lg:border-r border-dji-border bg-slate-50/40 p-3 overflow-y-auto max-h-[280px] lg:max-h-none lg:min-h-[480px]">
          <p className="px-1 py-1 text-[11px] font-medium text-dji-subtle">区域目录</p>
          {tree.length ? (
            tree.map((root) => (
              <RegionFolderItem
                key={root.id}
                node={root}
                depth={0}
                selectedId={selectedRegionId}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpand}
                onSelect={setSelectedRegionId}
              />
            ))
          ) : (
            <p className="text-xs text-dji-subtle px-1 py-6 text-center">暂无区域</p>
          )}
        </aside>

        <main className="flex-1 min-w-0 p-5 space-y-5 bg-white">
          {selectedNode ? (
            <>
              <RegionDetailHeader
                node={selectedNode}
                onAddChild={openAddChild}
                onFreeze={freezeOnline}
                freezingId={freezingId}
              />
              <RegionChildrenSection
                node={selectedNode}
                onSelect={setSelectedRegionId}
                onAddChild={openAddChild}
                onFreeze={freezeOnline}
                freezingId={freezingId}
              />
              <RegionConnectivityForm
                regionId={selectedRegionId}
                regionName={selectedNode.name}
                defaultRegionId={defaultRegionId}
              />
              <section className="rounded-xl border border-dji-border bg-white shadow-dji-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-dji-border bg-slate-50/50">
                  <Users size={16} className="text-dji-black" aria-hidden />
                  <h3 className="ui-section-title text-sm">绑定账号</h3>
                  <span className="ml-auto text-xs text-dji-subtle tabular-nums">{regionUsers.length} 人</span>
                </div>
                <RegionAccountList users={regionUsers} regionName={selectedNode.name} />
              </section>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MapPin size={32} className="text-slate-300 mb-3" aria-hidden />
              <p className="text-sm text-dji-muted">请从左侧选择一个区域</p>
            </div>
          )}
        </main>
      </div>

      <div className="px-5 py-3 border-t border-dji-border bg-slate-50/50">
        <p className="text-xs text-dji-subtle leading-relaxed">
          支队账号可见全部下级设备；分局/叶子账号仅见本区数据。MQTT 与推流请在叶子区域（如海珠、增城）配置。
          {defaultRegionId && (
            <span className="text-slate-400"> 默认区域：{defaultRegionId}</span>
          )}
        </p>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
          <div className="ui-card w-full max-w-md p-5 shadow-dji-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="ui-section-title mb-4">
              {form.parentId ? `添加下级区域 · ${parentLabel}` : '新建顶级区域'}
            </h3>
            <form onSubmit={createRegion} className="space-y-3">
              <div>
                <label className="block text-xs text-dji-muted mb-1">区域 ID</label>
                <input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="如 huadu"
                  className="ui-input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-dji-muted mb-1">区域名称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如 花都分局"
                  className="ui-input w-full"
                  required
                />
              </div>
              {form.parentId && (
                <p className="text-xs text-dji-muted">上级：{parentLabel}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="ui-btn-secondary cursor-pointer">取消</button>
                <button type="submit" disabled={loading} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
                  {loading ? '创建中…' : '创建区域'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/** 供账号表单使用的扁平区域列表（带层级缩进） */
export function flattenRegionOptions(tree, depth = 0, out = []) {
  for (const node of tree || []) {
    out.push({ id: node.id, name: node.name, depth })
    if (node.children?.length) flattenRegionOptions(node.children, depth + 1, out)
  }
  return out
}
