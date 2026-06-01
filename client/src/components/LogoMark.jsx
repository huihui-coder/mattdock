const WING_PATH =
  'M10,15 C25,15 40,25 48,42 L50,46 L52,42 C60,25 75,15 90,15 C75,20 63,32 58,45 L50,60 L42,45 C37,32 25,20 10,15 Z'

/** 平台品牌标识：翼形 mark，与 favicon 同源 */
export default function LogoMark({ variant = 'app', className = '', title = '机场监测系统' }) {
  if (variant === 'login') {
    return (
      <svg
        className={className}
        viewBox="0 0 100 60"
        fill="currentColor"
        aria-hidden
        role="img"
      >
        <title>{title}</title>
        <path d={WING_PATH} />
      </svg>
    )
  }

  if (variant === 'icon') {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded bg-gradient-to-br from-blue-500 to-blue-700 shadow-sm shadow-blue-900/30 ${className}`}
        title={title}
        aria-hidden
      >
        <svg className="h-[58%] w-[58%] text-white" viewBox="0 0 100 60" fill="currentColor">
          <path d={WING_PATH} />
        </svg>
      </span>
    )
  }

  return (
    <div
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 shadow-sm shadow-blue-600/25 ${className}`}
      title={title}
      aria-hidden
    >
      <svg className="h-[18px] w-[30px] text-white" viewBox="0 0 100 60" fill="currentColor">
        <path d={WING_PATH} />
      </svg>
    </div>
  )
}
