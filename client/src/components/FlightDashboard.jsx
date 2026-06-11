import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Plane, Navigation, Clock, RefreshCw, CheckCircle2, Loader2,
  Download, FlaskConical, PieChart, ChevronRight, TrendingUp, TrendingDown,
  Inbox, Radio, X,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import ListPagination from './ListPagination'
import DateTimeRangePicker, { toDatetimeLocal } from './DateTimeRangePicker'
import * as XLSX from 'xlsx'
import { logClientAudit } from '../lib/audit-client'
import RegionLabel from './RegionLabel'
import { withScopeQuery, isScopeAll, isScopeUnmapped, deviceMqttProfileKey } from '../lib/scope-query'

function getToken() { return localStorage.getItem('auth_token') || '' }
function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

const getRecordDeviceName = (r) => (r.deviceName || r.deviceId || '').replace(/-无人机$/, '')

const PAGE_SIZE_DEFAULT = 10

const DEVICE_OPTIONS = [
  { id: 'all', label: '全部设备' },
  { id: 'airport', label: '自动机场' },
  { id: 'single', label: '单兵无人机' },
  { id: 'virtual', label: '虚拟机场' },
]

const CHART_TABS = [
  { id: 'count', label: '次数分布' },
  { id: 'mileage', label: '里程分布' },
  { id: 'duration', label: '时长分布' },
]

function datetimeRangeToQuery([startDt, endDt]) {
  const startTime = startDt ? new Date(startDt).toISOString() : ''
  let endTime = ''
  if (endDt) {
    const endDate = new Date(endDt)
    const now = new Date()
    endTime = (endDate.getTime() > now.getTime() ? now : endDate).toISOString()
  }
  return { startTime, endTime }
}

function prevPeriodRange(startTime, endTime) {
  if (!startTime || !endTime) return null
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  const span = end - start
  if (span <= 0) return null
  return {
    startTime: new Date(start - span).toISOString(),
    endTime: new Date(start - 1).toISOString(),
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatMileageKm(m) {
  return m > 1000 ? `${(m / 1000).toFixed(2)}` : `${(m / 1000).toFixed(3)}`
}

function formatMileage(m) {
  return m > 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

function formatTime(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function formatChartDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function trendPct(current, previous) {
  if (previous == null || previous === 0) return current > 0 ? 100 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

const MAX_FLIGHT_MILEAGE_M = 1_000_000

function isValidFlightRecord(record) {
  const mileage = record.totalMileage || 0
  const duration = record.totalDuration || 0
  if (mileage <= 0 || duration <= 5) return false
  if (mileage > MAX_FLIGHT_MILEAGE_M) return false
  return true
}

function StatusBadge({ record }) {
  if (record.status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        进行中
      </span>
    )
  }
  if (!isValidFlightRecord(record)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        无效
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <CheckCircle2 size={13} className="text-emerald-500" />
      已完成
    </span>
  )
}

const KPI_ACCENTS = {
  blue: 'bg-blue-500',
  purple: 'bg-violet-500',
  green: 'bg-emerald-500',
  orange: 'bg-amber-500',
}

function KpiCard({ label, value, sub, trend, icon: Icon, accent = 'blue' }) {
  const up = trend != null && trend >= 0
  return (
    <div className="ui-card p-4 flex items-center gap-4">
      <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white shadow-sm ${KPI_ACCENTS[accent]}`}>
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5 tabular-nums tracking-tight">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        {trend != null && (
          <p className={`text-xs mt-1 inline-flex items-center gap-0.5 font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
            较上周期 {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {up ? '↑' : '↓'} {Math.abs(trend)}%
          </p>
        )}
      </div>
    </div>
  )
}

function FlightTrendChart({ daily, chartMetric, loading }) {
  const data = useMemo(() => (daily || []).map((d) => ({
    ...d,
    label: formatChartDate(d.date),
    mileageKm: Math.round((d.mileage / 1000) * 100) / 100,
    durationMin: Math.round(d.duration / 60),
  })), [daily])

  const yKey = chartMetric === 'mileage' ? 'mileageKm' : chartMetric === 'duration' ? 'durationMin' : 'count'
  const yLabel = chartMetric === 'mileage' ? 'km' : chartMetric === 'duration' ? '分钟' : '次'

  if (loading && !data.length) {
    return <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">加载中…</div>
  }
  if (!data.length) {
    return <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">暂无趋势数据</div>
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}
          formatter={(val) => [`${val} ${yLabel}`, '']}
          labelFormatter={(l) => l}
        />
        <Line type="monotone" dataKey={yKey} stroke="#3B82F6" strokeWidth={2} dot={{ r: 3, fill: '#3B82F6', strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function RankingTable({ rows, limit, onViewAll, stretch = false }) {
  const list = limit ? rows.slice(0, limit) : rows
  if (!list.length) {
    return (
      <p className={`text-sm text-slate-400 py-8 text-center ${stretch ? 'flex-1 flex items-center justify-center' : ''}`}>
        暂无排名数据
      </p>
    )
  }
  return (
    <div className={stretch ? 'flex flex-col flex-1 min-h-0' : undefined}>
      <div className={stretch ? 'overflow-x-auto flex-1' : 'overflow-x-auto'}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2.5 pl-4 pr-2 text-left font-medium w-12">排名</th>
              <th className="py-2.5 px-2 text-left font-medium">设备名称</th>
              <th className="py-2.5 px-2 text-right font-medium whitespace-nowrap">飞行次数</th>
              <th className="py-2.5 px-2 text-right font-medium whitespace-nowrap">里程(km)</th>
              <th className="py-2.5 pr-4 pl-2 text-right font-medium whitespace-nowrap">时长</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {list.map((r, i) => (
              <tr key={r.deviceId} className="hover:bg-slate-50/60 transition-colors">
                <td className="py-2.5 pl-4 pr-2">
                  <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                    i < 3 ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'bg-slate-100 text-slate-500'
                  }`}>{i + 1}</span>
                </td>
                <td className="py-2.5 px-2 font-medium text-slate-800 max-w-[140px] truncate" title={r.deviceName}>
                  {r.deviceName || r.deviceId}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-600 tabular-nums">{r.count}</td>
                <td className="py-2.5 px-2 text-right text-slate-600 tabular-nums">{formatMileageKm(r.mileage)}</td>
                <td className="py-2.5 pr-4 pl-2 text-right text-slate-600 font-mono tabular-nums text-xs">
                  {formatDuration(r.duration)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit && rows.length > limit && onViewAll && (
        <div className={`py-3 text-center border-t border-slate-100 ${stretch ? 'mt-auto shrink-0' : ''}`}>
          <button type="button" onClick={onViewAll}
            className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5 cursor-pointer transition-colors">
            查看全部设备排行
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

export default function FlightDashboard({ onFlightViewChange, user, scopeRegionId }) {
  const nowLocal = toDatetimeLocal(new Date())
  const weekStart = new Date(Date.now() - 6 * 86400000)
  weekStart.setHours(0, 0, 0, 0)
  const initStart = toDatetimeLocal(weekStart)
  const initEnd = nowLocal

  const [applied, setApplied] = useState({ dates: [initStart, initEnd], deviceType: 'all' })

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [stats, setStats] = useState({ count: 0, mileage: 0, duration: 0 })
  const [prevStats, setPrevStats] = useState(null)
  const [records, setRecords] = useState([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [activeCount, setActiveCount] = useState(0)
  const [onlineCount, setOnlineCount] = useState(0)
  const [ranking, setRanking] = useState([])
  const [daily, setDaily] = useState([])
  const [chartMetric, setChartMetric] = useState('count')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [rankingOpen, setRankingOpen] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [mqttTab, setMqttTab] = useState('all')
  const [mqttProfiles, setMqttProfiles] = useState([])
  const recordsRef = useRef(null)
  const refreshRef = useRef(null)

  const { startTime, endTime } = datetimeRangeToQuery(applied.dates)
  const unmappedScope = isScopeUnmapped(scopeRegionId)
  const showRegionColumn = !unmappedScope && isScopeAll(scopeRegionId) && (user?.leafRegions?.length || 0) > 1
  const showMqttColumn = unmappedScope

  const buildApiUrl = useCallback((path, extra = '') => {
    const mqttQuery = unmappedScope && mqttTab !== 'all'
      ? `&mqttProfileId=${encodeURIComponent(mqttTab)}`
      : ''
    const base = `${path}?type=${applied.deviceType}&startTime=${startTime}&endTime=${endTime}${mqttQuery}${extra}`
    return withScopeQuery(base, scopeRegionId)
  }, [applied.deviceType, startTime, endTime, scopeRegionId, unmappedScope, mqttTab])

  useEffect(() => { setMqttTab('all') }, [scopeRegionId])

  useEffect(() => {
    if (!unmappedScope) {
      setMqttProfiles([])
      return
    }
    apiFetch('/api/mqtt-profiles')
      .then((res) => res.json())
      .then((data) => setMqttProfiles(data.profiles || []))
      .catch(() => setMqttProfiles([]))
  }, [unmappedScope])

  useEffect(() => {
    if (!onFlightViewChange) return
    const opt = DEVICE_OPTIONS.find((o) => o.id === applied.deviceType)
    onFlightViewChange({
      activeTab: applied.deviceType,
      startTime,
      endTime,
      tabLabel: opt?.label || applied.deviceType,
    })
  }, [applied, startTime, endTime, onFlightViewChange])

  const fetchSummary = async () => {
    setSummaryLoading(true)
    try {
      const prev = prevPeriodRange(startTime, endTime)
      const requests = [apiFetch(buildApiUrl('/api/flight-summary'))]
      if (prev) {
        requests.push(apiFetch(withScopeQuery(
          `/api/flight-summary?type=${applied.deviceType}&startTime=${prev.startTime}&endTime=${prev.endTime}`,
          scopeRegionId,
        )))
      }
      const [res, prevRes] = await Promise.all(requests)
      if (res.status === 401) return
      const data = await res.json()
      setStats(data.stats || { count: 0, mileage: 0, duration: 0 })
      setRanking(data.ranking || [])
      setDaily(data.daily || [])
      setOnlineCount(data.onlineCount ?? data.deviceCount ?? 0)
      setActiveCount(data.activeCount || 0)
      if (typeof data.totalRecords === 'number') setRecordsTotal(data.totalRecords)
      if (prevRes?.ok) {
        setPrevStats((await prevRes.json()).stats || null)
      } else {
        setPrevStats(null)
      }
    } catch (e) {
      console.error('获取飞行汇总失败:', e)
    } finally {
      setSummaryLoading(false)
    }
  }

  const fetchRecords = async (pageNum = page, limit = pageSize) => {
    setRecordsLoading(true)
    try {
      const res = await apiFetch(buildApiUrl('/api/flight-records', `&page=${pageNum}&limit=${limit}`))
      if (res.status === 401) return
      const data = await res.json()
      setRecords(data.records || [])
      if (typeof data.total === 'number') setRecordsTotal(data.total)
      if (typeof data.activeCount === 'number') setActiveCount(data.activeCount)
    } catch (e) {
      console.error('获取飞行记录失败:', e)
    } finally {
      setRecordsLoading(false)
    }
  }

  const refreshAll = async (resetPage = true) => {
    const nextPage = resetPage ? 1 : page
    if (resetPage) {
      setPage(1)
      setRecords([])
    }
    await Promise.all([fetchSummary(), fetchRecords(nextPage, pageSize)])
  }
  refreshRef.current = refreshAll

  const handleDatesChange = (dates) => {
    setApplied((prev) => ({ ...prev, dates: [...dates] }))
    setPage(1)
  }

  const handleDeviceTypeChange = (deviceType) => {
    setApplied((prev) => ({ ...prev, deviceType }))
    setPage(1)
  }

  useEffect(() => { refreshAll(true) }, [applied, user?.regionId, user?.username, scopeRegionId, mqttTab])

  useEffect(() => {
    if (activeCount <= 0) return undefined
    const timer = setInterval(() => refreshRef.current?.(false), 30000)
    return () => clearInterval(timer)
  }, [activeCount])

  const goToPage = (nextPage) => { setPage(nextPage); fetchRecords(nextPage, pageSize) }
  const handlePageSizeChange = (size) => { setPageSize(size); setPage(1); fetchRecords(1, size) }

  const sortedRanking = useMemo(() =>
    [...ranking].sort((a, b) => b.count - a.count || b.mileage - a.mileage),
  [ranking])

  const onlineDeviceHint = useMemo(() => {
    const parts = []
    if (onlineCount > 0) parts.push(`在线 ${onlineCount} 台`)
    if (activeCount > 0) parts.push(`飞行中 ${activeCount} 台`)
    return parts.length ? parts.join(' · ') : undefined
  }, [onlineCount, activeCount])

  const exportExcel = async () => {
    const tabLabel = DEVICE_OPTIONS.find((o) => o.id === applied.deviceType)?.label || applied.deviceType
    try {
      const res = await apiFetch(buildApiUrl('/api/flight-records', '&all=1'))
      if (!res.ok) throw new Error('导出数据获取失败')
      const data = await res.json()
      const rows = (data.records || []).map((r, i) => ({
        序号: i + 1,
        状态: r.status === 'active' ? '进行中' : (isValidFlightRecord(r) ? '已完成' : '无效'),
        设备名称: getRecordDeviceName(r),
        ...(showMqttColumn ? { MQTT: r.mqttProfileName || r.mqttSourceRegionName || '' } : {}),
        ...(showRegionColumn ? { 区域: r.regionName || r.regionId || '' } : {}),
        起飞时间: r.startTime ? new Date(r.startTime).toLocaleString('zh-CN') : '--',
        降落时间: r.status === 'active' ? '--' : (r.endTime ? new Date(r.endTime).toLocaleString('zh-CN') : '--'),
        飞行里程: formatMileage(r.totalMileage || 0),
        飞行时长: formatDuration(r.totalDuration || 0),
      }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '飞行记录')
      const filename = `飞行记录_${tabLabel}_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`
      XLSX.writeFile(wb, filename)
      logClientAudit('flight.export.records', { tabLabel, recordCount: rows.length, filename })
    } catch (e) {
      console.error('导出飞行记录失败:', e)
    }
  }

  const exportRankingExcel = () => {
    const tabLabel = DEVICE_OPTIONS.find((o) => o.id === applied.deviceType)?.label || applied.deviceType
    if (!sortedRanking.length) return
    try {
      const rows = sortedRanking.map((r, i) => ({
        排名: i + 1,
        设备名称: r.deviceName || r.deviceId || '',
        设备ID: r.deviceId || '',
        飞行次数: r.count,
        '里程(km)': formatMileageKm(r.mileage),
        飞行时长: formatDuration(r.duration),
      }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '设备排行')
      const filename = `设备排行_${tabLabel}_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.xlsx`
      XLSX.writeFile(wb, filename)
      logClientAudit('flight.export.ranking', { tabLabel, deviceCount: rows.length, filename })
    } catch (e) {
      console.error('导出设备排行失败:', e)
    }
  }

  const simulateFlight = async () => {
    setSimulating(true)
    try {
      await apiFetch('/api/simulate-flight', { method: 'POST' })
      await refreshAll(false)
    } catch (e) {
      console.error('模拟飞行失败:', e)
    } finally {
      setSimulating(false)
    }
  }

  const isRefreshing = summaryLoading || recordsLoading
  const mileageDisplay = stats.mileage > 1000
    ? `${(stats.mileage / 1000).toFixed(2)} km`
    : `${Math.round(stats.mileage)} m`

  const mqttSources = useMemo(() => {
    const map = new Map()
    mqttProfiles.forEach((p) => map.set(p.id, p.name || p.id))
    records.forEach((r) => {
      const id = deviceMqttProfileKey(r)
      const name = r.mqttProfileName || r.mqttSourceRegionName || id
      if (id) map.set(id, name)
    })
    ranking.forEach((r) => {
      const id = deviceMqttProfileKey(r)
      const name = r.mqttProfileName || r.mqttSourceRegionName || id
      if (id) map.set(id, name)
    })
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [mqttProfiles, records, ranking])

  return (
    <div className="space-y-4">
      {unmappedScope && mqttSources.length > 0 && (
        <div className="ui-card px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-dji-muted shrink-0">MQTT 连接（组织为空）</p>
            <div className="ui-nav-bar w-full sm:w-auto overflow-x-auto" role="tablist" aria-label="MQTT 连接">
              <button
                type="button"
                role="tab"
                aria-selected={mqttTab === 'all'}
                onClick={() => setMqttTab('all')}
                className={`ui-tab whitespace-nowrap cursor-pointer ${mqttTab === 'all' ? 'ui-tab-active !bg-amber-600 !shadow-amber-600/25' : 'ui-tab-inactive'}`}
              >
                全部
              </button>
              {mqttSources.map((src) => (
              <button
                  key={src.id}
                type="button"
                  role="tab"
                  aria-selected={mqttTab === src.id}
                  onClick={() => setMqttTab(src.id)}
                  className={`ui-tab whitespace-nowrap cursor-pointer ${mqttTab === src.id ? 'ui-tab-active !bg-amber-600 !shadow-amber-600/25' : 'ui-tab-inactive'}`}
                >
                  {src.name}
              </button>
              ))}
                    </div>
                  </div>
                </div>
              )}

      {/* 筛选栏 */}
      <div className="ui-card px-4 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <DateTimeRangePicker
              value={applied.dates}
              onChange={handleDatesChange}
              max={nowLocal}
            />

            <select
              value={applied.deviceType}
              onChange={(e) => handleDeviceTypeChange(e.target.value)}
              className="ui-input !w-auto !py-2 !pr-8 min-w-[108px] cursor-pointer text-sm"
            >
              {DEVICE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            </div>

          <div className="flex items-center gap-2 shrink-0">
            {applied.deviceType === 'airport' && (
              <button type="button" onClick={simulateFlight} disabled={simulating}
                className="ui-btn-ghost !text-xs !py-2 disabled:opacity-50 cursor-pointer hidden sm:inline-flex">
                <FlaskConical size={13} />
                {simulating ? '生成中…' : '模拟飞行'}
              </button>
            )}
            <button type="button" onClick={() => refreshAll(false)} disabled={isRefreshing}
              aria-label="刷新"
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer">
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="飞行次数"
          value={<>{stats.count}<span className="text-base font-medium text-slate-500 ml-1">次</span></>}
          trend={prevStats ? trendPct(stats.count, prevStats.count) : null}
          icon={Plane}
          accent="blue"
        />
        <KpiCard
          label="飞行里程"
          value={mileageDisplay}
          trend={prevStats ? trendPct(stats.mileage, prevStats.mileage) : null}
          icon={Navigation}
          accent="purple"
        />
        <KpiCard
          label="累计时长"
          value={formatDuration(stats.duration)}
          trend={prevStats ? trendPct(stats.duration, prevStats.duration) : null}
          icon={Clock}
          accent="green"
        />
        <KpiCard
          label="设备数"
          value={<>{ranking.length}<span className="text-base font-medium text-slate-500 ml-1">台</span></>}
          sub={onlineDeviceHint}
          icon={PieChart}
          accent="orange"
        />
      </div>

      {/* 主区域 */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 xl:items-stretch">
        {/* 左栏 */}
        <div className="xl:col-span-2 flex flex-col gap-4 xl:h-full">
          <section className="ui-card overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex rounded-md border border-slate-200 overflow-hidden w-fit">
                {CHART_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setChartMetric(tab.id)}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      chartMetric === tab.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                    </button>
                ))}
              </div>
            </div>
            <div className="px-2 pb-3 pt-1">
              <p className="text-xs font-medium text-slate-500 px-2 pt-2 pb-1">飞行数据概览</p>
              <FlightTrendChart daily={daily} chartMetric={chartMetric} loading={summaryLoading} />
          </div>
        </section>

          <section className="ui-card overflow-hidden flex-1 flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-slate-100 shrink-0 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-800">设备排行</h2>
              <div className="flex-1" />
              <button
                type="button"
                onClick={exportRankingExcel}
                disabled={sortedRanking.length === 0 || summaryLoading}
                className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <Download size={12} />
                导出
          </button>
            </div>
            <RankingTable
              rows={sortedRanking}
              limit={5}
              stretch
              onViewAll={() => setRankingOpen(true)}
            />
          </section>
        </div>

        {/* 右栏：最新飞行记录 */}
        <section ref={recordsRef} className="ui-card overflow-hidden xl:col-span-3 flex flex-col min-h-[480px] xl:h-full">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-800">最新飞行记录</h2>
            <div className="flex-1" />
            {recordsLoading && <Loader2 size={14} className="text-blue-600 animate-spin" />}
            <button type="button" onClick={() => recordsRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer transition-colors">
              查看全部
            </button>
            <button type="button" onClick={exportExcel} disabled={recordsTotal === 0 || recordsLoading}
              className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-40">
              <Download size={12} />
              导出
            </button>
          </div>

          {recordsTotal === 0 && !recordsLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-3">
                <Inbox size={22} className="text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-700">当前时间范围内暂无飞行记录</p>
              <p className="text-xs text-slate-400 mt-1">可调整上方时间范围或设备类型</p>
          </div>
        ) : (
          <>
              <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-[1]">
                    <tr className="text-xs text-slate-400 border-b border-slate-100">
                      <th className="px-4 py-2.5 text-left font-medium w-20">状态</th>
                      <th className="px-4 py-2.5 text-left font-medium">设备</th>
                      {showMqttColumn && <th className="px-4 py-2.5 text-left font-medium">MQTT</th>}
                      {showRegionColumn && <th className="px-4 py-2.5 text-left font-medium">区域</th>}
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">起飞时间</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">里程</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">时长</th>
                  </tr>
                </thead>
                  <tbody className="divide-y divide-slate-50">
                    {recordsLoading && records.length === 0 ? (
                      Array.from({ length: 8 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="animate-pulse">
                          <td className="px-4 py-3"><div className="h-4 w-14 bg-slate-100 rounded" /></td>
                          <td className="px-4 py-3"><div className="h-4 w-36 bg-slate-100 rounded" /></td>
                          <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-100 rounded" /></td>
                          <td className="px-4 py-3"><div className="h-4 w-14 bg-slate-100 rounded ml-auto" /></td>
                          <td className="px-4 py-3"><div className="h-4 w-16 bg-slate-100 rounded ml-auto" /></td>
                      </tr>
                    ))
                    ) : records.map((r, i) => (
                      <tr key={r.id || `${r.deviceId}-${r.startTime}-${i}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-2.5"><StatusBadge record={r} /></td>
                        <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[200px] truncate" title={getRecordDeviceName(r)}>
                          {getRecordDeviceName(r)}
                        </td>
                        {showMqttColumn && (
                          <td className="px-4 py-2.5">
                            <span
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium"
                              title={r.mqttBroker || undefined}
                            >
                              <Radio size={10} aria-hidden />
                              {r.mqttProfileName || r.mqttSourceRegionName || '—'}
                            </span>
                          </td>
                        )}
                        {showRegionColumn && (
                          <td className="px-4 py-2.5"><RegionLabel regionId={r.regionId} regionName={r.regionName} /></td>
                        )}
                        <td className="px-4 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{formatTime(r.startTime)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">{formatMileage(r.totalMileage || 0)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700 font-mono tabular-nums whitespace-nowrap">{formatDuration(r.totalDuration || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <ListPagination
                total={recordsTotal}
                page={page}
                pageSize={pageSize}
                disabled={recordsLoading}
                onPageChange={goToPage}
                onPageSizeChange={handlePageSizeChange}
                className="px-4 py-3 border-t border-slate-100 mt-auto"
              />
            </>
          )}
        </section>
            </div>

      {rankingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRankingOpen(false)}>
          <div className="ui-card w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 shrink-0">
              <h3 className="text-base font-semibold text-slate-800">设备排行</h3>
              <div className="flex-1" />
              <button
                type="button"
                onClick={exportRankingExcel}
                disabled={sortedRanking.length === 0}
                className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <Download size={12} />
                导出
                  </button>
              <button type="button" onClick={() => setRankingOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer">
                <X size={18} />
                  </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <RankingTable rows={sortedRanking} />
            </div>
                </div>
              </div>
            )}
    </div>
  )
}
