import { useState, useEffect } from 'react'
import { Plane, Navigation, Clock, Calendar, ChevronDown, RefreshCw } from 'lucide-react'

export default function FlightDashboard() {
  const [activeTab, setActiveTab] = useState('airport') // 'airport' | 'drone' | 'virtual' | 'all'
  const [timeRange, setTimeRange] = useState('today') // 'today' | 'week' | 'month' | 'all'
  const [stats, setStats] = useState({ count: 0, mileage: 0, duration: 0 })
  const [loading, setLoading] = useState(false)

  const fetchStats = async () => {
    setLoading(true)
    try {
      let startTime = ''
      const now = new Date()
      if (timeRange === 'today') {
        startTime = new Date(now.setHours(0, 0, 0, 0)).toISOString()
      } else if (timeRange === 'week') {
        const weekAgo = new Date(now.setDate(now.getDate() - 7))
        startTime = weekAgo.toISOString()
      } else if (timeRange === 'month') {
        const monthAgo = new Date(now.setMonth(now.getMonth() - 1))
        startTime = monthAgo.toISOString()
      }

      const res = await fetch(`/api/flight-history?type=${activeTab}&startTime=${startTime}`)
      const data = await res.json()
      
      const totalMileage = data.reduce((acc, cur) => acc + (cur.totalMileage || 0), 0)
      const totalDuration = data.reduce((acc, cur) => acc + (cur.totalDuration || 0), 0)
      
      setStats({
        count: data.length,
        mileage: totalMileage,
        duration: totalDuration
      })
    } catch (e) {
      console.error('获取飞行统计失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    const timer = setInterval(fetchStats, 30000) // 每30秒自动刷新
    return () => clearInterval(timer)
  }, [activeTab, timeRange])

  const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const tabs = [
    { id: 'airport', label: '自动机场', color: 'blue' },
    { id: 'drone', label: '单兵无人机', color: 'indigo' },
    { id: 'virtual', label: '虚拟机场', color: 'purple' },
    { id: 'all', label: '全部设备', color: 'gray' }
  ]

  const timeRanges = [
    { id: 'today', label: '今日' },
    { id: 'week', label: '本周' },
    { id: 'month', label: '本月' },
    { id: 'all', label: '累计' }
  ]

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex bg-gray-100 p-1 rounded-lg">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                activeTab === tab.id 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700'
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
              {timeRanges.map(range => (
                <option key={range.id} value={range.id}>{range.label}</option>
              ))}
            </select>
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
          </div>
          <button 
            onClick={fetchStats}
            className={`p-2 text-gray-400 hover:text-blue-600 transition-colors ${loading ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 架次统计 */}
        <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100 flex items-center gap-5">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
            <Plane size={24} />
          </div>
          <div>
            <p className="text-sm text-blue-600 font-medium opacity-80">飞行架次</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-blue-900">{stats.count}</span>
              <span className="text-xs text-blue-700 font-medium">架次</span>
            </div>
          </div>
        </div>

        {/* 里程统计 */}
        <div className="bg-indigo-50/50 rounded-xl p-5 border border-indigo-100 flex items-center gap-5">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
            <Navigation size={24} />
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

        {/* 时间统计 */}
        <div className="bg-purple-50/50 rounded-xl p-5 border border-purple-100 flex items-center gap-5">
          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-sm text-purple-600 font-medium opacity-80">累计时长</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-purple-900 tracking-tight">{formatDuration(stats.duration)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
