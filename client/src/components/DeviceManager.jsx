import { useEffect, useMemo, useState } from 'react'
import { HardDrive, Plus, Pencil, Trash2, X, Save, Search, Wifi, Link2 } from 'lucide-react'
import RegionLabel from './RegionLabel'

const SOURCE_LABELS = {
  builtin: '内置',
  env: '环境变量',
  custom: '自定义',
  unmapped: '未映射',
  learned: '在线学习',
}

const BINDING_LABELS = {
  builtin: '内置绑定',
  custom: '自定义',
  learned: '在线学习',
}

/** 列表筛选：绑定关系合并展示，不拆机场/机库、单兵/遥控器 */
const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'airport', label: '自动机场' },
  { key: 'single', label: '单兵无人机' },
]

/** 手动添加映射时的设备类型 */
const ADD_CATEGORY_OPTIONS = [
  { value: 'airport', label: '自动机场' },
  { value: 'airport_drone', label: '机库无人机（未绑机场时）' },
  { value: 'single', label: '单兵无人机' },
  { value: 'remote', label: '遥控器' },
]

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() } })
}

function StackedCell({ primary, secondary, mono = false, subMuted = true }) {
  return (
    <div className="min-w-0">
      <div className={`truncate ${mono ? 'font-mono text-xs text-dji-ink' : 'font-medium text-dji-black'}`} title={primary}>
        {primary || '—'}
      </div>
      {secondary != null && (
        <div
          className={`mt-1.5 pl-3 border-l-2 border-slate-200 truncate ${
            mono ? 'font-mono text-[11px] text-dji-muted' : subMuted ? 'text-sm text-dji-muted' : 'text-sm text-dji-ink'
          }`}
          title={secondary}
        >
          {secondary || '—'}
        </div>
      )}
    </div>
  )
}

function OnlineBadge({ online, statusText }) {
  if (online) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700" title={statusText || '在线'}>
        <Wifi size={13} /> 在线
      </span>
    )
  }
  return <span className="text-dji-subtle">{statusText || '离线'}</span>
}

function SourceBadge({ source }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
      source === 'custom' ? 'bg-blue-50 text-blue-700' :
      source === 'unmapped' ? 'bg-amber-50 text-amber-700' :
      source === 'learned' ? 'bg-violet-50 text-violet-700' :
      'bg-slate-100 text-slate-600'
    }`}>
      {SOURCE_LABELS[source] || source}
    </span>
  )
}

function DeviceActions({ device, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => onEdit(device)} className="p-1.5 rounded-full text-dji-ink hover:bg-dji-page" title="编辑">
        <Pencil size={14} />
      </button>
      {device?.source === 'custom' && onDelete && (
        <button type="button" onClick={() => onDelete(device.deviceId)} className="p-1.5 rounded-full text-red-600 hover:bg-red-50" title="删除自定义映射">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

function SimpleDeviceTable({ rows, onEdit, onDelete, emptyText = '暂无设备' }) {
  if (!rows.length) {
    return <p className="py-6 text-center text-sm text-dji-muted">{emptyText}</p>
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-dji-border text-dji-muted">
          <th className="text-left py-2 font-medium">设备名称</th>
          <th className="text-left py-2 font-medium">SN</th>
          <th className="text-left py-2 font-medium">区域</th>
          <th className="text-left py-2 font-medium">来源</th>
          <th className="text-left py-2 font-medium">状态</th>
          <th className="text-right py-2 font-medium">操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.deviceId} className="border-b border-dji-border/50 hover:bg-dji-page transition-colors">
            <td className="py-2.5 font-medium text-dji-black max-w-[220px] truncate" title={d.name}>
              {d.source === 'unmapped' ? <span className="text-amber-700">{d.deviceId}</span> : d.name}
            </td>
            <td className="py-2.5 font-mono text-xs text-dji-muted">{d.deviceId}</td>
            <td className="py-2.5">
              <RegionLabel regionName={d.regionName} regionId={d.regionId} />
            </td>
            <td className="py-2.5"><SourceBadge source={d.source} /></td>
            <td className="py-2.5"><OnlineBadge online={d.online} statusText={d.statusText} /></td>
            <td className="py-2.5 text-right"><DeviceActions device={d} onEdit={onEdit} onDelete={onDelete} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BindingPairTable({
  rows,
  primaryKey,
  primaryLabel,
  secondaryLabel,
  primaryModelKey,
  secondaryModelKey,
  primarySnKey,
  secondarySnKey,
  primaryDeviceKey,
  secondaryDeviceKey,
  bindingSourceKey,
  emptyText,
  onEditPrimary,
  onEditSecondary,
  onDelete,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-dji-border text-dji-muted">
            <th className="text-left py-2 font-medium w-[140px]">设备型号</th>
            <th className="text-left py-2 font-medium w-[200px]">SN</th>
            <th className="text-left py-2 font-medium min-w-[200px]">名称</th>
            <th className="text-left py-2 font-medium w-[88px]">区域</th>
            <th className="text-left py-2 font-medium w-[100px]">绑定</th>
            <th className="text-left py-2 font-medium w-[90px]">状态</th>
            <th className="text-right py-2 font-medium w-[80px]">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="py-8 text-center text-dji-muted">{emptyText}</td></tr>
          ) : rows.map((row) => (
            <tr
              key={row[primaryKey]}
              className="border-b border-dji-border/50 hover:bg-dji-page/80 transition-colors align-top"
            >
              <td className="py-3 pr-3">
                <StackedCell
                  primary={row[primaryModelKey]}
                  secondary={row[secondaryModelKey] || secondaryLabel}
                />
              </td>
              <td className="py-3 pr-3">
                <StackedCell mono primary={row[primarySnKey]} secondary={row[secondarySnKey]} />
              </td>
              <td className="py-3 pr-3">
                <StackedCell primary={row[primaryDeviceKey]?.name} secondary={row[secondaryDeviceKey]?.name} />
              </td>
              <td className="py-3 pr-3">
                <RegionLabel regionName={row.regionName} regionId={row.regionId} />
              </td>
              <td className="py-3 pr-3">
                <span className="inline-flex px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                  {BINDING_LABELS[row[bindingSourceKey]] || row[bindingSourceKey]}
                </span>
              </td>
              <td className="py-3 pr-3">
                <div className="space-y-2">
                  <OnlineBadge online={row[primaryDeviceKey]?.online} statusText={row[primaryDeviceKey]?.statusText} />
                  {row[secondaryDeviceKey] && (
                    <div className="pl-3 border-l-2 border-slate-200">
                      <OnlineBadge online={row[secondaryDeviceKey]?.online} statusText={row[secondaryDeviceKey]?.statusText} />
                    </div>
                  )}
                </div>
              </td>
              <td className="py-3 text-right">
                <div className="space-y-1">
                  <DeviceActions device={row[primaryDeviceKey]} onEdit={() => onEditPrimary(row)} onDelete={onDelete} />
                  {row[secondaryDeviceKey] && (
                    <div className="pl-1">
                      <DeviceActions device={row[secondaryDeviceKey]} onEdit={() => onEditSecondary(row)} onDelete={onDelete} />
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DeviceManager() {
  const [pairs, setPairs] = useState([])
  const [singlePairs, setSinglePairs] = useState([])
  const [unboundSingles, setUnboundSingles] = useState([])
  const [unboundRemotes, setUnboundRemotes] = useState([])
  const [filterCategory, setFilterCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ deviceId: '', name: '', category: 'single' })
  const [formLoading, setFormLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({
    name: '',
    category: 'single',
    droneSn: '',
    droneName: '',
    regionId: '',
    regionName: '',
  })
  const [editLoading, setEditLoading] = useState(false)

  const loadDevices = async () => {
    const params = new URLSearchParams()
    if (filterCategory !== 'all') params.set('category', filterCategory)
    if (search.trim()) params.set('q', search.trim())
    const res = await apiFetch(`/api/device-registry?${params}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '获取设备列表失败')
    setPairs(data.pairs || [])
    setSinglePairs(data.singlePairs || [])
    setUnboundSingles(data.unboundSingles || [])
    setUnboundRemotes(data.unboundRemotes || [])
  }

  useEffect(() => {
    setLoading(true)
    loadDevices()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [filterCategory, search])

  const stats = useMemo(() => ({
    airports: pairs.length,
    singles: singlePairs.length,
    online: [
      ...pairs.flatMap((p) => [p.airport, p.drone].filter(Boolean)),
      ...singlePairs.flatMap((p) => [p.remote, p.drone].filter(Boolean)),
      ...unboundSingles,
      ...unboundRemotes,
    ].filter((d) => d.online).length,
  }), [pairs, singlePairs, unboundSingles, unboundRemotes])

  const openAdd = () => {
    const defaultCategory = filterCategory === 'airport' ? 'airport' : 'single'
    setForm({ deviceId: '', name: '', category: defaultCategory })
    setError('')
    setAddOpen(true)
  }

  const submitAdd = async (e) => {
    e.preventDefault()
    setFormLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/device-registry', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '添加失败')
      setAddOpen(false)
      setForm({ deviceId: '', name: '', category: 'single' })
      await loadDevices()
    } catch (err) {
      setError(err.message)
    }
    setFormLoading(false)
  }

  const openEdit = (device, pair = null, pairKind = 'airport') => {
    setEditing(device.deviceId)
    const isAirportRow = pairKind === 'airport' && device.category === 'airport'
    const isRemoteRow = pairKind === 'single' && device.category === 'remote'
    setEditForm({
      name: device.name,
      category: device.category,
      droneSn: pair?.droneSn || '',
      droneName: pair?.drone?.name || '',
      regionId: device.regionId || pair?.regionId || '',
      regionName: device.regionName || pair?.regionName || '',
      pairAirportSn: pairKind === 'airport'
        ? (pair?.airportSn || (isAirportRow ? device.deviceId : null))
        : null,
      pairRemoteSn: pairKind === 'single'
        ? (pair?.remoteSn || (isRemoteRow ? device.deviceId : null))
        : null,
      isAirportRow,
      isRemoteRow,
    })
    setError('')
  }

  const saveEdit = async () => {
    if (!editing) return
    setEditLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/device-registry/${encodeURIComponent(editing)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editForm.name, category: editForm.category }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')

      if (editForm.isAirportRow && editForm.pairAirportSn) {
        const bindRes = await apiFetch(
          `/api/device-registry/bindings/${encodeURIComponent(editForm.pairAirportSn)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              droneSn: editForm.droneSn.trim(),
              droneName: editForm.droneName.trim() || undefined,
            }),
          }
        )
        const bindData = await bindRes.json()
        if (!bindRes.ok) throw new Error(bindData.error || '保存绑定失败')
      }

      if (editForm.isRemoteRow && editForm.pairRemoteSn) {
        const bindRes = await apiFetch(
          `/api/device-registry/remote-bindings/${encodeURIComponent(editForm.pairRemoteSn)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              droneSn: editForm.droneSn.trim(),
              droneName: editForm.droneName.trim() || undefined,
            }),
          }
        )
        const bindData = await bindRes.json()
        if (!bindRes.ok) throw new Error(bindData.error || '保存单兵绑定失败')
      }

      setEditing(null)
      await loadDevices()
    } catch (err) {
      setError(err.message)
    }
    setEditLoading(false)
  }

  const removeOverride = async (deviceId) => {
    if (!window.confirm('确定删除该设备的自定义映射？将恢复为内置或环境变量配置。')) return
    setError('')
    try {
      const res = await apiFetch(`/api/device-registry/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      await loadDevices()
    } catch (err) {
      setError(err.message)
    }
  }

  const showPairs = filterCategory === 'all' || filterCategory === 'airport'
  const showSinglePairs = filterCategory === 'all' || filterCategory === 'single'
  const pairsOnly = filterCategory === 'airport'
  const singlesOnly = filterCategory === 'single'

  return (
    <div>
      <div className="ui-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-800 tracking-tight">设备管理</h2>
            <p className="text-sm text-slate-500 mt-1">
              机场 {stats.airports} 组 · 单兵 {stats.singles} 组 · 在线 {stats.online}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索 SN 或名称"
                className="ui-input pl-9 w-full"
              />
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="ui-btn-primary shrink-0 justify-center cursor-pointer"
            >
              <Plus size={16} />
              添加映射
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {FILTER_TABS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilterCategory(opt.key)}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors cursor-pointer ${
                filterCategory === opt.key
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <span className="text-xs text-dji-muted ml-1 hidden lg:inline">
            机场↔机库无人机、遥控器↔单兵均为绑定组；OSD 在线时自动学习
          </span>
        </div>

        {loading ? (
          <p className="py-10 text-center text-dji-muted">加载中...</p>
        ) : (
          <div className="space-y-8">
            {showPairs && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Link2 size={16} className="text-dji-black" />
                  <h3 className="ui-section-title">
                    {pairsOnly ? '自动机场' : '自动机场 · 绑定关系'}
                  </h3>
                  <span className="text-xs text-dji-muted">上行机场 / 下行机库无人机</span>
                </div>
                <BindingPairTable
                  rows={pairs}
                  primaryKey="airportSn"
                  secondaryLabel="未绑定无人机"
                  primaryModelKey="dockModel"
                  secondaryModelKey="droneModel"
                  primarySnKey="airportSn"
                  secondarySnKey="droneSn"
                  primaryDeviceKey="airport"
                  secondaryDeviceKey="drone"
                  bindingSourceKey="bindingSource"
                  emptyText="暂无机场绑定数据"
                  onEditPrimary={(pair) => openEdit(pair.airport, pair, 'airport')}
                  onEditSecondary={(pair) => openEdit(pair.drone, pair, 'airport')}
                  onDelete={removeOverride}
                />
              </section>
            )}

            {showSinglePairs && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Link2 size={16} className="text-dji-black" />
                  <h3 className="ui-section-title">
                    {singlesOnly ? '单兵无人机' : '单兵无人机 · 绑定关系'}
                  </h3>
                  <span className="text-xs text-dji-muted">上行遥控器 / 下行单兵无人机</span>
                </div>
                <BindingPairTable
                  rows={singlePairs}
                  primaryKey="remoteSn"
                  secondaryLabel="未绑定单兵"
                  primaryModelKey="remoteModel"
                  secondaryModelKey="droneModel"
                  primarySnKey="remoteSn"
                  secondarySnKey="droneSn"
                  primaryDeviceKey="remote"
                  secondaryDeviceKey="drone"
                  bindingSourceKey="bindingSource"
                  emptyText="暂无单兵绑定数据（设备上线后 OSD 将自动学习）"
                  onEditPrimary={(pair) => openEdit(pair.remote, pair, 'single')}
                  onEditSecondary={(pair) => openEdit(pair.drone, pair, 'single')}
                  onDelete={removeOverride}
                />
                {(unboundSingles.length > 0 || unboundRemotes.length > 0) && (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-dji-muted">未绑定设备（等待 OSD 学习或手动关联）</p>
                    {unboundRemotes.length > 0 && (
                      <SimpleDeviceTable rows={unboundRemotes} onEdit={(d) => openEdit(d)} onDelete={removeOverride} emptyText="" />
                    )}
                    {unboundSingles.length > 0 && (
                      <SimpleDeviceTable rows={unboundSingles} onEdit={(d) => openEdit(d)} onDelete={removeOverride} emptyText="" />
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {error && !addOpen && !editing && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setAddOpen(false); setError('') }}>
          <div className="ui-card w-full max-w-md p-5 shadow-dji-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Plus size={18} />
                <h3 className="ui-section-title">添加 / 覆盖映射</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="p-1 rounded-full hover:bg-dji-page text-dji-subtle cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-dji-muted mb-4">
              绑定关系请优先在表格行内编辑；此处用于新增未入库设备。单兵与遥控器上线后 OSD 会自动学习绑定。
            </p>
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>
            )}
            <form onSubmit={submitAdd} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-dji-ink mb-2 block">设备 SN</label>
                <input
                  value={form.deviceId}
                  onChange={(e) => setForm({ ...form, deviceId: e.target.value.trim() })}
                  placeholder="1581F... / AHRXN..."
                  className="ui-input font-mono text-sm w-full"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium text-dji-ink mb-2 block">显示名称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：昌岗派出所-M4T"
                  className="ui-input w-full"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-dji-ink mb-2 block">设备类型</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="ui-input w-full cursor-pointer"
                >
                  {ADD_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAddOpen(false)} className="ui-btn-secondary cursor-pointer">取消</button>
                <button type="submit" disabled={formLoading} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
                  <Save size={14} />
                  {formLoading ? '保存中...' : '保存映射'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="ui-card w-full max-w-md p-5 shadow-dji-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HardDrive size={18} />
                <h3 className="ui-section-title">编辑设备</h3>
              </div>
              <button onClick={() => setEditing(null)} className="p-1 rounded-full hover:bg-dji-page text-dji-subtle">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs font-mono text-dji-muted mb-4 break-all">{editing}</p>
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>
            )}
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-dji-ink mb-2">区域</div>
                <div className="ui-input flex items-center gap-2 bg-dji-page/60 text-dji-ink cursor-default">
                  {editForm.regionId || editForm.regionName ? (
                    <>
                      <RegionLabel regionName={editForm.regionName} regionId={editForm.regionId} />
                      {editForm.regionId && editForm.regionName && editForm.regionName !== editForm.regionId && (
                        <span className="text-xs font-mono text-dji-muted">{editForm.regionId}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-dji-muted">未分配</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-dji-ink mb-2">显示名称</div>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="ui-input"
                />
              </div>
              <div>
                <div className="text-sm font-medium text-dji-ink mb-2">设备类型</div>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  className="ui-input"
                >
                  {ADD_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {(editForm.isAirportRow || editForm.isRemoteRow) && (
                <>
                  <div>
                    <div className="text-sm font-medium text-dji-ink mb-2">
                      {editForm.isRemoteRow ? '绑定单兵无人机 SN' : '绑定无人机 SN'}
                    </div>
                    <input
                      value={editForm.droneSn}
                      onChange={(e) => setEditForm({ ...editForm, droneSn: e.target.value.trim() })}
                      className="ui-input font-mono text-sm"
                      placeholder="1581F..."
                    />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-dji-ink mb-2">绑定无人机名称（可选）</div>
                    <input
                      value={editForm.droneName}
                      onChange={(e) => setEditForm({ ...editForm, droneName: e.target.value })}
                      className="ui-input"
                      placeholder={editForm.isRemoteRow ? '如：昌岗派出所-M4T' : '如：南洲充电机场-M4TD无人机'}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="ui-btn-secondary">取消</button>
              <button onClick={saveEdit} disabled={editLoading} className="ui-btn-primary disabled:opacity-50">
                <Save size={14} />
                {editLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
