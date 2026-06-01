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

const STAT_ITEMS = [
  { key: 'count', label: '飞行架次', suffix: '架次', icon: Plane, accent: 'text-blue-600', bg: 'bg-blue-50' },
  { key: 'mileage', label: '飞行里程', icon: Navigation, accent: 'text-blue-600', bg: 'bg-blue-50', isMileage: true },
  { key: 'duration', label: '累计时长', icon: Clock, accent: 'text-blue-600', bg: 'bg-blue-50', isDuration: true },
]

function StatCard({ item, stats, formatDuration }) {
  const Icon = item.icon
  let value = stats[item.key]
  let suffix = item.suffix || ''
  if (item.isMileage) {
    value = stats.mileage > 1000 ? (stats.mileage / 1000).toFixed(2) : Math.round(stats.mileage)
    suffix = stats.mileage > 1000 ? 'km' : 'm'
  }
  if (item.isDuration) {
    return (
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">{item.label}</p>
            <p className={`text-2xl font-bold ${item.accent} font-mono tracking-tight mt-0.5`}>{formatDuration(stats.duration)}</p>
          </div>
          <div className={`${item.bg} p-2.5 rounded-lg`}>
            <Icon className={item.accent} size={28} strokeWidth={1.75} />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{item.label}</p>
          <p className={`text-2xl font-bold ${item.accent} mt-0.5`}>
            {value}
            {suffix && <span className="text-sm font-medium text-gray-500 ml-1">{suffix}</span>}
          </p>
        </div>
        <div className={`${item.bg} p-2.5 rounded-lg`}>
          <Icon className={`${item.accent} opacity-80`} size={28} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ record }) {
  if (record.status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80">
        <Loader2 size={10} className="animate-spin" aria-hidden />
        进行中
      </span>
    )
  }
  if ((record.totalMileage || 0) <= 0 || (record.totalDuration || 0) <= 5) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 ring-1 ring-rose-200/80" title="里程为 0 或时长不超过 5 秒">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" aria-hidden />
        无效
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 ring-1 ring-gray-200/80">
      <CheckCircle2 size={10} aria-hidden />
      已完成
    </span>
  )
}

export default function FlightDashboard() {
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

  const fetchStats = async (resetPage = true) => {
    setLoading(true)
    try {
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

  const btnSecondary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="space-y-5">
      {/* 筛选工具栏 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex bg-gray-100 p-1 rounded-lg w-fit" role="tablist" aria-label="设备类型">
            {tabs.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                  activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
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
                className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 hover:border-gray-300 transition-colors min-w-[220px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
              >
                <CalendarRange size={15} className="text-gray-500 shrink-0" aria-hidden />
                <span className="truncate">{toDisplayStr(dateRange[0]) || '开始时间'}</span>
                <span className="text-gray-400 shrink-0">至</span>
                <span className="truncate">{toDisplayStr(dateRange[1]) || '结束时间'}</span>
                <ChevronDown size={14} className={`text-gray-400 ml-auto shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>

              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-lg flex overflow-hidden" style={{ minWidth: 340 }}>
                  <div className="border-r border-gray-100 py-2 px-1 flex flex-col gap-0.5 shrink-0" style={{ width: 96 }}>
                    {SHORTCUTS.map(s => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => { setDateRange(s.getDates()); setPickerOpen(false) }}
                        className="text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                      >{s.label}</button>
                    ))}
                  </div>
                  <div className="p-4 flex flex-col gap-3 min-w-0">
                    <div className="flex items-end gap-2">
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <label className="text-xs font-medium text-gray-600">开始时间</label>
                        <input type="datetime-local" value={dateRange[0]} max={dateRange[1] || undefined}
                          onChange={e => setDateRange([e.target.value, dateRange[1]])}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                      </div>
                      <span className="text-gray-400 pb-2 shrink-0" aria-hidden>→</span>
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <label className="text-xs font-medium text-gray-600">结束时间</label>
                        <input type="datetime-local" value={dateRange[1]} min={dateRange[0] || undefined}
                          onChange={e => setDateRange([dateRange[0], e.target.value])}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="button" onClick={() => { setDateRange(['', '']); setPickerOpen(false) }}
                        className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50">清空</button>
                      <button type="button" onClick={() => setPickerOpen(false)}
                        className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">确定</button>
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
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
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
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
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
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-labelledby="ranking-heading">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <Trophy size={16} className="text-amber-600" aria-hidden />
            <h2 id="ranking-heading" className="text-sm font-semibold text-gray-800">设备排名</h2>
            <span className="text-xs text-gray-500">{ranking.length} 架设备</span>
            <button type="button" onClick={exportRankingExcel} className={`${btnSecondary} ml-auto`}>
              <Download size={12} aria-hidden />导出排名
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium w-16">排名</th>
                  <th className="px-4 py-2.5 text-left font-medium">设备名称</th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <button type="button" onClick={() => toggleRankSort('count')} className="inline-flex items-center gap-1 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded px-1 -mx-1">
                      架次 {rankSort.key === 'count' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <button type="button" onClick={() => toggleRankSort('mileage')} className="inline-flex items-center gap-1 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded px-1 -mx-1">
                      里程 {rankSort.key === 'mileage' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <button type="button" onClick={() => toggleRankSort('duration')} className="inline-flex items-center gap-1 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded px-1 -mx-1">
                      时长 {rankSort.key === 'duration' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRanking().map((r, i) => (
                  <tr key={r.deviceId} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${i < 3 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{i + 1}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium">{r.deviceName || r.deviceId}</td>
                    <td className="px-4 py-2.5 text-gray-700 tabular-nums">{r.count}</td>
                    <td className="px-4 py-2.5 text-gray-700 tabular-nums">{formatMileage(r.mileage)}</td>
                    <td className="px-4 py-2.5 text-gray-700 font-mono tabular-nums">{formatDuration(r.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 飞行记录列表 */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-labelledby="records-heading">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <ListChecks size={16} className="text-gray-500" aria-hidden />
          <h2 id="records-heading" className="text-sm font-semibold text-gray-800">飞行记录</h2>
          <span className="text-xs text-gray-500">{records.length} 条</span>
          {loading && <Loader2 size={14} className="text-blue-600 animate-spin ml-1" aria-label="加载中" />}
          <button type="button" onClick={exportExcel} disabled={records.length === 0} className={`${btnSecondary} ml-auto`}>
            <Download size={12} aria-hidden />导出 Excel
          </button>
        </div>

        {records.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Inbox size={22} className="text-gray-400" aria-hidden />
            </div>
            <p className="text-sm font-medium text-gray-700">当前时间范围内暂无飞行记录</p>
            <p className="text-xs text-gray-500 mt-1 max-w-xs">调整日期范围或切换设备类型后重试，数据每 30 秒自动刷新</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium w-24">状态</th>
                    <th className="px-4 py-2.5 text-left font-medium min-w-[140px]">设备</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">起飞时间</th>
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">降落时间</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">里程</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">时长</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading && records.length === 0 ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="animate-pulse">
                        <td className="px-4 py-3"><div className="h-5 w-16 bg-gray-100 rounded-md" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-100 rounded" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-100 rounded" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-100 rounded" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 bg-gray-100 rounded ml-auto" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-20 bg-gray-100 rounded ml-auto" /></td>
                      </tr>
                    ))
                  ) : records.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE).map((r, i) => (
                    <tr key={r.id || `${r.deviceId}-${r.startTime}-${i}`} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-2.5"><StatusBadge record={r} /></td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-800 truncate max-w-[180px] block" title={getRecordDeviceName(r)}>
                          {getRecordDeviceName(r)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap tabular-nums">{formatTime(r.startTime)}</td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap tabular-nums">{r.status === 'active' ? '--' : formatTime(r.endTime)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap tabular-nums">{formatMileage(r.totalMileage || 0)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap font-mono tabular-nums">{formatDuration(r.totalDuration || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {records.length > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                <span className="text-xs text-gray-600">
                  共 {records.length} 条，第 {page} / {Math.ceil(records.length / PAGE_SIZE)} 页
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                    aria-label="上一页"
                    className="p-1.5 rounded-md hover:bg-white disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
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
                      <span key={`e${i}`} className="px-1 text-xs text-gray-400">...</span>
                    ) : (
                      <button key={p} type="button" onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined}
                        className={`min-w-[1.75rem] h-7 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
                          page === p ? 'bg-blue-600 text-white font-medium' : 'hover:bg-white text-gray-600'
                        }`}>{p}</button>
                    ))
                  }
                  <button type="button" onClick={() => setPage(p => Math.min(Math.ceil(records.length / PAGE_SIZE), p + 1))} disabled={page === Math.ceil(records.length / PAGE_SIZE)}
                    aria-label="下一页"
                    className="p-1.5 rounded-md hover:bg-white disabled:opacity-30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
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
