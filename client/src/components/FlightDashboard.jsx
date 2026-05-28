import { useState, useEffect } from 'react'
import { Plane, Navigation, Clock, Calendar, ChevronDown, RefreshCw, CheckCircle2, ListChecks, Loader2 } from 'lucide-react'

export default function FlightDashboard() {
  const [activeTab, setActiveTab] = useState('airport')
  const [timeRange, setTimeRange] = useState('today')
  const [stats, setStats] = useState({ count: 0, mileage: 0, duration: 0 })
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)

  const getStartTime = (range) => {
    const now = new Date()
    if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    if (range === 'week') return new Date(now.getTime() - 7 * 86400000).toISOString()
    if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    return ''
  }

  const fetchStats = async () => {
    setLoading(true)
    try {
      const startTime = getStartTime(timeRange)
      const [histRes, activeRes] = await Promise.all([
        fetch(`/api/flight-history?type=${activeTab}&startTime=${startTime}`),
        fetch(`/api/flight-active?type=${activeTab}`)
      ])
      const history = await histRes.json()
      const active = await activeRes.json()
      const all = [
        ...active,
        ...history.filter(h => !active.find(a => a.deviceId === h.deviceId))
      ].sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      const totalMileage = history.reduce((acc, cur) => acc + (cur.totalMileage || 0), 0)
      const totalDuration = history.reduce((acc, cur) => acc + (cur.totalDuration || 0), 0)
      setStats({ count: history.length, mileage: totalMileage, duration: totalDuration })
      setRecords(all)
    } catch (e) {
      console.error('获取飞行统计失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [activeTab, timeRange])
  useEffect(() => {
    const timer = setInterval(fetchStats, 60000)
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

  const timeRanges = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'all', label: '累计' }
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
          <div className="relative">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="appearance-none bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-8 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {timeRanges.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
          </div>
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

      {/* 飞行记录列表 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ListChecks size={15} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-500">飞行记录</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{records.length} 条</span>
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
                {records.slice(0, 50).map((r, i) => (
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
                      <span className="font-medium text-gray-700 truncate max-w-[160px] block" title={r.deviceName || r.deviceId}>
                        {r.deviceName || r.deviceId}
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
            {records.length > 50 && (
              <p className="text-center text-xs text-gray-400 py-3">仅显示最近 50 条记录</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
