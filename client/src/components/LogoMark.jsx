const WING_PATH =
  'M10,15 C25,15 40,25 48,42 L50,46 L52,42 C60,25 75,15 90,15 C75,20 63,32 58,45 L50,60 L42,45 C37,32 25,20 10,15 Z'

const VARIANTS = {
  app: { className: 'h-8 w-12 text-[#1c2d5a]' },
  login: { className: 'w-11 h-9 text-[#1c2d5a]' },
  icon: { className: 'h-5 w-8 text-gray-300' },
}

/** 平台品牌标识：透明底翼形 mark，与 favicon 同源 */
export default function LogoMark({ variant = 'app', className = '', title = '无人机管理平台' }) {
  const preset = VARIANTS[variant] || VARIANTS.app

  return (
    <svg
      className={`shrink-0 ${preset.className} ${className}`}
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
