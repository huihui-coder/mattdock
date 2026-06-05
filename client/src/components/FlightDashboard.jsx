import { useState, useEffect, useRef } from 'react'
import { Plane, Navigation, Clock, RefreshCw, CheckCircle2, ListChecks, Loader2, CalendarRange, ChevronDown, Download, ChevronLeft, ChevronRight, FlaskConical, Trophy, ArrowUpDown, Inbox } from 'lucide-react'
import * as XLSX from 'xlsx'

const pad = (n) => String(n).padStart(2, '0')
const toDatetimeLocal = (d) => {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const toEndOfDay = (d) => {
  const e = new Date(d)
  e.setHours(23, 59, 59, 999)
  return toDatetimeLocal(e)
}
const toDisplayStr = (dtStr) => {
  if (!dtStr) return ''
  return dtStr.replace('T', ' ')
}
const getRecordDeviceName = (r) => (r.deviceName || r.deviceId || '').replace(/-无人机$/, '')

const SHORTCUTS = [
  { label: '今日', getDates: () => { const s = new Date(); s.setHours(0,0,0,0); return [toDatetimeLocal(s), toEndOfDay(new Date())] } },
  { label: '最近一周', getDates: () => { const e = new Date(); const s = new Date(e.getTime() - 6*86400000); s.setHours(0,0,0,0); return [toDatetimeLocal(s), toDatetimeLocal(e)] } },
  { label: '最近一个月', getDates: () => { const e = new Date(); const s = new Date(e.getTime() - 29*86400000); s.setHours(0,0,0,0); return [toDatetimeLocal(s), toDatetimeLocal(e)] } },
  { label: '最近三个月', getDates: () => { const e = new Date(); const s = new Date(e.getTime() - 89*86400000); s.setHours(0,0,0,0); return [toDatetimeLocal(s), toDatetimeLocal(e)] } },
]

const PAGE_SIZE = 20

function buildFlightQueryRange(dateRange) {
  const startTime = dateRange[0] ? new Date(dateRange[0]).toISOString() : ''
  let endTime = ''
  if (dateRange[1]) {
    const endDate = new Date(dateRange[1])
    const now = new Date()
    const sameDay = endDate.getFullYear() === now.getFullYear()
      && endDate.getMonth() === now.getMonth()
      && endDate.getDate() === now.getDate()
    endTime = (sameDay ? now : endDate).toISOString()
  }
  return { startTime, endTime }
}

const TAB_LABELS = {
  airport: '自动机场',
  single: '单兵无人机',
  virtual: '虚拟机场',
  all: '全部设备',
}

const STAT_ITEMS = [
  { key: 'count', label: '飞行架次', suffix: '架次', icon: Plane, text: 'text-blue-600', iconColor: 'text-blue-400', bg: 'bg-blue-50 border-blue-100' },
  { key: 'mileage', label: '飞行里程', icon: Navigation, isMileage: true, text: 'text-indigo-600', iconColor: 'text-indigo-400', bg: 'bg-indigo-50 border-indigo-100' },
  { key: 'duration', label: '累计时长', icon: Clock, isDuration: true, text: 'text-violet-600', iconColor: 'text-violet-400', bg: 'bg-violet-50 border-violet-100' },
]

function StatCard({ item, stats, formatDuration }) {
  const Icon = item.icon
  let value = stats[item.key]
  let suffix = item.suffix || ''
  if (item.isMileage) {
    value = stats.mileage > 1000 ? (stats.mileage / 1000).toFixed(2) : Math.round(stats.mileage)
    suffix = stats.mileage > 1000 ? 'km' : 'm'
  }
  const cardClass = `${item.bg} border rounded-xl p-4`
  if (item.isDuration) {
    return (
      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-600">{item.label}</p>
            <p className={`text-2xl font-bold ${item.text} font-mono tracking-tight mt-0.5 tabular-nums`}>{formatDuration(stats.duration)}</p>
          </div>
          <Icon className={`${item.iconColor} opacity-70`} size={28} strokeWidth={1.5} />
        </div>
      </div>
    )
  }
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-600">{item.label}</p>
          <p className={`text-2xl font-bold ${item.text} mt-0.5 tabular-nums`}>
            {value}
            {suffix && <span className="text-sm font-medium text-slate-500 ml-1">{suffix}</span>}
          </p>
        </div>
        <Icon className={`${item.iconColor} opacity-70`} size={28} strokeWidth={1.5} />
      </div>
    </div>
  )
}

function StatusBadge({ record }) {
  if (record.status === 'active') {
    return (
      <span className="ui-badge bg-emerald-100 text-emerald-700 border border-emerald-200">
        <Loader2 size={10} className="animate-spin" aria-hidden />
        进行中
      </span>
    )
  }
  if ((record.totalMileage || 0) <= 0 || (record.totalDuration || 0) <= 5) {
    return (
      <span className="ui-badge bg-red-100 text-red-700 border border-red-200" title="里程为 0 或时长不超过 5 秒">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden />
        无效
      </span>
    )
  }
  return (
    <span className="ui-badge bg-slate-100 text-slate-700 border border-slate-200">
      <CheckCircle2 size={10} className="text-emerald-600" aria-hidden />
      已完成
    </span>
  )
}

export default function FlightDashboard({ onFlightViewChange }) {
  const [activeTab, setActiveTab] = useState('airport')
  const [page, setPage] = useState(1)
  const initEnd = toDatetimeLocal(new Date())
  const initStart = (() => { const s = new Date(Date.now() - 6*86400000); s.setHours(0,0,0,0); return toDatetimeLocal(s) })()
  const [dateRange, setDateRange] = useState([initStart, initEnd])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [stats, setStats] = useState({ count: 0, mileage: 0, duration: 0 })
  const [records, setRecords] = useState([])
  const [ranking, setRanking] = useState([])
  const [rankSort, setRankSort] = useState({ key: 'count', order: 'desc' })
  const [loading, setLoading] = useState(false)
  const pickerRef = useRef(null)
  const fetchStatsRef = useRef(null)
  const [simulating, setSimulating] = useState(false)

  useEffect(() => {
    const handler = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!onFlightViewChange) return
    const { startTime, endTime } = buildFlightQueryRange(dateRange)
    onFlightViewChange({
      activeTab,
      startTime,
      endTime,
      tabLabel: TAB_LABELS[activeTab] || activeTab,
    })
  }, [activeTab, dateRange, onFlightViewChange])

  const fetchStats = async (resetPage = true) => {
    setLoading(true)
    try {
      const { startTime, endTime } = buildFlightQueryRange(dateRange)
      const res = await fetch(`/api/flight-records?type=${activeTab}&startTime=${startTime}&endTime=${endTime}`)
      const data = await res.json()
      const history = data.history || []
      const all = data.records || []
      const validHistory = history.filter(r => (r.totalMileage || 0) > 0 && (r.totalDuration || 0) > 5)
      const totalMileage = validHistory.reduce((acc, cur) => acc + (cur.totalMileage || 0), 0)
      const totalDuration = validHistory.reduce((acc, cur) => acc + (cur.totalDuration || 0), 0)
      setStats({ count: validHistory.length, mileage: totalMileage, duration: totalDuration })
      setRecords(all)
      const deviceMap = new Map()
      for (const r of history) {
        if ((r.totalMileage || 0) <= 0 || (r.totalDuration || 0) <= 5) continue
        const id = r.deviceId || r.deviceName
        const name = getRecordDeviceName(r)
        if (!deviceMap.has(id)) {
          deviceMap.set(id, { deviceId: id, deviceName: name, count: 0, mileage: 0, duration: 0 })
        }
        const d = deviceMap.get(id)
        d.count += 1
        d.mileage += (r.totalMileage || 0)
        d.duration += (r.totalDuration || 0)
      }
      setRanking(Array.from(deviceMap.values()))
      if (resetPage) setPage(1)
    } catch (e) {
      console.error('获取飞行统计失败:', e)
    } finally {
      setLoading(false)
    }
  }
  fetchStatsRef.current = fetchStats

  const simulateFlight = async () => {
    setSimulating(true)
    try {
      await fetch('/api/simulate-flight', { method: 'POST' })
      await fetchStats(false)
    } catch (e) {
      console.error('模拟飞行失败:', e)
    } finally {
      setSimulating(false)
    }
  }

  const exportExcel = () => {
    const tabLabel = { airport: '自动机场', single: '单兵无人机', virtual: '虚拟机场', all: '全部设备' }[activeTab]
    const rows = records.map((r, i) => ({
      '序号': i + 1,
      '状态': r.status === 'active' ? '进行中' : '已完成',
      '设备名称': getRecordDeviceName(r),
      '起飞时间': r.startTime ? new Date(r.startTime).toLocaleString('zh-CN') : '--',
      '降落时间': r.status === 'active' ? '--' : (r.endTime ? new Date(r.endTime).toLocaleString('zh-CN') : '--'),
      '飞行里程': r.totalMileage > 1000 ? `${(r.totalMileage/1000).toFixed(2)} km` : `${Math.round(r.totalMileage || 0)} m`,
      '飞行时长': formatDuration(r.totalDuration || 0),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '飞行记录')
    const dateStr = new Date().toLocaleDateString('zh-CN').split('/').join('-')
    XLSX.writeFile(wb, `飞行记录_${tabLabel}_${dateStr}.xlsx`)
  }

  const exportRankingExcel = () => {
    const sorted = sortedRanking()
    const rows = sorted.map((r, i) => ({
      '排名': i + 1,
      '设备名称': r.deviceName || r.deviceId,
      '飞行架次': r.count,
      '累计里程': r.mileage > 1000 ? `${(r.mileage/1000).toFixed(2)} km` : `${Math.round(r.mileage)} m`,
      '累计时长': formatDuration(r.duration),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '设备排名')
    const dateStr = new Date().toLocaleDateString('zh-CN').split('/').join('-')
    const tabLabel = { airport: '自动机场', single: '单兵无人机', virtual: '虚拟机场', all: '全部设备' }[activeTab]
    XLSX.writeFile(wb, `设备排名_${tabLabel}_${dateStr}.xlsx`)
  }

  const sortedRanking = () => {
    const { key, order } = rankSort
    return [...ranking].sort((a, b) => {
      let v = 0
      if (key === 'count') v = b.count - a.count
      else if (key === 'mileage') v = b.mileage - a.mileage
      else if (key === 'duration') v = b.duration - a.duration
      return order === 'asc' ? -v : v
    })
  }

  useEffect(() => { fetchStats() }, [activeTab, dateRange])
  useEffect(() => {
    const timer = setInterval(() => fetchStatsRef.current?.(false), 30000)
    return () => clearInterval(timer)
  }, [])

  const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const formatMileage = (m) => m > 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`

  const formatTime = (iso) => {
    if (!iso) return '--'
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const tabs = [
    { id: 'airport', label: '自动机场' },
    { id: 'single', label: '单兵无人机' },
    { id: 'virtual', label: '虚拟机场' },
    { id: 'all', label: '全部设备' }
  ]

  const toggleRankSort = (key) => {
    setRankSort(s => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' }))
  }

  const btnSecondary = 'ui-btn-secondary'

  return (
    <div className="space-y-5">
      {/* 筛选工具栏 */}
      <div className="ui-card p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="ui-nav-bar" role="tablist" aria-label="设备类型">
            {tabs.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`ui-tab ${activeTab === tab.id ? 'ui-tab-active' : 'ui-tab-inactive'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={pickerRef}>
              <button
                type="button"
                onClick={() => setPickerOpen(v => !v)}
                aria-expanded={pickerOpen}
                aria-haspopup="dialog"
                className="flex items-center gap-2 ui-input !w-auto min-w-[220px] py-2 hover:border-dji-ink/30"
              >
                <CalendarRange size={15} className="text-dji-subtle shrink-0" aria-hidden />
                <span className="truncate">{toDisplayStr(dateRange[0]) || '开始时间'}</span>
                <span className="text-dji-subtle shrink-0">至</span>
                <span className="truncate">{toDisplayStr(dateRange[1]) || '结束时间'}</span>
                <ChevronDown size={14} className={`text-dji-subtle ml-auto shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>

              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 ui-card shadow-dji-sm flex overflow-hidden" style={{ minWidth: 340 }}>
                  <div className="border-r border-dji-border py-2 px-1 flex flex-col gap-0.5 shrink-0" style={{ width: 96 }}>
                    {SHORTCUTS.map(s => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => { setDateRange(s.getDates()); setPickerOpen(false) }}
                        className="text-left px-3 py-1.5 text-xs text-dji-ink hover:bg-dji-page rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20"
                      >{s.label}</button>
                    ))}
                  </div>
                  <div className="p-4 flex flex-col gap-3 min-w-0">
                    <div className="flex items-end gap-2">
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <label className="text-xs font-medium text-dji-muted">开始时间</label>
                        <input type="datetime-local" value={dateRange[0]} max={dateRange[1] || undefined}
                          onChange={e => setDateRange([e.target.value, dateRange[1]])}
                          className="ui-input py-1.5" />
                      </div>
                      <span className="text-dji-subtle pb-2 shrink-0" aria-hidden>→</span>
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <label className="text-xs font-medium text-dji-muted">结束时间</label>
                        <input type="datetime-local" value={dateRange[1]} min={dateRange[0] || undefined}
                          onChange={e => setDateRange([dateRange[0], e.target.value])}
                          className="ui-input py-1.5" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="button" onClick={() => { setDateRange(['', '']); setPickerOpen(false) }}
                        className="ui-btn-secondary !text-xs">清空</button>
                      <button type="button" onClick={() => setPickerOpen(false)}
                        className="ui-btn-primary !text-xs !py-1.5">确定</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {activeTab === 'airport' && (
              <button
                type="button"
                onClick={simulateFlight}
                disabled={simulating}
                title="模拟一次飞行记录（调试用）"
                className="ui-btn-ghost !text-xs !py-2 disabled:opacity-50"
              >
                <FlaskConical size={13} aria-hidden />
                {simulating ? '生成中...' : '模拟飞行'}
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchStats()}
              disabled={loading}
              aria-label="刷新数据"
              className="p-2 text-dji-subtle hover:text-dji-black hover:bg-dji-page rounded-full transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {STAT_ITEMS.map(item => (
          <StatCard key={item.key} item={item} stats={stats} formatDuration={formatDuration} />
        ))}
      </div>

      {/* 设备排名 */}
      {ranking.length > 0 && (
        <section className="ui-card overflow-hidden" aria-labelledby="ranking-heading">
          <div className="ui-card-header flex items-center gap-2">
            <Trophy size={16} className="text-amber-500" aria-hidden />
            <h2 id="ranking-heading" className="ui-section-title text-sm">设备排名</h2>
            <span className="text-xs text-dji-muted">{ranking.length} 架设备</span>
            <button type="button" onClick={exportRankingExcel} className={`${btnSecondary} ml-auto`}>
              <Download size={12} aria-hidden />导出排名
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium w-16">排名</th>
                  <th className="px-4 py-2.5 text-left font-medium">设备名称</th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <button type="button" onClick={() => toggleRankSort('count')} className="inline-flex items-center gap-1 hover:text-dji-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 rounded px-1 -mx-1">
                      架次 {rankSort.key === 'count' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <button type="button" onClick={() => toggleRankSort('mileage')} className="inline-flex items-center gap-1 hover:text-dji-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 rounded px-1 -mx-1">
                      里程 {rankSort.key === 'mileage' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <button type="button" onClick={() => toggleRankSort('duration')} className="inline-flex items-center gap-1 hover:text-dji-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 rounded px-1 -mx-1">
                      时长 {rankSort.key === 'duration' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dji-border">
                {sortedRanking().map((r, i) => (
                  <tr key={r.deviceId} className="hover:bg-dji-page transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${i < 3 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-600'}`}>{i + 1}</span>
                    </td>
                    <td className="px-4 py-2.5 text-dji-black font-medium">{r.deviceName || r.deviceId}</td>
                    <td className="px-4 py-2.5 text-dji-ink tabular-nums">{r.count}</td>
                    <td className="px-4 py-2.5 text-dji-ink tabular-nums">{formatMileage(r.mileage)}</td>
                    <td className="px-4 py-2.5 text-dji-ink font-mono tabular-nums">{formatDuration(r.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 飞行记录列表 */}
      <section className="ui-card overflow-hidden" aria-labelledby="records-heading">
        <div className="ui-card-header flex items-center gap-2">
          <ListChecks size={16} className="text-dji-subtle" aria-hidden />
          <h2 id="records-heading" className="ui-section-title text-sm">飞行记录</h2>
          <span className="text-xs text-dji-muted">{records.length} 条</span>
          {loading && <Loader2 size={14} className="text-dji-black animate-spin ml-1" aria-label="加载中" />}
          <button type="button" onClick={exportExcel} disabled={records.length === 0} className={`${btnSecondary} ml-auto`}>
            <Download size={12} aria-hidden />导出 Excel
          </button>
        </div>

        {records.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-dji-page border border-dji-border flex items-center justify-center mb-3">
              <Inbox size={22} className="text-dji-subtle" aria-hidden />
            </div>
            <p className="text-sm font-medium text-dji-ink">当前时间范围内暂无飞行记录</p>
            <p className="text-xs text-dji-muted mt-1 max-w-xs">调整日期范围或切换设备类型后重试，数据每 30 秒自动刷新</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium w-24">状态</th>
                    <th className="px-4 py-2.5 text-left font-medium min-w-[140px]">设备</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">起飞时间</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">降落时间</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">里程</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">时长</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dji-border">
                  {loading && records.length === 0 ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="animate-pulse">
                        <td className="px-4 py-3"><div className="h-5 w-16 bg-dji-page rounded-md" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-32 bg-dji-page rounded" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 bg-dji-page rounded" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 bg-dji-page rounded" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 bg-dji-page rounded ml-auto" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-20 bg-dji-page rounded ml-auto" /></td>
                      </tr>
                    ))
                  ) : records.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE).map((r, i) => (
                    <tr key={r.id || `${r.deviceId}-${r.startTime}-${i}`} className="hover:bg-dji-page transition-colors">
                      <td className="px-4 py-2.5"><StatusBadge record={r} /></td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-dji-black truncate max-w-[180px] block" title={getRecordDeviceName(r)}>
                          {getRecordDeviceName(r)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-dji-muted whitespace-nowrap tabular-nums">{formatTime(r.startTime)}</td>
                      <td className="px-4 py-2.5 text-dji-muted whitespace-nowrap tabular-nums">{r.status === 'active' ? '--' : formatTime(r.endTime)}</td>
                      <td className="px-4 py-2.5 text-right text-dji-ink whitespace-nowrap tabular-nums">{formatMileage(r.totalMileage || 0)}</td>
                      <td className="px-4 py-2.5 text-right text-dji-ink whitespace-nowrap font-mono tabular-nums">{formatDuration(r.totalDuration || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {records.length > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-dji-border bg-dji-page/50">
                <span className="text-xs text-dji-muted">
                  共 {records.length} 条，第 {page} / {Math.ceil(records.length / PAGE_SIZE)} 页
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                    aria-label="上一页"
                    className="p-1.5 rounded-full hover:bg-dji-surface disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20">
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: Math.ceil(records.length / PAGE_SIZE) }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === Math.ceil(records.length / PAGE_SIZE) || Math.abs(p - page) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((p, i) => p === '...' ? (
                      <span key={`e${i}`} className="px-1 text-xs text-dji-subtle">...</span>
                    ) : (
                      <button key={p} type="button" onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined}
                        className={`min-w-[1.75rem] h-7 text-xs rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 ${
                          page === p ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white text-slate-600'
                        }`}>{p}</button>
                    ))
                  }
                  <button type="button" onClick={() => setPage(p => Math.min(Math.ceil(records.length / PAGE_SIZE), p + 1))} disabled={page === Math.ceil(records.length / PAGE_SIZE)}
                    aria-label="下一页"
                    className="p-1.5 rounded-full hover:bg-dji-surface disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
