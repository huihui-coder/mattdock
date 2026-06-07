import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import './PillNav.css'

/**
 * React Bits PillNav — JavaScript + CSS（适配 SPA Tab，无 react-router）
 */
export default function PillNav({
  logo = null,
  logoAlt = 'Logo',
  items = [],
  activeKey,
  activeHref,
  onChange,
  className = '',
  ease = 'power3.easeOut',
  baseColor = '#e2e8f0',
  pillColor = '#ffffff',
  hoveredPillTextColor = '#ffffff',
  pillTextColor = '#475569',
  hoverCircleColor = '#2563eb',
  activePillColor = '#2563eb',
  activePillTextColor = '#ffffff',
  onMobileMenuClick,
  initialLoadAnimation = false,
  hideLogo = false,
  'aria-label': ariaLabel = '主导航',
}) {
  const resolvedPillTextColor = pillTextColor ?? baseColor
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const circleRefs = useRef([])
  const tlRefs = useRef([])
  const activeTweenRefs = useRef([])
  const logoImgRef = useRef(null)
  const logoTweenRef = useRef(null)
  const hamburgerRef = useRef(null)
  const mobileMenuRef = useRef(null)
  const navItemsRef = useRef(null)
  const logoRef = useRef(null)

  const isActive = (item) => {
    if (activeKey !== undefined) return activeKey === item.key
    if (activeHref !== undefined) return activeHref === item.href
    return false
  }

  useEffect(() => {
    const layout = () => {
      circleRefs.current.forEach((circle) => {
        if (!circle?.parentElement) return

        const pill = circle.parentElement
        const rect = pill.getBoundingClientRect()
        const { width: w, height: h } = rect
        const R = ((w * w) / 4 + h * h) / (2 * h)
        const D = Math.ceil(2 * R) + 2
        const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1
        const originY = D - delta

        circle.style.width = `${D}px`
        circle.style.height = `${D}px`
        circle.style.bottom = `-${delta}px`

        gsap.set(circle, {
          xPercent: -50,
          scale: 0,
          transformOrigin: `50% ${originY}px`,
        })

        const content = pill.querySelector('.pill-content')
        const contentHover = pill.querySelector('.pill-content-hover')

        if (content) gsap.set(content, { y: 0 })
        if (contentHover) gsap.set(contentHover, { y: h + 12, opacity: 0 })

        const index = circleRefs.current.indexOf(circle)
        if (index === -1) return

        tlRefs.current[index]?.kill()
        const tl = gsap.timeline({ paused: true })

        tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: 'auto' }, 0)

        if (content) {
          tl.to(content, { y: -(h + 8), duration: 2, ease, overwrite: 'auto' }, 0)
        }

        if (contentHover) {
          gsap.set(contentHover, { y: Math.ceil(h + 100), opacity: 0 })
          tl.to(contentHover, { y: 0, opacity: 1, duration: 2, ease, overwrite: 'auto' }, 0)
        }

        tlRefs.current[index] = tl
      })
    }

    layout()

    const onResize = () => layout()
    window.addEventListener('resize', onResize)

    if (document.fonts?.ready) {
      document.fonts.ready.then(layout).catch(() => {})
    }

    const menu = mobileMenuRef.current
    if (menu) {
      gsap.set(menu, { visibility: 'hidden', opacity: 0, scaleY: 1 })
    }

    if (initialLoadAnimation) {
      const logoEl = logoRef.current
      const navItems = navItemsRef.current

      if (logoEl) {
        gsap.set(logoEl, { scale: 0 })
        gsap.to(logoEl, { scale: 1, duration: 0.6, ease })
      }

      if (navItems) {
        gsap.set(navItems, { width: 0, overflow: 'hidden' })
        gsap.to(navItems, { width: 'auto', duration: 0.6, ease })
      }
    }

    return () => window.removeEventListener('resize', onResize)
  }, [items, ease, initialLoadAnimation])

  const handleEnter = (i) => {
    const pill = circleRefs.current[i]?.parentElement
    if (pill?.classList.contains('is-active')) return
    const tl = tlRefs.current[i]
    if (!tl) return
    activeTweenRefs.current[i]?.kill()
    activeTweenRefs.current[i] = tl.tweenTo(tl.duration(), {
      duration: 0.3,
      ease,
      overwrite: 'auto',
    })
  }

  const handleLeave = (i) => {
    const pill = circleRefs.current[i]?.parentElement
    if (pill?.classList.contains('is-active')) return
    const tl = tlRefs.current[i]
    if (!tl) return
    activeTweenRefs.current[i]?.kill()
    activeTweenRefs.current[i] = tl.tweenTo(0, {
      duration: 0.2,
      ease,
      overwrite: 'auto',
    })
  }

  const handleLogoEnter = () => {
    const img = logoImgRef.current
    if (!img) return
    logoTweenRef.current?.kill()
    gsap.set(img, { rotate: 0 })
    logoTweenRef.current = gsap.to(img, {
      rotate: 360,
      duration: 0.2,
      ease,
      overwrite: 'auto',
    })
  }

  const handleSelect = (item) => {
    if (onChange && item.key !== undefined) onChange(item.key)
    setIsMobileMenuOpen(false)
  }

  const toggleMobileMenu = () => {
    const newState = !isMobileMenuOpen
    setIsMobileMenuOpen(newState)

    const hamburger = hamburgerRef.current
    const menu = mobileMenuRef.current

    if (hamburger) {
      const lines = hamburger.querySelectorAll('.hamburger-line')
      if (newState) {
        gsap.to(lines[0], { rotation: 45, y: 3, duration: 0.3, ease })
        gsap.to(lines[1], { rotation: -45, y: -3, duration: 0.3, ease })
      } else {
        gsap.to(lines[0], { rotation: 0, y: 0, duration: 0.3, ease })
        gsap.to(lines[1], { rotation: 0, y: 0, duration: 0.3, ease })
      }
    }

    if (menu) {
      if (newState) {
        gsap.set(menu, { visibility: 'visible' })
        gsap.fromTo(
          menu,
          { opacity: 0, y: 10, scaleY: 1 },
          { opacity: 1, y: 0, scaleY: 1, duration: 0.3, ease, transformOrigin: 'top center' },
        )
      } else {
        gsap.to(menu, {
          opacity: 0,
          y: 10,
          scaleY: 1,
          duration: 0.2,
          ease,
          transformOrigin: 'top center',
          onComplete: () => {
            gsap.set(menu, { visibility: 'hidden' })
          },
        })
      }
    }

    onMobileMenuClick?.()
  }

  const cssVars = {
    '--base': baseColor,
    '--pill-bg': pillColor,
    '--hover-text': hoveredPillTextColor,
    '--pill-text': resolvedPillTextColor,
    '--hover-circle': hoverCircleColor,
    '--active-pill-bg': activePillColor,
    '--active-pill-text': activePillTextColor,
  }

  const renderPillContent = (item, i) => {
    const Icon = item.icon
    const row = (
      <>
        {Icon && (
          <span className="pill-icon" aria-hidden>
            <Icon size={14} />
          </span>
        )}
        <span className="pill-label">{item.label}</span>
      </>
    )

    return (
      <>
        <span
          className="hover-circle"
          aria-hidden="true"
          ref={(el) => {
            circleRefs.current[i] = el
          }}
        />
        <span className="pill-content-row">
          <span className="pill-content">{row}</span>
          <span className="pill-content-hover" aria-hidden="true">
            {row}
          </span>
        </span>
      </>
    )
  }

  return (
    <div className="pill-nav-container">
      <nav className={`pill-nav ${className}`.trim()} aria-label={ariaLabel} style={cssVars}>
        {!hideLogo && logo && (
          <div
            className="pill-logo"
            aria-hidden
            onMouseEnter={handleLogoEnter}
            ref={(el) => {
              logoRef.current = el
            }}
          >
            {typeof logo === 'string' ? (
              <img src={logo} alt={logoAlt} ref={logoImgRef} />
            ) : (
              <span ref={logoImgRef}>{logo}</span>
            )}
          </div>
        )}

        <div className="pill-nav-items desktop-only" ref={navItemsRef}>
          <ul className="pill-list" role="tablist">
            {items.map((item, i) => (
              <li key={item.key ?? item.href ?? `item-${i}`} role="presentation">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive(item)}
                  className={`pill${isActive(item) ? ' is-active' : ''}`}
                  aria-label={item.ariaLabel || item.label}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => handleEnter(i)}
                  onMouseLeave={() => handleLeave(i)}
                >
                  {renderPillContent(item, i)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="mobile-menu-button mobile-only"
          onClick={toggleMobileMenu}
          aria-label="打开导航菜单"
          aria-expanded={isMobileMenuOpen}
          ref={hamburgerRef}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
      </nav>

      <div className="mobile-menu-popover mobile-only" ref={mobileMenuRef} style={cssVars}>
        <ul className="mobile-menu-list">
          {items.map((item, i) => {
            const Icon = item.icon
            return (
              <li key={item.key ?? item.href ?? `mobile-item-${i}`}>
                <button
                  type="button"
                  className={`mobile-menu-link${isActive(item) ? ' is-active' : ''}`}
                  onClick={() => handleSelect(item)}
                >
                  {Icon && <Icon size={15} aria-hidden />}
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
