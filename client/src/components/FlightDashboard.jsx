import { useState, useEffect, useRef } from 'react'
import { Plane, Navigation, Clock, RefreshCw, CheckCircle2, ListChecks, Loader2, CalendarRange, ChevronDown, Download, ChevronLeft, ChevronRight, FlaskConical, Trophy, ArrowUpDown } from 'lucide-react'
import * as XLSX from 'xlsx'

const pad = (n) => String(n).padStart(2, '0')
const toDatetimeLocal = (d) => {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const toEndOfDay = (d) => {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return toDatetimeLocal(e);
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
      // 结束时间若是“今天”，按实时当前时间查询，避免冻结在页面加载时刻而漏掉新记录
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
      const active = data.active || []
      const all = data.records || []
      console.log('[飞行记录] records=', all.length, 'history=', history.length, 'active=', active.length, active)
      // 过滤有效记录（里程>0 且 时长>5秒）
      const validHistory = history.filter(r => (r.totalMileage || 0) > 0 && (r.totalDuration || 0) > 5)
      const totalMileage = validHistory.reduce((acc, cur) => acc + (cur.totalMileage || 0), 0)
      const totalDuration = validHistory.reduce((acc, cur) => acc + (cur.totalDuration || 0), 0)
      setStats({ count: validHistory.length, mileage: totalMileage, duration: totalDuration })
      setRecords(all)
      // 计算设备排名（仅 completed 记录，过滤掉里程=0或时长<=5秒的无意义记录）
      const deviceMap = new Map()
      for (const r of history) {
        // 过滤无效记录：里程为0或时长<=5秒
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
    const sorted = [...ranking].sort((a, b) => {
      const v = rankSort.key === 'count' ? b.count - a.count : rankSort.key === 'mileage' ? b.mileage - a.mileage : b.duration - a.duration
      return rankSort.order === 'asc' ? -v : v
    })
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

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
      {/* 顶部工具栏 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="flex bg-gray-100 p-1 rounded-lg">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {/* 日期范围选择器 */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen(v => !v)}
              className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:border-blue-400 transition-colors min-w-[210px]"
            >
              <CalendarRange size={14} className="text-gray-400 shrink-0" />
              <span>{toDisplayStr(dateRange[0]) || '开始时间'}</span>
              <span className="text-gray-400">至</span>
              <span>{toDisplayStr(dateRange[1]) || '结束时间'}</span>
              <ChevronDown size={13} className="text-gray-400 ml-auto" />
            </button>

            {pickerOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl flex" style={{minWidth: 340}}>
                {/* 快捷选项 */}
                <div className="border-r border-gray-100 py-3 px-1 flex flex-col gap-0.5" style={{width: 96}}>
                  {SHORTCUTS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => { setDateRange(s.getDates()); setPickerOpen(false) }}
                      className="text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                    >{s.label}</button>
                  ))}
                </div>
                {/* 日期输入 */}
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-400">开始时间</label>
                      <input type="datetime-local" value={dateRange[0]} max={dateRange[1] || undefined}
                        onChange={e => setDateRange([e.target.value, dateRange[1]])}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                    <span className="text-gray-400 mt-4">→</span>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-400">结束时间</label>
                      <input type="datetime-local" value={dateRange[1]} min={dateRange[0] || undefined}
                        onChange={e => setDateRange([dateRange[0], e.target.value])}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setDateRange(['', '']); setPickerOpen(false) }}
                      className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">清空</button>
                    <button onClick={() => setPickerOpen(false)}
                      className="px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg">确定</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {activeTab === 'airport' && (
            <button
              onClick={simulateFlight}
              disabled={simulating}
              title="模拟一次飞行记录（调试用）"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-600 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <FlaskConical size={13} />
              {simulating ? '生成中...' : '模拟飞行'}
            </button>
          )}
          <button onClick={fetchStats} className={`p-2 text-gray-400 hover:text-blue-600 transition-colors ${loading ? 'animate-spin' : ''}`}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100 flex items-center gap-5">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
            <Plane size={22} />
          </div>
          <div>
            <p className="text-sm text-blue-600 font-medium opacity-80">飞行架次</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-blue-900">{stats.count}</span>
              <span className="text-xs text-blue-700 font-medium">架次</span>
            </div>
          </div>
        </div>
        <div className="bg-indigo-50/50 rounded-xl p-5 border border-indigo-100 flex items-center gap-5">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
            <Navigation size={22} />
          </div>
          <div>
            <p className="text-sm text-indigo-600 font-medium opacity-80">飞行里程</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-indigo-900">
                {stats.mileage > 1000 ? (stats.mileage / 1000).toFixed(2) : Math.round(stats.mileage)}
              </span>
              <span className="text-xs text-indigo-700 font-medium">{stats.mileage > 1000 ? 'km' : 'm'}</span>
            </div>
          </div>
        </div>
        <div className="bg-purple-50/50 rounded-xl p-5 border border-purple-100 flex items-center gap-5">
          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
            <Clock size={22} />
          </div>
          <div>
            <p className="text-sm text-purple-600 font-medium opacity-80">累计时长</p>
            <span className="text-2xl font-bold text-purple-900 tracking-tight">{formatDuration(stats.duration)}</span>
          </div>
        </div>
      </div>

      {/* 设备排名 */}
      {ranking.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={15} className="text-amber-500" />
            <span className="text-sm font-medium text-gray-500">设备排名</span>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{ranking.length} 架</span>
            <button onClick={exportRankingExcel}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
              <Download size={12} />导出排名
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">排名</th>
                  <th className="px-3 py-2 text-left font-medium">设备名称</th>
                  <th className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-gray-100" onClick={() => setRankSort(s => ({ key: 'count', order: s.key === 'count' && s.order === 'desc' ? 'asc' : 'desc' }))}>
                    <span className="flex items-center gap-1">架次 {rankSort.key === 'count' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}</span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-gray-100" onClick={() => setRankSort(s => ({ key: 'mileage', order: s.key === 'mileage' && s.order === 'desc' ? 'asc' : 'desc' }))}>
                    <span className="flex items-center gap-1">里程 {rankSort.key === 'mileage' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}</span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-gray-100" onClick={() => setRankSort(s => ({ key: 'duration', order: s.key === 'duration' && s.order === 'desc' ? 'asc' : 'desc' }))}>
                    <span className="flex items-center gap-1">时长 {rankSort.key === 'duration' && <ArrowUpDown size={12} className={rankSort.order === 'asc' ? 'rotate-180' : ''} />}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRanking().map((r, i) => (
                  <tr key={r.deviceId} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{i + 1}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.deviceName || r.deviceId}</td>
                    <td className="px-3 py-2 text-gray-700">{r.count} 架次</td>
                    <td className="px-3 py-2 text-gray-700">{formatMileage(r.mileage)}</td>
                    <td className="px-3 py-2 text-gray-700">{formatDuration(r.duration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 飞行记录列表 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ListChecks size={15} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-500">飞行记录</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{records.length} 条</span>
          <button onClick={exportExcel} disabled={records.length === 0}
            className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={12} />导出 Excel
          </button>
        </div>

        {records.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">暂无飞行记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-400">状态</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-400 w-1/4">设备</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-400">起飞时间</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-400">降落时间</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-400">里程</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-gray-400">时长</th>
                </tr>
              </thead>
              <tbody>
                {records.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE).map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5 px-3">
                      {r.status === 'active' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-200">
                          <Loader2 size={10} className="animate-spin" />进行中
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                          <CheckCircle2 size={10} />已完成
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-medium text-gray-700 truncate max-w-[160px] block" title={getRecordDeviceName(r)}>
                        {getRecordDeviceName(r)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">{formatTime(r.startTime)}</td>
                    <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">{r.status === 'active' ? '--' : formatTime(r.endTime)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap">{formatMileage(r.totalMileage || 0)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600 whitespace-nowrap font-mono">{formatDuration(r.totalDuration || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 分页 */}
            {records.length > PAGE_SIZE && (
              <div className="flex items-center justify-between px-3 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  共 {records.length} 条，第 {page}/{Math.ceil(records.length/PAGE_SIZE)} 页
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({length: Math.ceil(records.length/PAGE_SIZE)}, (_,i)=>i+1)
                    .filter(p => p===1 || p===Math.ceil(records.length/PAGE_SIZE) || Math.abs(p-page)<=1)
                    .reduce((acc,p,idx,arr) => {
                      if (idx>0 && p-arr[idx-1]>1) acc.push('...')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((p,i) => p==='...' ? (
                      <span key={`e${i}`} className="px-1 text-xs text-gray-400">...</span>
                    ) : (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-7 h-7 text-xs rounded transition-colors ${
                          page===p ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'
                        }`}>{p}</button>
                    ))
                  }
                  <button onClick={() => setPage(p => Math.min(Math.ceil(records.length/PAGE_SIZE),p+1))} disabled={page===Math.ceil(records.length/PAGE_SIZE)}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors">
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
