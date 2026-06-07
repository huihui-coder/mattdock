import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  HardDrive, Plus, Pencil, Trash2, X, Save, Search, Download,
  RefreshCw, Plane, Radio, ChevronRight, AlertCircle, Link2,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import RegionLabel from './RegionLabel'
import ListPagination, { paginateSlice } from './ListPagination'
import { isScopeAll } from '../lib/scope-query'
import * as XLSX from 'xlsx'

const CATEGORY_LABELS = {
  airport: '自动机场',
  airport_drone: '机库无人机',
  single: '单兵无人机',
  remote: '遥控器',
  unknown: '未分类',
}

const SOURCE_LABELS = {
  builtin: '内置',
  env: '环境变量',
  custom: '自定义',
  unmapped: '未映射',
  learned: '在线学习',
}

const ADD_CATEGORY_OPTIONS = [
  { value: 'airport', label: '自动机场' },
  { value: 'airport_drone', label: '机库无人机（未绑机场时）' },
  { value: 'single', label: '单兵无人机' },
  { value: 'remote', label: '遥控器' },
]

const PIE_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706']

const ONLINE_TABS = [
  { id: 'all', label: '全部' },
  { id: 'online', label: '在线' },
  { id: 'offline', label: '离线' },
]

const PAGE_SIZE_DEFAULT = 20

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() } })
}

function OnlineBadge({ online, statusText }) {
  if (online) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        在线
      </span>
    )
  }
  return <span className="text-xs text-slate-500">{statusText || '离线'}</span>
}

function SourceBadge({ source }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
      source === 'custom' ? 'bg-blue-50 text-blue-700' :
      source === 'unmapped' ? 'bg-amber-50 text-amber-700' :
      source === 'learned' ? 'bg-violet-50 text-violet-700' :
      'bg-slate-100 text-slate-600'
    }`}>
      {SOURCE_LABELS[source] || source}
    </span>
  )
}

function StatCard({ label, total, online, icon: Icon, accent }) {
  const accents = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
  }
  return (
    <div className="ui-card p-4 flex items-center gap-3 cursor-default">
      <span className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${accents[accent]}`}>
        <Icon size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xl font-semibold text-slate-800 tabular-nums mt-0.5">{total}</p>
        <p className="text-xs text-emerald-600 tabular-nums">在线 {online}</p>
      </div>
      <ChevronRight size={16} className="text-slate-300 shrink-0" />
    </div>
  )
}

function findPairContext(deviceId, pairs, singlePairs) {
  for (const pair of pairs) {
    if (pair.airportSn === deviceId) return { pair, pairKind: 'airport', device: pair.airport }
    if (pair.drone?.deviceId === deviceId) return { pair, pairKind: 'airport', device: pair.drone }
  }
  for (const pair of singlePairs) {
    if (pair.remoteSn === deviceId) return { pair, pairKind: 'single', device: pair.remote }
    if (pair.drone?.deviceId === deviceId) return { pair, pairKind: 'single', device: pair.drone }
  }
  return { pair: null, pairKind: 'single', device: null }
}

function isAlertDevice(d) {
  if (!d) return false
  return d.source === 'unmapped' || d.category === 'unknown'
}

const BINDING_LABELS = {
  builtin: '内置绑定',
  custom: '自定义',
  learned: '在线学习',
}

function StackedCell({ primary, secondary, mono = false, subMuted = true }) {
  return (
    <div className="min-w-0">
      <div className={`truncate ${mono ? 'font-mono text-xs text-slate-700' : 'font-medium text-slate-800'}`} title={primary}>
        {primary || '—'}
      </div>
      {secondary != null && (
        <div
          className={`mt-1.5 pl-3 border-l border-slate-200 truncate ${
            mono ? 'font-mono text-[11px] text-slate-500' : subMuted ? 'text-sm text-slate-500' : 'text-sm text-slate-700'
          }`}
          title={secondary}
        >
          {secondary || '—'}
        </div>
      )}
    </div>
  )
}

function matchKeyword(text, q) {
  return String(text || '').toLowerCase().includes(q)
}

function pairMatchesSearch(pair, kind, q) {
  if (!q) return true
  if (kind === 'airport') {
    return [pair.airportSn, pair.airport?.name, pair.dockModel, pair.droneSn, pair.drone?.name, pair.droneModel]
      .some((v) => matchKeyword(v, q))
  }
  return [pair.remoteSn, pair.remote?.name, pair.remoteModel, pair.droneSn, pair.drone?.name, pair.droneModel]
    .some((v) => matchKeyword(v, q))
}

function deviceMatchesSearch(d, q) {
  if (!q) return true
  return [d.deviceId, d.name, d.statusText].some((v) => matchKeyword(v, q))
}

function pairPrimary(pair, kind) {
  return kind === 'airport' ? pair.airport : pair.remote
}

function pairMatchesOnlineTab(pair, kind, onlineTab) {
  if (onlineTab === 'all') return true
  const primary = pairPrimary(pair, kind)
  if (onlineTab === 'online') return !!primary?.online
  if (onlineTab === 'offline') return !primary?.online
  return true
}

function pairHasAlert(pair, kind) {
  const primary = pairPrimary(pair, kind)
  return isAlertDevice(primary) || (pair.drone && isAlertDevice(pair.drone))
}

function deviceMatchesOnlineTab(d, onlineTab) {
  if (onlineTab === 'all') return true
  if (onlineTab === 'online') return !!d.online
  if (onlineTab === 'offline') return !d.online
  return true
}

function rowMatchesOnlineTab(row, onlineTab) {
  if (row.type === 'airport_pair') return pairMatchesOnlineTab(row.pair, 'airport', onlineTab)
  if (row.type === 'single_pair') return pairMatchesOnlineTab(row.pair, 'single', onlineTab)
  return deviceMatchesOnlineTab(row.device, onlineTab)
}

function rowHasAlert(row) {
  if (row.type === 'airport_pair') return pairHasAlert(row.pair, 'airport')
  if (row.type === 'single_pair') return pairHasAlert(row.pair, 'single')
  return isAlertDevice(row.device)
}

function rowMatchesStatusFilter(row, { onlineTab = 'all', alertOnly = false } = {}) {
  if (!rowMatchesOnlineTab(row, onlineTab)) return false
  if (alertOnly && !rowHasAlert(row)) return false
  return true
}

function pairMatchesFilters(pair, kind, applied) {
  if (applied.category === 'airport' && kind !== 'airport') return false
  if (applied.category === 'single' && kind !== 'single') return false
  if (applied.category === 'remote' && kind !== 'single') return false
  if (applied.category === 'airport_drone') return false

  const primary = pairPrimary(pair, kind)
  const regionId = primary?.regionId
  if (applied.region !== 'all' && regionId !== applied.region) return false

  if (applied.source !== 'all') {
    const ok = primary?.source === applied.source || pair.drone?.source === applied.source
    if (!ok) return false
  }
  return true
}

function deviceMatchesFilters(d, applied) {
  if (applied.category !== 'all' && d.category !== applied.category) {
    if (applied.category === 'single' && !['single', 'remote'].includes(d.category)) return false
    if (applied.category !== 'single') return false
  }
  if (applied.source !== 'all' && d.source !== applied.source) return false
  if (applied.region !== 'all' && d.regionId !== applied.region) return false
  return true
}

function buildFilteredRows(pairs, singlePairs, unboundDevices, applied, statusFilter = null) {
  const q = applied.search.trim().toLowerCase()
  const rows = []

  const showAirportPairs = applied.category === 'all' || applied.category === 'airport'
  const showSinglePairs = applied.category === 'all' || applied.category === 'single' || applied.category === 'remote'
  const showUnbound = applied.category === 'all'
    || applied.category === 'airport_drone'
    || applied.category === 'single'
    || applied.category === 'remote'
    || applied.category === 'airport'

  const matchesStatus = (row) => !statusFilter || rowMatchesStatusFilter(row, statusFilter)

  if (showAirportPairs) {
    pairs.forEach((pair) => {
      if (!pairMatchesSearch(pair, 'airport', q)) return
      if (!pairMatchesFilters(pair, 'airport', applied)) return
      const row = { type: 'airport_pair', id: pair.airportSn, pair }
      if (!matchesStatus(row)) return
      rows.push(row)
    })
  }

  if (showSinglePairs) {
    singlePairs.forEach((pair) => {
      if (!pairMatchesSearch(pair, 'single', q)) return
      if (!pairMatchesFilters(pair, 'single', applied)) return
      const row = { type: 'single_pair', id: pair.remoteSn, pair }
      if (!matchesStatus(row)) return
      rows.push(row)
    })
  }

  if (showUnbound) {
    unboundDevices.forEach((d) => {
      if (!deviceMatchesSearch(d, q)) return
      if (!deviceMatchesFilters(d, applied)) return
      const row = { type: 'device', id: d.deviceId, device: d }
      if (!matchesStatus(row)) return
      rows.push(row)
    })
  }

  return rows
}

function BindingPairRow({
  pair, kind, selected, onToggleSelect, onEditPrimary, onEditSecondary, onDelete,
}) {
  const isAirport = kind === 'airport'
  const primary = pairPrimary(pair, kind)
  const primarySn = isAirport ? pair.airportSn : pair.remoteSn
  const primaryModel = isAirport ? pair.dockModel : pair.remoteModel
  const secondaryModel = pair.droneModel || (isAirport ? '未绑定无人机' : '未绑定单兵')
  const secondarySn = pair.droneSn
  const secondaryName = pair.drone?.name
  const primaryName = primary?.name
  const rowId = primarySn
  const highlight = isAlertDevice(primary) || (pair.drone && isAlertDevice(pair.drone))

  return (
    <tr className={`align-top hover:bg-slate-50/80 transition-colors ${highlight ? 'bg-amber-50/40' : ''}`}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(rowId)}
          className="rounded border-slate-300 cursor-pointer"
        />
      </td>
      <td className="px-3 py-3 hidden lg:table-cell">
        <StackedCell primary={primaryModel} secondary={secondaryModel} />
      </td>
      <td className="px-3 py-3">
        <StackedCell mono primary={primarySn} secondary={secondarySn || '—'} />
      </td>
      <td className="px-3 py-3 min-w-[160px]">
        <StackedCell primary={primaryName} secondary={secondaryName || secondaryModel} />
      </td>
      <td className="px-3 py-3 hidden sm:table-cell">
        <RegionLabel regionName={primary?.regionName} regionId={primary?.regionId} />
      </td>
      <td className="px-3 py-3 hidden lg:table-cell">
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          {BINDING_LABELS[pair.bindingSource] || pair.bindingSource}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="space-y-2">
          <OnlineBadge online={primary?.online} statusText={primary?.statusText} />
          {pair.drone && (
            <div className="pl-3 border-l border-slate-200">
              <OnlineBadge online={pair.drone.online} statusText={pair.drone.statusText} />
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={onEditPrimary} title="编辑"
              className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors">
              <Pencil size={14} />
            </button>
            {primary?.source === 'custom' && onDelete && (
              <button type="button" onClick={() => onDelete(primary.deviceId)} title="删除"
                className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {pair.drone && (
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={onEditSecondary} title="编辑绑定设备"
                className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors">
                <Pencil size={13} />
              </button>
              {pair.drone.source === 'custom' && onDelete && (
                <button type="button" onClick={() => onDelete(pair.drone.deviceId)} title="删除"
                  className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function SimpleDeviceRow({ device, selected, onToggleSelect, onEdit, onDelete }) {
  return (
    <tr className={`hover:bg-slate-50/80 transition-colors ${isAlertDevice(device) ? 'bg-amber-50/40' : ''}`}>
      <td className="px-4 py-2.5">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(device.deviceId)}
          className="rounded border-slate-300 cursor-pointer" />
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-slate-600">
        {CATEGORY_LABELS[device.category] || device.category}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-500 max-w-[140px] truncate" title={device.deviceId}>
        {device.deviceId}
      </td>
      <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[180px] truncate" title={device.name}>
        {device.source === 'unmapped' ? <span className="text-amber-700">{device.deviceId}</span> : device.name}
      </td>
      <td className="px-3 py-2.5 hidden sm:table-cell">
        <RegionLabel regionName={device.regionName} regionId={device.regionId} />
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell"><SourceBadge source={device.source} /></td>
      <td className="px-3 py-2.5"><OnlineBadge online={device.online} statusText={device.statusText} /></td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-0.5">
          <button type="button" onClick={() => onEdit(device)} title="编辑"
            className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors">
            <Pencil size={14} />
          </button>
          {device.source === 'custom' && onDelete && (
            <button type="button" onClick={() => onDelete(device.deviceId)} title="删除"
              className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function buildBoundDeviceIds(pairs, singlePairs) {
  const ids = new Set()
  pairs.forEach((p) => {
    ids.add(p.airportSn)
    if (p.droneSn) ids.add(p.droneSn)
  })
  singlePairs.forEach((p) => {
    ids.add(p.remoteSn)
    if (p.droneSn) ids.add(p.droneSn)
  })
  return ids
}

export default function DeviceManager({ scopeRegionId }) {
  const [pairs, setPairs] = useState([])
  const [singlePairs, setSinglePairs] = useState([])
  const [allDevices, setAllDevices] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [draftSearch, setDraftSearch] = useState('')
  const [applied, setApplied] = useState({
    search: '',
    category: 'all',
    source: 'all',
    region: 'all',
  })
  const [onlineTab, setOnlineTab] = useState('all')
  const [alertOnly, setAlertOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [selectedIds, setSelectedIds] = useState(new Set())

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ deviceId: '', name: '', category: 'single' })
  const [formLoading, setFormLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({
    name: '', category: 'single', droneSn: '', droneName: '', regionId: '', regionName: '',
  })
  const [editLoading, setEditLoading] = useState(false)

  const loadDevices = async () => {
    const params = new URLSearchParams()
    if (scopeRegionId && !isScopeAll(scopeRegionId)) params.set('scopeRegionId', scopeRegionId)
    const res = await apiFetch(`/api/device-registry?${params}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '获取设备列表失败')
    setPairs(data.pairs || [])
    setSinglePairs(data.singlePairs || [])
    setAllDevices(data.devices || [])
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await loadDevices()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [scopeRegionId])

  useEffect(() => { refresh() }, [refresh])

  const regions = useMemo(() => {
    const map = new Map()
    allDevices.forEach((d) => {
      if (d.regionId) map.set(d.regionId, d.regionName || d.regionId)
    })
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [allDevices])

  const stats = useMemo(() => {
    const byCat = (cat) => allDevices.filter((d) => d.category === cat)
    const online = (list) => list.filter((d) => d.online).length
    return {
      airport: { total: byCat('airport').length, online: online(byCat('airport')) },
      airport_drone: { total: byCat('airport_drone').length, online: online(byCat('airport_drone')) },
      single: { total: byCat('single').length, online: online(byCat('single')) },
      remote: { total: byCat('remote').length, online: online(byCat('remote')) },
    }
  }, [allDevices])

  const boundDeviceIds = useMemo(
    () => buildBoundDeviceIds(pairs, singlePairs),
    [pairs, singlePairs],
  )

  const unboundDevices = useMemo(
    () => allDevices.filter((d) => !boundDeviceIds.has(d.deviceId)),
    [allDevices, boundDeviceIds],
  )

  const filteredRowsBase = useMemo(
    () => buildFilteredRows(pairs, singlePairs, unboundDevices, applied),
    [pairs, singlePairs, unboundDevices, applied],
  )

  const statusFilter = useMemo(
    () => ({ onlineTab, alertOnly }),
    [onlineTab, alertOnly],
  )

  const listRows = useMemo(
    () => buildFilteredRows(pairs, singlePairs, unboundDevices, applied, statusFilter),
    [pairs, singlePairs, unboundDevices, applied, statusFilter],
  )

  const tabCounts = useMemo(() => ({
    all: filteredRowsBase.length,
    online: filteredRowsBase.filter((r) => rowMatchesOnlineTab(r, 'online')).length,
    offline: filteredRowsBase.filter((r) => rowMatchesOnlineTab(r, 'offline')).length,
    alert: filteredRowsBase.filter((r) => rowHasAlert(r)).length,
  }), [filteredRowsBase])

  useEffect(() => { setPage(1) }, [applied, onlineTab, alertOnly, allDevices.length])

  const pagedRows = useMemo(
    () => paginateSlice(listRows, page, pageSize),
    [listRows, page, pageSize],
  )

  const showPairColumns = useMemo(
    () => listRows.some((r) => r.type === 'airport_pair' || r.type === 'single_pair'),
    [listRows],
  )

  const alertDevices = useMemo(
    () => allDevices.filter(isAlertDevice).slice(0, 6),
    [allDevices],
  )

  const pieData = useMemo(() => {
    const keys = ['airport', 'airport_drone', 'single', 'remote']
    const total = allDevices.length || 1
    return keys
      .map((k) => ({ key: k, name: CATEGORY_LABELS[k], value: allDevices.filter((d) => d.category === k).length }))
      .filter((d) => d.value > 0)
      .map((d) => ({ ...d, pct: Math.round((d.value / total) * 1000) / 10 }))
  }, [allDevices])

  const applyFilters = () => setApplied((prev) => ({ ...prev, search: draftSearch }))
  const resetFilters = () => {
    setDraftSearch('')
    setApplied({ search: '', category: 'all', source: 'all', region: 'all' })
    setOnlineTab('all')
    setAlertOnly(false)
  }

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === pagedRows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pagedRows.map((r) => r.id)))
    }
  }

  const exportExcel = () => {
    const rows = listRows.flatMap((row, i) => {
      if (row.type === 'airport_pair') {
        const p = row.pair
        return [
          {
            序号: i + 1,
            绑定类型: '自动机场',
            设备名称: p.airport?.name,
            SN: p.airportSn,
            绑定设备: p.drone?.name || '',
            绑定SN: p.droneSn || '',
            区域: p.airport?.regionName || '',
            机场在线: p.airport?.online ? '在线' : '离线',
            无人机在线: p.drone?.online ? '在线' : '离线',
          },
        ]
      }
      if (row.type === 'single_pair') {
        const p = row.pair
        return [{
          序号: i + 1,
          绑定类型: '单兵',
          设备名称: p.remote?.name,
          SN: p.remoteSn,
          绑定设备: p.drone?.name || '',
          绑定SN: p.droneSn || '',
          区域: p.remote?.regionName || '',
          遥控器在线: p.remote?.online ? '在线' : '离线',
          无人机在线: p.drone?.online ? '在线' : '离线',
        }]
      }
      const d = row.device
      return [{
        序号: i + 1,
        绑定类型: '未绑定',
        设备名称: d.name || d.deviceId,
        SN: d.deviceId,
        类型: CATEGORY_LABELS[d.category] || d.category,
        区域: d.regionName || d.regionId || '',
        在线状态: d.online ? '在线' : (d.statusText || '离线'),
      }]
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '设备列表')
    XLSX.writeFile(wb, `设备列表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`)
  }

  const openAdd = () => {
    setForm({ deviceId: '', name: '', category: applied.category === 'airport' ? 'airport' : 'single' })
    setError('')
    setAddOpen(true)
  }

  const submitAdd = async (e) => {
    e.preventDefault()
    setFormLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/device-registry', { method: 'POST', body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '添加失败')
      setAddOpen(false)
      setForm({ deviceId: '', name: '', category: 'single' })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
    setFormLoading(false)
  }

  const openEditDevice = (device, pair = null, pairKind = null) => {
    const ctx = pair && pairKind
      ? { pair, pairKind }
      : findPairContext(device.deviceId, pairs, singlePairs)
    const resolvedPair = ctx.pair
    const resolvedKind = ctx.pairKind
    setEditing(device.deviceId)
    const isAirportRow = resolvedKind === 'airport' && device.category === 'airport'
    const isRemoteRow = resolvedKind === 'single' && device.category === 'remote'
    setEditForm({
      name: device.name,
      category: device.category,
      droneSn: resolvedPair?.droneSn || '',
      droneName: resolvedPair?.drone?.name || '',
      regionId: device.regionId || resolvedPair?.regionId || '',
      regionName: device.regionName || resolvedPair?.regionName || '',
      pairAirportSn: resolvedKind === 'airport' ? (resolvedPair?.airportSn || (isAirportRow ? device.deviceId : null)) : null,
      pairRemoteSn: resolvedKind === 'single' ? (resolvedPair?.remoteSn || (isRemoteRow ? device.deviceId : null)) : null,
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
          { method: 'PUT', body: JSON.stringify({ droneSn: editForm.droneSn.trim(), droneName: editForm.droneName.trim() || undefined }) },
        )
        const bindData = await bindRes.json()
        if (!bindRes.ok) throw new Error(bindData.error || '保存绑定失败')
      }

      if (editForm.isRemoteRow && editForm.pairRemoteSn) {
        const bindRes = await apiFetch(
          `/api/device-registry/remote-bindings/${encodeURIComponent(editForm.pairRemoteSn)}`,
          { method: 'PUT', body: JSON.stringify({ droneSn: editForm.droneSn.trim(), droneName: editForm.droneName.trim() || undefined }) },
        )
        const bindData = await bindRes.json()
        if (!bindRes.ok) throw new Error(bindData.error || '保存单兵绑定失败')
      }

      setEditing(null)
      await refresh()
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
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 tracking-tight">设备管理</h1>
          <p className="text-sm text-slate-500 mt-0.5">统一管理自动机场、机库无人机、单兵与遥控器设备映射</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="搜索 SN / 名称"
              className="ui-input !pl-9 !py-2 text-sm w-full lg:w-56"
            />
          </div>
          <button type="button" onClick={openAdd} className="ui-btn-primary !py-2 cursor-pointer">
            <Plus size={15} />
            添加映射
          </button>
          <button type="button" onClick={exportExcel} disabled={!listRows.length}
            className="ui-btn-secondary !py-2 cursor-pointer disabled:opacity-40">
            <Download size={14} />
            导出
          </button>
        </div>
      </div>

      {error && !addOpen && !editing && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* KPI 卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="自动机场" total={stats.airport.total} online={stats.airport.online} icon={HardDrive} accent="blue" />
        <StatCard label="机库无人机" total={stats.airport_drone.total} online={stats.airport_drone.online} icon={Plane} accent="violet" />
        <StatCard label="单兵无人机" total={stats.single.total} online={stats.single.online} icon={Plane} accent="emerald" />
        <StatCard label="遥控器" total={stats.remote.total} online={stats.remote.online} icon={Radio} accent="amber" />
      </div>

      {/* 筛选栏 */}
      <div className="ui-card px-4 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <select
              value={applied.category}
              onChange={(e) => setApplied((p) => ({ ...p, category: e.target.value }))}
              className="ui-input !w-auto !py-2 !pr-8 min-w-[108px] cursor-pointer text-sm"
            >
              <option value="all">设备类型</option>
              <option value="airport">自动机场</option>
              <option value="airport_drone">机库无人机</option>
              <option value="single">单兵无人机</option>
              <option value="remote">遥控器</option>
            </select>
            <select
              value={applied.source}
              onChange={(e) => setApplied((p) => ({ ...p, source: e.target.value }))}
              className="ui-input !w-auto !py-2 !pr-8 min-w-[96px] cursor-pointer text-sm"
            >
              <option value="all">来源</option>
              <option value="builtin">内置</option>
              <option value="custom">自定义</option>
              <option value="learned">在线学习</option>
              <option value="unmapped">未映射</option>
            </select>
            {regions.length > 1 && (
              <select
                value={applied.region}
                onChange={(e) => setApplied((p) => ({ ...p, region: e.target.value }))}
                className="ui-input !w-auto !py-2 !pr-8 min-w-[96px] cursor-pointer text-sm"
              >
                <option value="all">区域</option>
                {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={resetFilters} className="ui-btn-ghost !text-xs cursor-pointer">重置</button>
            <button type="button" onClick={applyFilters} className="ui-btn-primary !text-xs !py-2 cursor-pointer">查询</button>
          </div>
        </div>
      </div>

      {/* 主区域 */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        {/* 设备列表 */}
        <section className="ui-card overflow-hidden xl:col-span-3 flex flex-col min-h-[480px]">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {ONLINE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setOnlineTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    onlineTab === tab.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1 tabular-nums ${onlineTab === tab.id ? 'text-blue-100' : 'text-slate-400'}`}>
                    ({tabCounts[tab.id]})
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAlertOnly((v) => !v)}
              aria-pressed={alertOnly}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                alertOnly
                  ? 'bg-amber-600 text-white border-amber-600 shadow-sm shadow-amber-600/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-800'
              }`}
            >
              告警
              <span className={`ml-1 tabular-nums ${alertOnly ? 'text-amber-100' : 'text-slate-400'}`}>
                ({tabCounts.alert})
              </span>
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              aria-label="刷新"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-x-auto">
            {loading && !allDevices.length ? (
              <p className="py-16 text-center text-sm text-slate-500">加载中…</p>
            ) : !listRows.length ? (
              <p className="py-16 text-center text-sm text-slate-500">暂无匹配设备</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white z-[1]">
                  <tr className="text-xs text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-2.5 w-10">
                      <input
                        type="checkbox"
                        checked={pagedRows.length > 0 && selectedIds.size === pagedRows.length}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-300 cursor-pointer"
                        aria-label="全选当前页"
                      />
                    </th>
                    {showPairColumns ? (
                      <>
                        <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell w-[140px]">设备型号</th>
                        <th className="px-3 py-2.5 text-left font-medium">SN</th>
                        <th className="px-3 py-2.5 text-left font-medium min-w-[160px]">名称</th>
                        <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell w-20">区域</th>
                        <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell w-24">
                          <span className="inline-flex items-center gap-1"><Link2 size={12} />绑定</span>
                        </th>
                        <th className="px-3 py-2.5 text-left font-medium w-24">在线</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell">类型</th>
                        <th className="px-3 py-2.5 text-left font-medium">SN</th>
                        <th className="px-3 py-2.5 text-left font-medium">名称</th>
                        <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell w-20">区域</th>
                        <th className="px-3 py-2.5 text-left font-medium hidden lg:table-cell w-20">来源</th>
                        <th className="px-3 py-2.5 text-left font-medium w-20">在线</th>
                      </>
                    )}
                    <th className="px-4 py-2.5 text-right font-medium w-24">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pagedRows.map((row) => {
                    if (row.type === 'airport_pair') {
                      return (
                        <BindingPairRow
                          key={row.id}
                          pair={row.pair}
                          kind="airport"
                          selected={selectedIds.has(row.id)}
                          onToggleSelect={toggleSelect}
                          onEditPrimary={() => openEditDevice(row.pair.airport, row.pair, 'airport')}
                          onEditSecondary={() => row.pair.drone && openEditDevice(row.pair.drone, row.pair, 'airport')}
                          onDelete={removeOverride}
                        />
                      )
                    }
                    if (row.type === 'single_pair') {
                      return (
                        <BindingPairRow
                          key={row.id}
                          pair={row.pair}
                          kind="single"
                          selected={selectedIds.has(row.id)}
                          onToggleSelect={toggleSelect}
                          onEditPrimary={() => openEditDevice(row.pair.remote, row.pair, 'single')}
                          onEditSecondary={() => row.pair.drone && openEditDevice(row.pair.drone, row.pair, 'single')}
                          onDelete={removeOverride}
                        />
                      )
                    }
                    return (
                      <SimpleDeviceRow
                        key={row.id}
                        device={row.device}
                        selected={selectedIds.has(row.id)}
                        onToggleSelect={toggleSelect}
                        onEdit={openEditDevice}
                        onDelete={removeOverride}
                      />
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <ListPagination
            total={listRows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            className="px-4 py-3 border-t border-slate-100 shrink-0"
          />
        </section>

        {/* 右侧 */}
        <div className="xl:col-span-1 space-y-4">
          <section className="ui-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <AlertCircle size={15} className="text-amber-500" />
                告警设备
                <span className="text-slate-400 font-normal">({tabCounts.alert})</span>
              </h2>
              {tabCounts.alert > 0 && (
                <button type="button" onClick={() => setAlertOnly(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer transition-colors">
                  查看全部
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-50">
              {alertDevices.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">暂无告警设备</p>
              ) : alertDevices.map((d) => (
                <button
                  key={d.deviceId}
                  type="button"
                  onClick={() => { setAlertOnly(true); openEditDevice(d) }}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{d.name || d.deviceId}</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {d.source === 'unmapped' ? '未映射设备' : '状态异常'}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="ui-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">设备类型分布</h2>
            </div>
            <div className="p-4">
              {pieData.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">暂无数据</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={2}>
                        {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(val, name) => [`${val} 台`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1.5">
                    {pieData.map((d, i) => (
                      <div key={d.key} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-slate-600">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          {d.name}
                        </span>
                        <span className="text-slate-500 tabular-nums">{d.pct}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 添加弹窗 */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setAddOpen(false); setError('') }}>
          <div className="ui-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Plus size={18} />
                <h3 className="ui-section-title">添加 / 覆盖映射</h3>
              </div>
              <button type="button" onClick={() => setAddOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              绑定关系请在列表中编辑设备；此处用于新增未入库设备。
            </p>
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
            <form onSubmit={submitAdd} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">设备 SN</label>
                <input value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value.trim() })}
                  placeholder="1581F... / AHRXN..." className="ui-input font-mono text-sm w-full" required autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">显示名称</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：昌岗派出所-M4T" className="ui-input w-full" required />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">设备类型</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="ui-input w-full cursor-pointer">
                  {ADD_CATEGORY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAddOpen(false)} className="ui-btn-secondary cursor-pointer">取消</button>
                <button type="submit" disabled={formLoading} className="ui-btn-primary disabled:opacity-50 cursor-pointer">
                  <Save size={14} />
                  {formLoading ? '保存中…' : '保存映射'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="ui-card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HardDrive size={18} />
                <h3 className="ui-section-title">编辑设备</h3>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs font-mono text-slate-500 mb-4 break-all">{editing}</p>
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">区域</div>
                <div className="ui-input flex items-center gap-2 bg-slate-50 text-slate-700 cursor-default !py-2">
                  {editForm.regionId || editForm.regionName ? (
                    <RegionLabel regionName={editForm.regionName} regionId={editForm.regionId} />
                  ) : (
                    <span className="text-sm text-slate-400">未分配</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">显示名称</div>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="ui-input" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-700 mb-2">设备类型</div>
                <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="ui-input cursor-pointer">
                  {ADD_CATEGORY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              {(editForm.isAirportRow || editForm.isRemoteRow) && (
                <>
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-2">
                      {editForm.isRemoteRow ? '绑定单兵无人机 SN' : '绑定无人机 SN'}
                    </div>
                    <input value={editForm.droneSn} onChange={(e) => setEditForm({ ...editForm, droneSn: e.target.value.trim() })}
                      className="ui-input font-mono text-sm" placeholder="1581F..." />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-700 mb-2">绑定无人机名称（可选）</div>
                    <input value={editForm.droneName} onChange={(e) => setEditForm({ ...editForm, droneName: e.target.value })} className="ui-input" />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
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
