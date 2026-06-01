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
      activeRing: 'ring-2 ring-blue-400 border-blue-300',
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
      activeRing: 'ring-2 ring-emerald-400 border-emerald-300',
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
      activeRing: 'ring-2 ring-amber-400 border-amber-300',
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
      activeRing: 'ring-2 ring-red-400 border-red-300',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item, index) => {
        const isActive = activeFilter === item.filterValue
        const isClickable = item.filterValue !== null
        return (
          <div
            key={index}
            onClick={() => isClickable && onFilter(isActive ? null : item.filterValue)}
            className={`${item.bg} ${item.border} border rounded-xl p-4 transition-all ${
              isActive ? item.activeRing : ''
            } ${isClickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{item.label}</p>
                <p className={`text-2xl font-bold ${item.text} tabular-nums mt-0.5`}>{item.value}</p>
              </div>
              <item.icon className={`${item.iconColor} opacity-70`} size={28} strokeWidth={1.5} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
