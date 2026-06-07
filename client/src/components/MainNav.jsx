import PillNav from './PillNav'

/**
 * 主导航 — React Bits PillNav
 */
export default function MainNav({ tabs, activeKey, onChange, className = '', variant = 'standalone' }) {
  const items = tabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    icon: tab.icon,
  }))

  const embedded = variant === 'embedded'

  return (
    <PillNav
      hideLogo
      className={[embedded ? 'pill-nav--embedded' : '', className].filter(Boolean).join(' ')}
      items={items}
      activeKey={activeKey}
      onChange={onChange}
      ease="power2.easeOut"
      baseColor="#f1f5f9"
      pillColor="#ffffff"
      pillTextColor="#475569"
      hoveredPillTextColor="#ffffff"
      hoverCircleColor="#2563eb"
      activePillColor="#2563eb"
      activePillTextColor="#ffffff"
      initialLoadAnimation={!embedded}
      aria-label="主导航"
    />
  )
}
