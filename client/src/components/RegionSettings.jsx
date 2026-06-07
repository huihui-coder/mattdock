import { useCallback, useEffect, useMemo, useState } from 'react'
import { PaginatedList } from './ListPagination'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Link2,
  MapPin,
  Move,
  Network,
  Pencil,
  Plus,
  Radio,
  Save,
  Search,
  ShieldCheck,
  Snowflake,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { clearStreamUrlCache } from '../lib/stream-url'
import { isScopeAll, isScopeUnmapped } from '../lib/scope-query'
import MqttProfilesPanel from './MqttProfilesPanel'

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

function findFirstLeafId(nodes) {
  for (const node of nodes || []) {
    if (!node.children?.length) return node.id
    const id = findFirstLeafId(node.children)
    if (id) return id
  }
  return nodes?.[0]?.id || ''
}

function filterTree(nodes, query) {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const result = []
  for (const node of nodes || []) {
    const selfMatch = (node.name || '').toLowerCase().includes(q) || (node.id || '').toLowerCase().includes(q)
    const children = filterTree(node.children, query)
    if (selfMatch || children.length) {
      result.push({ ...node, children: children.length ? children : node.children })
    }
  }
  return result
}

function CollapsibleSection({ icon: Icon, title, meta, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-xl border border-dji-border bg-white shadow-dji-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 border-b border-dji-border bg-slate-50/50 text-left cursor-pointer hover:bg-slate-50 transition-colors duration-200"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={16} className="text-dji-black shrink-0" aria-hidden />
          <h3 className="ui-section-title text-sm">{title}</h3>
          {meta != null && <span className="text-xs text-dji-subtle tabular-nums">{meta}</span>}
        </div>
        <ChevronDown
          size={16}
          className={`text-dji-subtle shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && <div className="p-4">{children}</div>}
    </section>
  )
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

function RegionDetailHeader({ node, onAddChild, onFreeze, freezingId, onRename, renamingId }) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(node.name || '')

  useEffect(() => {
    setNameDraft(node.name || '')
    setEditingName(false)
  }, [node.id, node.name])

  const submitRename = async (e) => {
    e?.preventDefault?.()
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === node.name) {
      setEditingName(false)
      setNameDraft(node.name || '')
      return
    }
    await onRename?.(node.id, trimmed)
    setEditingName(false)
  }

  return (
    <div className="rounded-xl border border-dji-border bg-white p-4 shadow-dji-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 border border-dji-border">
            <Building2 size={22} className="text-slate-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {editingName ? (
                <form onSubmit={submitRename} className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="ui-input !py-1.5 text-base font-semibold min-w-[160px] flex-1 max-w-md"
                    autoFocus
                    required
                  />
                  <button type="submit" disabled={renamingId === node.id} className="ui-btn-primary !py-1.5 !text-xs cursor-pointer disabled:opacity-50">
                    <Save size={13} aria-hidden />
                    {renamingId === node.id ? '保存中…' : '保存'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingName(false); setNameDraft(node.name || '') }}
                    className="ui-btn-secondary !py-1.5 !text-xs cursor-pointer"
                  >
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-dji-black truncate">{node.name}</h3>
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors duration-200"
                    title="修改名称"
                    aria-label="修改组织名称"
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
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

function collectDescendantIds(regionId, regions) {
  const ids = [regionId]
  for (const r of regions) {
    if (r.parentId === regionId) ids.push(...collectDescendantIds(r.id, regions))
  }
  return ids
}

function RegionMoveSection({ regionId, regions, regionOptions, onMove, movingId }) {
  const current = regions.find((r) => r.id === regionId)
  const currentParentId = current?.parentId || ''
  const [parentDraft, setParentDraft] = useState(currentParentId)

  useEffect(() => {
    setParentDraft(current?.parentId || '')
  }, [regionId, current?.parentId])

  const invalidIds = useMemo(
    () => new Set(collectDescendantIds(regionId, regions)),
    [regionId, regions],
  )

  const parentOptions = useMemo(() => {
    const opts = [{ id: '', name: '无（顶级）', depth: 0 }]
    for (const opt of regionOptions) {
      if (!invalidIds.has(opt.id)) opts.push(opt)
    }
    return opts
  }, [regionOptions, invalidIds])

  const currentParentName = currentParentId
    ? regions.find((r) => r.id === currentParentId)?.name || currentParentId
    : '无（顶级）'

  const changed = (parentDraft || null) !== (current?.parentId || null)

  const submit = async (e) => {
    e.preventDefault()
    if (!changed) return
    await onMove?.(regionId, parentDraft || null)
  }

  return (
    <CollapsibleSection icon={Move} title="移动组织" defaultOpen={false}>
      <form onSubmit={submit} className="space-y-3 max-w-md">
        <p className="text-sm text-dji-muted">
          当前上级：
          <span className="text-dji-ink font-medium ml-1">{currentParentName}</span>
        </p>
        <label className="block text-sm">
          <span className="text-dji-muted mb-1.5 block">移动到</span>
          <select
            value={parentDraft}
            onChange={(e) => setParentDraft(e.target.value)}
            className="ui-input w-full cursor-pointer"
          >
            {parentOptions.map((opt) => (
              <option key={opt.id || '__root__'} value={opt.id}>
                {`${'\u00A0'.repeat(opt.depth * 2)}${opt.depth > 0 ? '└ ' : ''}${opt.name}`}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-dji-subtle">
          可将组织挂到任意上级下，不能移动到自身或其下级（避免形成环）。
        </p>
        <button
          type="submit"
          disabled={!changed || movingId === regionId}
          className="ui-btn-primary !text-xs cursor-pointer disabled:opacity-50"
        >
          {movingId === regionId ? '移动中…' : '确认移动'}
        </button>
      </form>
    </CollapsibleSection>
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

function RegionMqttBindingForm({ regionId, regionName, defaultRegionId, onSaved }) {
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [streamBase, setStreamBase] = useState('')
  const [streamToken, setStreamToken] = useState('')
  const [connMeta, setConnMeta] = useState({ usesEnvDefaults: false, tokenSet: false, mqttProfileName: '' })
  const [connLoading, setConnLoading] = useState(false)
  const [connSaving, setConnSaving] = useState(false)
  const [connError, setConnError] = useState('')
  const [expanded, setExpanded] = useState(true)

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) || null,
    [profiles, selectedProfileId],
  )

  useEffect(() => {
    if (!regionId) return undefined
    let cancelled = false
    setConnLoading(true)
    setConnError('')
    Promise.all([
      apiFetch('/api/mqtt-profiles').then((r) => r.json()),
      apiFetch(`/api/regions/${encodeURIComponent(regionId)}/connectivity`).then((r) => r.json()),
    ])
      .then(([profileData, connData]) => {
        if (cancelled) return
        setProfiles(profileData.profiles || [])
        setConnMeta({
          usesEnvDefaults: !!connData.usesEnvDefaults,
          tokenSet: !!connData.stream?.tokenSet,
          mqttProfileName: connData.mqttProfileName || '',
        })
        setSelectedProfileId(connData.mqttProfileId || '')
        setStreamBase(connData.stream?.baseUrl || '')
        setStreamToken('')
      })
      .catch((err) => { if (!cancelled) setConnError(err.message) })
      .finally(() => { if (!cancelled) setConnLoading(false) })
    return () => { cancelled = true }
  }, [regionId])

  const saveBinding = async (e) => {
    e.preventDefault()
    if (!selectedProfileId) {
      setConnError('请选择 MQTT 配置')
      return
    }
    setConnSaving(true)
    setConnError('')
    try {
      const body = {
        mqttProfileId: selectedProfileId,
        stream: { baseUrl: streamBase },
      }
      if (streamToken.trim()) body.stream.token = streamToken.trim()
      const res = await apiFetch(`/api/regions/${encodeURIComponent(regionId)}/connectivity`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      clearStreamUrlCache()
      setConnMeta({
        usesEnvDefaults: false,
        tokenSet: data.connectivity?.stream?.tokenSet ?? !!streamToken.trim(),
        mqttProfileName: data.connectivity?.mqttProfileName || selectedProfile?.name || '',
      })
      setStreamToken('')
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
          <Link2 size={16} className="text-dji-black shrink-0" aria-hidden />
          <h3 className="ui-section-title text-sm">绑定 MQTT 配置</h3>
          {connMeta.mqttProfileName && (
            <span className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-2 py-0.5 truncate hidden sm:inline">
              {connMeta.mqttProfileName}
            </span>
          )}
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
            从平台 MQTT 连接池选择配置绑定到本组织。MQTT 参数在「MQTT 连接池」Tab 统一维护；此处仅需选择并可选覆盖推流地址。
          </p>
          {isDefaultEnv && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
              默认区域当前使用全局 .env。绑定后将切换为所选 MQTT 配置。
            </p>
          )}
          {connError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{connError}</p>
          )}
          {connLoading ? (
            <p className="text-sm text-dji-subtle py-4 text-center">加载绑定信息…</p>
          ) : (
            <form onSubmit={saveBinding} className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-dji-muted">选择 MQTT 配置</span>
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="ui-input mt-1 w-full cursor-pointer"
                >
                  <option value="">— 请选择 —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.mqtt?.brokerUrl}</option>
                  ))}
                </select>
              </label>

              {selectedProfile && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs space-y-1.5">
                  <p className="font-medium text-slate-700">配置预览</p>
                  <p className="font-mono text-slate-600 break-all">{selectedProfile.mqtt?.brokerUrl}</p>
                  <p className="text-slate-600">账号：{selectedProfile.mqtt?.username || '—'} · Client ID：{selectedProfile.mqtt?.clientId || '—'}</p>
                  {selectedProfile.stream?.baseUrl && (
                    <p className="text-slate-500">默认推流：{selectedProfile.stream.baseUrl}</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-dji-border pt-3">
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium text-dji-muted">推流基址（可选覆盖）</span>
                  <input
                    value={streamBase}
                    onChange={(e) => setStreamBase(e.target.value)}
                    placeholder={selectedProfile?.stream?.baseUrl || '留空则使用配置默认值'}
                    className="ui-input mt-1 w-full font-mono text-sm"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium text-dji-muted">
                    推流 Token{connMeta.tokenSet && !streamToken ? '（已设置，留空不修改）' : ''}
                  </span>
                  <input
                    type="password"
                    value={streamToken}
                    onChange={(e) => setStreamToken(e.target.value)}
                    className="ui-input mt-1 w-full font-mono text-sm"
                    autoComplete="new-password"
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <button type="submit" disabled={connSaving || !profiles.length} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
                  <Save size={14} aria-hidden />
                  {connSaving ? '绑定中…' : '绑定配置'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}

function RegionCreateAccountForm({
  regionId,
  regionName,
  permissions,
  onCreated,
  onError,
}) {
  const [form, setForm] = useState({ username: '', password: '', permissions: ['flight-records'] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setForm({ username: '', password: '', permissions: ['flight-records'] })
  }, [regionId])

  const togglePermission = (p) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter((x) => x !== p)
        : [...prev.permissions, p],
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    onError('')
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, regionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '创建账号失败')
      setForm({ username: '', password: '', permissions: ['flight-records'] })
      onCreated?.()
    } catch (err) {
      onError(err.message)
    }
    setLoading(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-dji-subtle">
        新账号将绑定到 <span className="font-medium text-dji-ink">{regionName}</span>
        <span className="font-mono text-[11px] text-dji-muted ml-1">({regionId})</span>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          placeholder="用户名"
          className="ui-input"
          required
        />
        <input
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="密码"
          type="password"
          className="ui-input"
          required
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {permissions.map((p) => (
          <label
            key={p}
            className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
              form.permissions.includes(p) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-blue-200'
            }`}
          >
            <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => togglePermission(p)} className="sr-only" />
            {PERMISSION_LABELS[p] || p}
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={loading} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
          <UserPlus size={14} aria-hidden />
          {loading ? '创建中…' : '创建账号'}
        </button>
      </div>
    </form>
  )
}

function RegionAccountTable({
  users,
  regionName,
  showPasswords,
  onTogglePasswords,
  onEdit,
  onDelete,
}) {
  if (!users.length) {
    return (
      <p className="text-sm text-dji-subtle py-6 text-center">
        「{regionName}」暂无账号，可在上方创建。
      </p>
    )
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button type="button" onClick={onTogglePasswords} className="ui-btn-secondary !text-xs cursor-pointer">
          {showPasswords ? <EyeOff size={13} /> : <Eye size={13} />}
          {showPasswords ? '隐藏密码' : '显示密码'}
        </button>
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <PaginatedList items={users} resetKey={regionName}>
          {(pageUsers) => (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dji-border text-dji-muted">
                  <th className="text-left py-2.5 font-medium">用户名</th>
                  <th className="text-left py-2.5 font-medium">状态</th>
                  <th className="text-left py-2.5 font-medium">角色</th>
                  <th className="text-left py-2.5 font-medium">密码</th>
                  <th className="text-left py-2.5 font-medium">权限</th>
                  <th className="text-left py-2.5 font-medium">创建时间</th>
                  <th className="text-right py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((u) => (
                  <tr key={u.username} className="border-b border-dji-border/50 hover:bg-slate-50/80 transition-colors duration-200 last:border-0">
                    <td className="py-2.5">
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
                          在线{u.sessionCount > 1 ? ` (${u.sessionCount})` : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-dji-subtle">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                          离线
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-dji-muted">{u.role === 'admin' ? '管理员' : '普通账号'}</td>
                    <td className="py-2.5 font-mono text-dji-ink">{showPasswords ? (u.plainPassword || '未记录') : '••••••'}</td>
                    <td className="py-2.5 text-dji-muted max-w-[180px] truncate" title={
                      u.role === 'admin' ? '全部权限' : (u.permissions || []).map((p) => PERMISSION_LABELS[p] || p).join('、') || '无'
                    }>
                      {u.role === 'admin' ? '全部权限' : (u.permissions || []).map((p) => PERMISSION_LABELS[p] || p).join('、') || '无'}
                    </td>
                    <td className="py-2.5 text-dji-subtle whitespace-nowrap">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '--'}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => onEdit(u)} className="p-1.5 rounded-full text-dji-ink hover:bg-dji-page cursor-pointer" title="编辑">
                          <Pencil size={14} />
                        </button>
                        {u.role !== 'admin' && (
                          <button type="button" onClick={() => onDelete(u.username)} className="p-1.5 rounded-full text-red-600 hover:bg-red-50 cursor-pointer" title="删除">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PaginatedList>
      </div>
    </>
  )
}

export default function RegionSettings({
  scopeRegionId = '',
  onScopeRegionChange,
  onRegionsChanged,
}) {
  const [tree, setTree] = useState([])
  const [regions, setRegions] = useState([])
  const [users, setUsers] = useState([])
  const [permissions, setPermissions] = useState([])
  const [defaultRegionId, setDefaultRegionId] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [treeSearch, setTreeSearch] = useState('')
  const [form, setForm] = useState({ id: '', name: '', parentId: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [freezingId, setFreezingId] = useState('')
  const [renamingId, setRenamingId] = useState('')
  const [movingId, setMovingId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ permissions: [], password: '', regionId: '' })
  const [editLoading, setEditLoading] = useState(false)
  const [adminTab, setAdminTab] = useState('orgs')

  const notifyRegionsChanged = useCallback(async () => {
    await onRegionsChanged?.()
  }, [onRegionsChanged])

  const handleSelectRegion = useCallback((regionId) => {
    setSelectedRegionId(regionId)
    onScopeRegionChange?.(regionId)
  }, [onScopeRegionChange])

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
    setPermissions(usersData.permissions || [])
    return data.tree || []
  }, [])

  useEffect(() => {
    loadRegions()
      .then((loadedTree) => {
        const allIds = collectAllIds(loadedTree)
        setExpandedIds(new Set(allIds))
        setSelectedRegionId((prev) => prev || findFirstLeafId(loadedTree) || loadedTree[0]?.id || '')
      })
      .catch((err) => setError(err.message))
  }, [loadRegions])

  useEffect(() => {
    if (!tree.length || !scopeRegionId || isScopeUnmapped(scopeRegionId)) return
    const rootId = tree[0]?.id
    const nextId = isScopeAll(scopeRegionId) && rootId ? rootId : scopeRegionId
    if (nextId && findTreeNode(tree, nextId)) {
      setSelectedRegionId(nextId)
    }
  }, [scopeRegionId, tree])

  useEffect(() => {
    const timer = setInterval(() => {
      loadRegions().catch(() => {})
    }, 15000)
    return () => clearInterval(timer)
  }, [loadRegions])

  const selectedNode = useMemo(
    () => findTreeNode(tree, selectedRegionId),
    [tree, selectedRegionId],
  )

  const regionUsers = useMemo(
    () => users.filter((u) => u.regionId === selectedRegionId),
    [users, selectedRegionId],
  )

  const filteredTree = useMemo(() => filterTree(tree, treeSearch), [tree, treeSearch])

  const regionOptions = useMemo(
    () => flattenRegionOptions(tree.length ? tree : regions.map((r) => ({ ...r, children: [] }))),
    [tree, regions],
  )

  const openEdit = (user) => {
    setEditing(user.username)
    setEditForm({
      permissions: [...(user.permissions || [])],
      password: '',
      regionId: user.regionId || selectedRegionId,
    })
    setError('')
  }

  const saveEdit = async () => {
    if (!editing) return
    setEditLoading(true)
    setError('')
    try {
      const body = { permissions: editForm.permissions, regionId: editForm.regionId }
      if (editForm.password.trim()) body.password = editForm.password.trim()
      const res = await apiFetch(`/api/users/${encodeURIComponent(editing)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新失败')
      setEditing(null)
      await loadRegions()
      await notifyRegionsChanged()
    } catch (err) {
      setError(err.message)
    }
    setEditLoading(false)
  }

  const deleteUser = async (username) => {
    if (!window.confirm(`确定删除账号「${username}」？此操作不可恢复。`)) return
    setError('')
    try {
      const res = await apiFetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      await loadRegions()
      await notifyRegionsChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  const toggleEditPermission = (p) => {
    setEditForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter((x) => x !== p)
        : [...prev.permissions, p],
    }))
  }

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
      const createdId = form.id
      const loadedTree = await loadRegions()
      setExpandedIds(new Set(collectAllIds(loadedTree)))
      if (createdId) handleSelectRegion(createdId)
      await notifyRegionsChanged()
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
      await notifyRegionsChanged()
    } catch (err) {
      setError(err.message)
    }
    setFreezingId('')
  }

  const renameRegion = async (regionId, name) => {
    setRenamingId(regionId)
    setError('')
    try {
      const res = await apiFetch(`/api/regions/${encodeURIComponent(regionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '修改名称失败')
      await loadRegions()
      await notifyRegionsChanged()
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setRenamingId('')
    }
  }

  const moveRegion = async (regionId, parentId) => {
    setMovingId(regionId)
    setError('')
    try {
      const res = await apiFetch(`/api/regions/${encodeURIComponent(regionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ parentId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '移动失败')
      const loadedTree = await loadRegions()
      if (parentId) {
        setExpandedIds((prev) => new Set([...prev, parentId, ...collectAllIds(loadedTree)]))
      }
      await notifyRegionsChanged()
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setMovingId('')
    }
  }

  const parentLabel = form.parentId
    ? regions.find((r) => r.id === form.parentId)?.name || form.parentId
    : '无（顶级）'

  return (
    <div className="ui-card overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-b border-dji-border bg-white">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-dji-black" aria-hidden />
            <h2 className="ui-section-title">账号管理</h2>
          </div>
          <p className="text-sm text-dji-muted mt-1">
            MQTT 连接池独立管理；组织与账号 Tab 中仅为各组织选择绑定
          </p>
        </div>
        {adminTab === 'orgs' && (
          <button
            type="button"
            onClick={() => openAddChild(null)}
            className="ui-btn-primary shrink-0 cursor-pointer"
          >
            <Plus size={14} aria-hidden />
            新建顶级区域
          </button>
        )}
      </div>

      <div className="px-5 pt-4 border-b border-dji-border bg-white">
        <div className="ui-nav-bar-full max-w-md" role="tablist" aria-label="管理模块">
          <button
            type="button"
            role="tab"
            aria-selected={adminTab === 'mqtt'}
            onClick={() => setAdminTab('mqtt')}
            className={`ui-tab flex-1 justify-center cursor-pointer ${adminTab === 'mqtt' ? 'ui-tab-active' : 'ui-tab-inactive'}`}
          >
            <Radio size={14} aria-hidden />
            MQTT 连接池
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={adminTab === 'orgs'}
            onClick={() => setAdminTab('orgs')}
            className={`ui-tab flex-1 justify-center cursor-pointer ${adminTab === 'orgs' ? 'ui-tab-active' : 'ui-tab-inactive'}`}
          >
            <Building2 size={14} aria-hidden />
            组织与账号
          </button>
        </div>
      </div>

      {error && adminTab === 'orgs' && (
        <div className="mx-5 mt-4">
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        </div>
      )}

      {adminTab === 'mqtt' ? (
        <div className="p-5 bg-white">
          <MqttProfilesPanel onChanged={async () => { await loadRegions(); await notifyRegionsChanged() }} />
        </div>
      ) : (
      <>
      <div className="flex flex-col lg:flex-row min-h-[480px]">
        <aside className="w-full lg:w-[240px] shrink-0 border-b lg:border-b-0 lg:border-r border-dji-border bg-slate-50/40 p-3 overflow-y-auto max-h-[280px] lg:max-h-none lg:min-h-[480px]">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dji-subtle pointer-events-none" aria-hidden />
            <input
              type="search"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              placeholder="搜索组织"
              className="ui-input w-full !py-1.5 !pl-8 !text-xs"
            />
          </div>
          <p className="px-1 py-1 text-[11px] font-medium text-dji-subtle">组织目录</p>
          {filteredTree.length ? (
            filteredTree.map((root) => (
              <RegionFolderItem
                key={root.id}
                node={root}
                depth={0}
                selectedId={selectedRegionId}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpand}
                onSelect={handleSelectRegion}
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
                onRename={renameRegion}
                renamingId={renamingId}
              />
              <RegionMoveSection
                regionId={selectedRegionId}
                regions={regions}
                regionOptions={regionOptions}
                onMove={moveRegion}
                movingId={movingId}
              />
              <RegionChildrenSection
                node={selectedNode}
                onSelect={handleSelectRegion}
                onAddChild={openAddChild}
                onFreeze={freezeOnline}
                freezingId={freezingId}
              />
              <RegionMqttBindingForm
                regionId={selectedRegionId}
                regionName={selectedNode.name}
                defaultRegionId={defaultRegionId}
              />
              <CollapsibleSection icon={UserPlus} title="创建账号" defaultOpen={false}>
                <RegionCreateAccountForm
                  regionId={selectedRegionId}
                  regionName={selectedNode.name}
                  permissions={permissions}
                  onCreated={async () => { await loadRegions(); await notifyRegionsChanged() }}
                  onError={setError}
                />
              </CollapsibleSection>
              <CollapsibleSection icon={Users} title="账号列表" meta={`${regionUsers.length} 人`}>
                <RegionAccountTable
                  users={regionUsers}
                  regionName={selectedNode.name}
                  showPasswords={showPasswords}
                  onTogglePasswords={() => setShowPasswords((v) => !v)}
                  onEdit={openEdit}
                  onDelete={deleteUser}
                />
              </CollapsibleSection>
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
          支队账号可见全部下级设备；分局/叶子账号仅见本区数据。MQTT 在「连接池」统一维护，组织侧仅选择绑定。
          {defaultRegionId && (
            <span className="text-slate-400"> 默认区域：{defaultRegionId}</span>
          )}
        </p>
      </div>
      </>
      )}

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

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="ui-card w-full max-w-md p-5 shadow-dji-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="ui-section-title">编辑账号：{editing}</h3>
              <button type="button" onClick={() => setEditing(null)} className="p-1 rounded-full hover:bg-dji-page text-dji-subtle cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="mb-4">
              <div className="text-sm font-medium text-dji-ink mb-2">所属区域</div>
              <select
                value={editForm.regionId}
                onChange={(e) => setEditForm({ ...editForm, regionId: e.target.value })}
                className="ui-input w-full cursor-pointer"
              >
                {regionOptions.map((r) => (
                  <option key={r.id} value={r.id}>{`${'　'.repeat(r.depth)}${r.name}`}</option>
                ))}
              </select>
            </div>

            {users.find((u) => u.username === editing)?.role !== 'admin' && (
              <div className="mb-4">
                <div className="text-sm font-medium text-dji-ink mb-2">权限配置</div>
                <div className="flex flex-wrap gap-2">
                  {permissions.map((p) => (
                    <label key={p} className={`px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${editForm.permissions.includes(p) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                      <input type="checkbox" checked={editForm.permissions.includes(p)} onChange={() => toggleEditPermission(p)} className="sr-only" />
                      {PERMISSION_LABELS[p] || p}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <div className="text-sm font-medium text-dji-ink mb-2">重置密码（留空则不修改）</div>
              <input
                type="text"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="新密码"
                className="ui-input"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="ui-btn-secondary cursor-pointer">取消</button>
              <button type="button" onClick={saveEdit} disabled={editLoading} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
                <Save size={14} />
                {editLoading ? '保存中…' : '保存'}
              </button>
            </div>
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
