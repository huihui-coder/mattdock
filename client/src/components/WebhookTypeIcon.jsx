export const TYPE_LABELS = {
  wecom: '企业微信',
  feishu: '飞书',
  dingtalk: '钉钉',
  custom: '自定义',
}

const TYPE_ICONS = {
  wecom: '/images/企业微信.svg',
  feishu: '/images/飞书-copy.svg',
  dingtalk: '/images/钉钉01.svg',
}

export function WebhookTypeIcon({ type, size = 16, className = '' }) {
  const src = TYPE_ICONS[type]
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`inline-block object-contain shrink-0 ${className}`}
      aria-hidden
    />
  )
}

export function WebhookTypeBadge({ type, showLabel = true }) {
  const label = TYPE_LABELS[type] || TYPE_LABELS.custom
  const styles = {
    wecom: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    feishu: 'bg-blue-50 text-blue-700 border-blue-200',
    dingtalk: 'bg-sky-50 text-sky-700 border-sky-200',
    custom: 'bg-slate-50 text-slate-600 border-slate-200',
  }
  const style = styles[type] || styles.custom
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${style}`}>
      <WebhookTypeIcon type={type} size={14} />
      {showLabel && label}
    </span>
  )
}
