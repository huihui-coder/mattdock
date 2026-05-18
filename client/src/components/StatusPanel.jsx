import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'

export default function StatusPanel({ stats, onFilter, activeFilter }) {
  const items = [
    {
      label: '设备总数',
      value: stats.total,
      icon: HelpCircle,
      color: 'blue',
      bgClass: 'bg-blue-50',
      textClass: 'text-blue-600',
      filterValue: null  // null表示不过滤
    },
    {
      label: '正常',
      value: stats.normal,
      icon: CheckCircle,
      color: 'green',
      bgClass: 'bg-green-50',
      textClass: 'text-green-600',
      filterValue: 'normal'
    },
    {
      label: '警告',
      value: stats.warning,
      icon: AlertTriangle,
      color: 'yellow',
      bgClass: 'bg-yellow-50',
      textClass: 'text-yellow-600',
      filterValue: 'warning'
    },
    {
      label: '严重',
      value: stats.critical,
      icon: XCircle,
      color: 'red',
      bgClass: 'bg-red-50',
      textClass: 'text-red-600',
      filterValue: 'critical'
    }
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item, index) => {
        const isActive = activeFilter === item.filterValue
        const isClickable = item.filterValue !== null
        return (
          <div 
            key={index}
            onClick={() => isClickable && onFilter(isActive ? null : item.filterValue)}
            className={`${item.bgClass} rounded-lg p-4 border ${isActive ? 'border-2 border-gray-400 shadow-md' : 'border-gray-100'} ${isClickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{item.label}</p>
                <p className={`text-2xl font-bold ${item.textClass}`}>{item.value}</p>
              </div>
              <item.icon className={`${item.textClass} opacity-50`} size={32} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
