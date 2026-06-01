import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'

export default function StatusPanel({ stats, onFilter, activeFilter }) {
  const items = [
    { label: '设备总数', value: stats.total, icon: HelpCircle, filterValue: null },
    { label: '正常', value: stats.normal, icon: CheckCircle, filterValue: 'normal', dot: 'bg-emerald-500' },
    { label: '警告', value: stats.warning, icon: AlertTriangle, filterValue: 'warning', dot: 'bg-amber-500' },
    { label: '严重', value: stats.critical, icon: XCircle, filterValue: 'critical', dot: 'bg-red-500' },
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
            className={`ui-card p-4 transition-all ${
              isActive ? 'ring-2 ring-dji-black border-dji-black' : ''
            } ${isClickable ? 'cursor-pointer hover:border-dji-ink/30' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  {item.dot && <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} aria-hidden />}
                  <p className="text-sm text-dji-muted">{item.label}</p>
                </div>
                <p className="text-2xl font-bold text-dji-black tabular-nums">{item.value}</p>
              </div>
              <item.icon className="text-dji-subtle opacity-40" size={28} strokeWidth={1.5} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
