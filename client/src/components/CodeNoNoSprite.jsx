import { useEffect, useMemo, useState } from 'react'
import {
  ASSISTANT_SKINS,
  CODENONO_ATLAS,
  CODENONO_ROW_FRAME_COUNT,
  CODENONO_STATE_ROW,
} from '../lib/assistant-skin'

const SPRITESHEET = ASSISTANT_SKINS.codenono.spritesheet

function getDisplayWidth(className) {
  if (className.includes('is-profile')) return 56
  if (className.includes('is-lg')) return 80
  if (className.includes('is-sm')) return 40
  if (className.includes('is-fab')) return 58
  return 64
}

export default function CodeNoNoSprite({
  state = 'idle',
  className = '',
  alt = 'CodeNoNo',
  animate = true,
  frameInterval = 130,
}) {
  const [frame, setFrame] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)
  const row = CODENONO_STATE_ROW[state] ?? CODENONO_STATE_ROW.idle
  const frameCount = CODENONO_ROW_FRAME_COUNT[row] ?? 6
  const displayW = getDisplayWidth(className)
  const scale = displayW / CODENONO_ATLAS.frameWidth
  const displayH = Math.round(CODENONO_ATLAS.frameHeight * scale)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setFrame(0)
  }, [row])

  useEffect(() => {
    if (!animate || reduceMotion) return undefined
    const timer = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % frameCount)
    }, frameInterval)
    return () => window.clearInterval(timer)
  }, [animate, reduceMotion, row, frameCount, frameInterval])

  const style = useMemo(() => {
    const col = animate && !reduceMotion ? frame : 0
    return {
      width: `${displayW}px`,
      height: `${displayH}px`,
      backgroundImage: `url(${SPRITESHEET})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${CODENONO_ATLAS.sheetWidth * scale}px ${CODENONO_ATLAS.sheetHeight * scale}px`,
      backgroundPosition: `${-col * CODENONO_ATLAS.frameWidth * scale}px ${-row * CODENONO_ATLAS.frameHeight * scale}px`,
    }
  }, [animate, reduceMotion, frame, row, scale, displayW, displayH])

  return (
    <span
      role="img"
      aria-label={alt}
      className={`floating-assistant__codenono ${className}`.trim()}
      style={style}
    />
  )
}
