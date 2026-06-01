import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'

export default function StatusPanel({ stats, onFilter, activeFilter }) {
  const items = [
    {
      label: '设备总数',
      value: stats.total,
      icon: HelpCircle,
      filterValue: null,
      bg: 'bg-blue-50',
      border: 'border-blue-100',
      text: 'text-blue-600',
      iconColor: 'text-blue-400',
      activeRing: 'ring-2 ring-blue-400/60 border-blue-300 shadow-md shadow-blue-500/10',
    },
    {
      label: '正常',
      value: stats.normal,
      icon: CheckCircle,
      filterValue: 'normal',
      bg: 'bg-emerald-50',
      border: 'border-emerald-100',
      text: 'text-emerald-600',
      iconColor: 'text-emerald-400',
      activeRing: 'ring-2 ring-emerald-400/60 border-emerald-300 shadow-md shadow-emerald-500/10',
      hint: '点击筛选正常设备',
    },
    {
      label: '警告',
      value: stats.warning,
      icon: AlertTriangle,
      filterValue: 'warning',
      bg: 'bg-amber-50',
      border: 'border-amber-100',
      text: 'text-amber-600',
      iconColor: 'text-amber-400',
      activeRing: 'ring-2 ring-amber-400/60 border-amber-300 shadow-md shadow-amber-500/10',
      hint: '点击筛选警告设备',
    },
    {
      label: '严重',
      value: stats.critical,
      icon: XCircle,
      filterValue: 'critical',
      bg: 'bg-red-50',
      border: 'border-red-100',
      text: 'text-red-600',
      iconColor: 'text-red-400',
      activeRing: 'ring-2 ring-red-400/60 border-red-300 shadow-md shadow-red-500/10',
      hint: '点击筛选严重设备',
    },
  ]

  const handleActivate = (item) => {
    if (item.filterValue === null) return
    const isActive = activeFilter === item.filterValue
    onFilter(isActive ? null : item.filterValue)
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="group" aria-label="设备状态概览">
      {items.map((item, index) => {
        const isActive = activeFilter === item.filterValue
        const isClickable = item.filterValue !== null
        return (
          <div
            key={index}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            aria-pressed={isClickable ? isActive : undefined}
            title={item.hint}
            onClick={() => handleActivate(item)}
            onKeyDown={(e) => {
              if (!isClickable) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleActivate(item)
              }
            }}
            className={`${item.bg} ${item.border} border rounded-xl p-4 transition-all duration-200 ${
              isActive ? item.activeRing : 'shadow-sm'
            } ${isClickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600">{item.label}</p>
                <p className={`text-2xl font-bold ${item.text} tabular-nums mt-0.5 tracking-tight`}>{item.value}</p>
              </div>
              <item.icon className={`${item.iconColor} opacity-80`} size={26} strokeWidth={1.75} aria-hidden />
            </div>
          </div>
        )
      })}
    </div>
  )
}
