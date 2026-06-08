import { useState, useEffect, useRef, useCallback } from 'react'
import { applyGreenScreenKey } from '../lib/video-chroma-key'
import {
  ASSISTANT_SKIN_CHANGE_EVENT,
  loadAssistantSkin,
} from '../lib/assistant-skin'
import CodeNoNoSprite from './CodeNoNoSprite'

const ROBOT = {
  idle: '/images/robot/空闲.png',
  thinking: '/images/robot/思考.png',
  alert: '/images/robot/告警.png',
  success: '/images/robot/成功.png',
  error: '/images/robot/失败.png',
  listen: '/images/robot/倾听.png',
}

const IDLE_VIDEO_SRC = '/videos/robot-idle-new.mp4'
const IDLE_PLAY_GAP_MS = 5000

export function useAssistantSkinId() {
  const [skinId, setSkinId] = useState(() => loadAssistantSkin())

  useEffect(() => {
    const onChange = (event) => {
      setSkinId(event.detail?.skinId ?? loadAssistantSkin())
    }
    window.addEventListener(ASSISTANT_SKIN_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(ASSISTANT_SKIN_CHANGE_EVENT, onChange)
  }, [])

  return skinId
}

function RobotAvatar({ state, className = '', alt = '飞行助手' }) {
  return (
    <img
      src={ROBOT[state] || ROBOT.idle}
      alt={alt}
      className={`floating-assistant__robot ${className}`.trim()}
      draggable={false}
    />
  )
}

function RobotIdleVideo({ className = '', alt = '飞行助手' }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const gapTimerRef = useRef(null)
  const cycleLockRef = useRef(false)
  const [fallback, setFallback] = useState(false)
  const isFab = className.includes('is-fab')

  const drawChromaFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(video, 0, 0, w, h)
    const frame = ctx.getImageData(0, 0, w, h)
    applyGreenScreenKey(frame)
    ctx.putImageData(frame, 0, 0)
  }, [])

  useEffect(() => {
    if (fallback) return undefined

    const tick = () => {
      drawChromaFrame()
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [fallback, drawChromaFrame])

  useEffect(() => {
    if (fallback) return undefined
    const video = videoRef.current
    if (!video) return undefined

    const clearGapTimer = () => {
      if (gapTimerRef.current) {
        window.clearTimeout(gapTimerRef.current)
        gapTimerRef.current = null
      }
    }

    const pauseAtFirstFrame = () => {
      video.currentTime = 0
      video.pause()
    }

    const playCycle = () => {
      clearGapTimer()
      cycleLockRef.current = false
      video.currentTime = 0
      const p = video.play()
      if (p?.catch) p.catch(() => {})
    }

    const scheduleNextCycle = () => {
      if (cycleLockRef.current) return
      cycleLockRef.current = true
      pauseAtFirstFrame()
      clearGapTimer()
      gapTimerRef.current = window.setTimeout(playCycle, IDLE_PLAY_GAP_MS)
    }

    const onEnded = () => scheduleNextCycle()

    const onTimeUpdate = () => {
      const d = video.duration
      if (!d || Number.isNaN(d) || video.paused) return
      if (video.currentTime >= d - 0.12) scheduleNextCycle()
    }

    const onLoadedData = () => {
      pauseAtFirstFrame()
      clearGapTimer()
      gapTimerRef.current = window.setTimeout(playCycle, 120)
    }

    video.addEventListener('ended', onEnded)
    video.addEventListener('timeupdate', onTimeUpdate)
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      onLoadedData()
    } else {
      video.addEventListener('loadeddata', onLoadedData, { once: true })
    }

    const failTimer = window.setTimeout(() => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        setFallback(true)
      }
    }, 3000)

    return () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('timeupdate', onTimeUpdate)
      window.clearTimeout(failTimer)
      clearGapTimer()
      cycleLockRef.current = false
    }
  }, [fallback])

  if (fallback) {
    return <RobotAvatar state="idle" className={className} alt={alt} />
  }

  const mediaInner = (
    <>
      <video
        ref={videoRef}
        src={IDLE_VIDEO_SRC}
        className="floating-assistant__robot-video--source"
        muted
        playsInline
        preload="auto"
        aria-hidden
        onError={() => setFallback(true)}
      />
      <canvas
        ref={canvasRef}
        className={`floating-assistant__robot floating-assistant__robot-canvas ${className}`.trim()}
        aria-label={alt || undefined}
      />
    </>
  )

  if (isFab) {
    return <span className="floating-assistant__fab-media">{mediaInner}</span>
  }
  return <span className="floating-assistant__mascot-media">{mediaInner}</span>
}

function DefaultMascot({
  state = 'idle',
  className = '',
  alt = '飞行助手',
  useIdleVideo = true,
}) {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  if (useIdleVideo && state === 'idle' && !reduceMotion) {
    return <RobotIdleVideo className={className} alt={alt} />
  }
  return <RobotAvatar state={state} className={className} alt={alt} />
}

function CodeNoNoMascot({
  state = 'idle',
  className = '',
  alt = 'CodeNoNo',
  animate = true,
  frameInterval = 130,
}) {
  const isFab = className.includes('is-fab')
  const sprite = (
    <CodeNoNoSprite
      state={state}
      className={className}
      alt={alt}
      animate={animate}
      frameInterval={frameInterval}
    />
  )
  if (isFab) {
    return <span className="floating-assistant__fab-media floating-assistant__fab-media--codenono">{sprite}</span>
  }
  return sprite
}

function isWalkState(state) {
  return state === 'running-left' || state === 'running-right'
}

export function AssistantAvatar({ state, className = '', alt = '飞行助手' }) {
  const skinId = useAssistantSkinId()
  if (skinId === 'codenono') {
    return (
      <CodeNoNoSprite
        state={state}
        className={className}
        alt={alt}
        animate={state === 'thinking' || state === 'idle' || state === 'listen'}
      />
    )
  }
  return <RobotAvatar state={state} className={className} alt={alt} />
}

export function AssistantFabMascot({ state = 'idle', className = '', alt = '' }) {
  const skinId = useAssistantSkinId()
  if (skinId === 'codenono') {
    if (isWalkState(state)) {
      return (
        <CodeNoNoMascot
          state={state}
          className={className}
          alt={alt || 'CodeNoNo'}
          frameInterval={95}
        />
      )
    }
    if (state === 'thinking') {
      return (
        <CodeNoNoMascot
          state="thinking"
          className={className}
          alt={alt || 'CodeNoNo'}
        />
      )
    }
    return <CodeNoNoMascot state="idle" className={className} alt={alt || 'CodeNoNo'} />
  }
  if (state === 'thinking') {
    return <RobotAvatar state="thinking" className={className} alt={alt || '飞行助手'} />
  }
  return <RobotIdleVideo className={className} alt={alt || '飞行助手'} />
}

export function AssistantFabIdle({ className = '', alt = '' }) {
  return <AssistantFabMascot state="idle" className={className} alt={alt} />
}

export function AssistantMascot({
  state = 'idle',
  className = '',
  alt = '飞行助手',
  useIdleVideo = true,
}) {
  const skinId = useAssistantSkinId()
  if (skinId === 'codenono') {
    return (
      <CodeNoNoMascot
        state={state}
        className={className}
        alt={alt}
        animate={state === 'idle' || state === 'thinking' || state === 'listen'}
      />
    )
  }
  return (
    <DefaultMascot
      state={state}
      className={className}
      alt={alt}
      useIdleVideo={useIdleVideo}
    />
  )
}
