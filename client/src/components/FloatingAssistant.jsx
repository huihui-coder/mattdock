import { useState, useEffect, useRef, useCallback } from 'react'
import { Minus, X, Send, ImagePlus, Trash2 } from 'lucide-react'
import {
  loadAssistantMessages,
  saveAssistantMessages,
  clearAssistantMessages,
} from '../lib/assistant-storage'
import {
  AssistantRichText,
  stripAssistantNoise,
} from '../lib/assistant-message-format'
import {
  loadFabPosition,
  saveFabPosition,
  defaultFabPosition,
  snapFabToRightEdge,
  FAB_EDGE_MARGIN,
} from '../lib/assistant-fab-position'
import { applyGreenScreenKey } from '../lib/video-chroma-key'

const ROBOT = {
  idle: '/images/robot/空闲.png',
  thinking: '/images/robot/思考.png',
  alert: '/images/robot/告警.png',
  success: '/images/robot/成功.png',
  error: '/images/robot/失败.png',
  listen: '/images/robot/倾听.png',
}

/** 待机动画（使用你提供的源文件，仓库不覆盖） */
const IDLE_VIDEO_SRC = '/videos/robot-idle-new.mp4'

/** 每次播完待机动画后静止间隔（毫秒） */
const IDLE_PLAY_GAP_MS = 5000

const QUICK_PROMPTS = [
  { label: '解读告警', text: '请根据当前近期告警，逐条用通俗语言解读原因和建议操作。' },
  { label: '今日摘要', text: '根据当前设备与告警快照，生成一段简短的值班摘要（概况、风险点、待办）。' },
  { label: '问当前设备', text: '请说明当前关注设备的运行状态与需要注意的事项。' },
]

function getToken() {
  return localStorage.getItem('auth_token') || ''
}

function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

function newId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function RobotAvatar({ state, className = '', alt = '飞行助手' }) {
  return (
    <img
      src={ROBOT[state] || ROBOT.idle}
      alt={alt}
      className={`floating-assistant__robot ${className}`}
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
        className={`floating-assistant__robot floating-assistant__robot-canvas ${className}`}
        aria-label={alt || undefined}
      />
    </>
  )

  if (isFab) {
    return <span className="floating-assistant__fab-media">{mediaInner}</span>
  }
  return <span className="floating-assistant__mascot-media">{mediaInner}</span>
}

function RobotMascot({
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
    return (
      <RobotIdleVideo className={className} alt={alt} />
    )
  }
  return <RobotAvatar state={state} className={className} alt={alt} />
}

export default function FloatingAssistant({ context, alertCount = 0 }) {
  const [open, setOpen] = useState(false)
  const [configured, setConfigured] = useState(null)
  const [messages, setMessages] = useState(() => loadAssistantMessages())
  const [input, setInput] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [mascotState, setMascotState] = useState('idle')
  const feedRef = useRef(null)
  const fileRef = useRef(null)
  const rootRef = useRef(null)
  const fabDragRef = useRef(null)
  const [fabPos, setFabPos] = useState(() => loadFabPosition())
  const [fabDragging, setFabDragging] = useState(false)

  useEffect(() => {
    saveAssistantMessages(messages)
  }, [messages])

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages, open, streaming])

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/assistant/config')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setConfigured(!!d.configured)
      })
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const badge = alertCount > 0 ? Math.min(alertCount, 99) : 0
  const fabMascot = mascotState === 'thinking' ? 'thinking' : 'idle'

  useEffect(() => {
    if (fabPos) return
    setFabPos(defaultFabPosition())
  }, [fabPos])

  useEffect(() => {
    const onResize = () => {
      setFabPos((prev) => {
        if (!prev) return defaultFabPosition()
        const el = rootRef.current
        const w = el?.offsetWidth || 59
        const h = el?.offsetHeight || 59
        return snapFabToRightEdge(prev.top, w, h)
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onFabPointerDown = (e) => {
    if (e.button !== 0) return
    const root = rootRef.current
    if (!root) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = root.getBoundingClientRect()
    fabDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    }
  }

  const onFabPointerMove = (e) => {
    const drag = fabDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 5) {
      drag.moved = true
      setFabDragging(true)
    }
    setFabPos({ left: drag.originLeft + dx, top: drag.originTop + dy })
  }

  const finishFabPointer = (e, toggleIfClick) => {
    const drag = fabDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    fabDragRef.current = null
    setFabDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const el = rootRef.current
    const w = el?.offsetWidth || 59
    const h = el?.offsetHeight || 59
    setFabPos((prev) => {
      const base = prev || defaultFabPosition(w, h)
      const snapped = snapFabToRightEdge(base.top, w, h)
      saveFabPosition(snapped)
      return snapped
    })
    if (toggleIfClick && !drag.moved) setOpen((v) => !v)
  }

  const onFabPointerUp = (e) => finishFabPointer(e, true)
  const onFabPointerCancel = (e) => finishFabPointer(e, false)

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const sendMessage = useCallback(
    async (textOverride) => {
      const text = (textOverride ?? input).trim()
      if (!text && !imageFile) return
      if (configured === false) {
        setError('服务端未配置智谱 API，请联系管理员')
        return
      }
      if (streaming) return

      setError('')
      setStreaming(true)
      setMascotState('thinking')

      let imageBase64
      let imageMime
      if (imageFile) {
        const dataUrl = await readFileAsBase64(imageFile)
        imageBase64 = dataUrl
        imageMime = imageFile.type || 'image/png'
      }

      const history = messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .map((m) => ({ role: m.role, content: m.content }))

      const userMsg = {
        id: newId(),
        role: 'user',
        content: text,
        imagePreview: imagePreview || undefined,
        createdAt: new Date().toISOString(),
      }
      const assistantId = newId()
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
      ])
      setInput('')
      setImageFile(null)
      setImagePreview(null)

      try {
        const res = await apiFetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: text,
            history,
            context,
            imageBase64,
            imageMime,
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const msg = data.error?.message || data.error || data.message || `请求失败 ${res.status}`
          throw new Error(typeof msg === 'string' ? msg : '助手请求失败')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let acc = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            const payload = t.slice(5).trim()
            if (payload === '[DONE]') continue
            try {
              const json = JSON.parse(payload)
              const delta = json.choices?.[0]?.delta
              if (delta?.content) {
                acc += delta.content
                const display = stripAssistantNoise(acc)
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: display } : m)),
                )
              }
            } catch {
              /* skip */
            }
          }
        }

        const finalText = stripAssistantNoise(acc)
        if (!finalText) {
          throw new Error('模型未返回内容')
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: finalText } : m)),
        )
        setMascotState('success')
      } catch (e) {
        setMascotState('error')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: e.message || '请求失败', failed: true }
              : m,
          ),
        )
        setError(e.message || '发送失败')
      } finally {
        setStreaming(false)
        setTimeout(() => setMascotState(badge > 0 ? 'alert' : 'idle'), 1200)
      }
    },
    [input, imageFile, imagePreview, configured, streaming, messages, context, badge],
  )

  const attachImageFile = useCallback((file) => {
    if (!file?.type?.startsWith('image/')) return
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setImageFile(file)
    setMascotState('listen')
  }, [])

  const onPickImage = (e) => {
    const file = e.target.files?.[0]
    if (file) attachImageFile(file)
    e.target.value = ''
  }

  const onPasteImage = useCallback(
    (e) => {
      if (streaming) return
      const items = e.clipboardData?.items
      if (!items?.length) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            attachImageFile(file)
            return
          }
        }
      }
    },
    [streaming, attachImageFile],
  )

  const onClearHistory = () => {
    if (!window.confirm('清空本地对话记录？')) return
    clearAssistantMessages()
    setMessages([])
    setError('')
  }

  if (configured === null) return null

  const rootStyle =
    fabPos != null
      ? { left: fabPos.left, top: fabPos.top, right: 'auto', bottom: 'auto' }
      : { right: `${FAB_EDGE_MARGIN}px`, bottom: `${FAB_EDGE_MARGIN}px`, left: 'auto', top: 'auto' }

  return (
    <div
      ref={rootRef}
      className="floating-assistant"
      style={rootStyle}
      aria-live="polite"
    >
      {open && (
        <div className="floating-assistant__scrim" onClick={() => setOpen(false)} aria-hidden />
      )}

      {open && (
        <div
          className="floating-assistant__panel"
          role="dialog"
          aria-label="飞行助手"
        >
          <header className="floating-assistant__header">
            <div className="floating-assistant__header-mascot">
              <RobotMascot state={streaming ? 'thinking' : 'idle'} useIdleVideo={!streaming} />
            </div>
            <div className="floating-assistant__header-text">
              <h2 className="floating-assistant__title">飞行助手</h2>
              <p className="floating-assistant__subtitle">基于当前监控数据</p>
            </div>
            <div className="floating-assistant__header-actions">
              <button
                type="button"
                className="floating-assistant__icon-btn"
                onClick={() => setOpen(false)}
                aria-label="最小化"
              >
                <Minus size={16} />
              </button>
              <button
                type="button"
                className="floating-assistant__icon-btn"
                onClick={() => setOpen(false)}
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          <div className="floating-assistant__quick">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                className="floating-assistant__chip"
                disabled={streaming}
                onClick={() => sendMessage(q.text)}
              >
                {q.label}
              </button>
            ))}
            <button
              type="button"
              className="floating-assistant__chip floating-assistant__chip--ghost"
              onClick={onClearHistory}
              title="清空记录"
            >
              <Trash2 size={12} />
            </button>
          </div>

          <div className="floating-assistant__feed" ref={feedRef}>
            {messages.length === 0 && (
              <div className="floating-assistant__welcome">
                <RobotMascot
                  state={badge > 0 ? 'alert' : 'idle'}
                  className="is-lg"
                  useIdleVideo={badge === 0}
                />
                <p>
                  你好，我是飞行助手。
                  {badge > 0
                    ? ` 检测到 ${badge} 条近期告警，需要我帮你解读吗？`
                    : ' 有什么监控或告警问题可以问我。'}
                </p>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`floating-assistant__msg floating-assistant__msg--${m.role}${m.failed ? ' is-failed' : ''}`}
              >
                {m.role === 'assistant' && (
                  <RobotAvatar
                    state={
                      m.failed
                        ? 'error'
                        : streaming && m.id === lastAssistantId && !stripAssistantNoise(m.content)
                          ? 'thinking'
                          : 'success'
                    }
                    className="is-sm"
                  />
                )}
                <div className="floating-assistant__bubble">
                  {m.imagePreview && (
                    <img src={m.imagePreview} alt="" className="floating-assistant__thumb" />
                  )}
                  {m.role === 'assistant' ? (
                    m.failed ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : m.content ? (
                      <AssistantRichText content={m.content} />
                    ) : streaming && m.id === lastAssistantId ? (
                      <span className="floating-assistant__typing">正在回复…</span>
                    ) : null
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}
            {streaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="floating-assistant__msg floating-assistant__msg--assistant">
                <RobotAvatar state="thinking" className="is-sm" />
                <span className="floating-assistant__typing">正在思考…</span>
              </div>
            )}
          </div>

          <footer className="floating-assistant__composer">
            {imagePreview && (
              <div className="floating-assistant__attach-preview">
                <img src={imagePreview} alt="" />
                <button
                  type="button"
                  className="floating-assistant__attach-remove"
                  onClick={() => {
                    setImageFile(null)
                    setImagePreview((prev) => {
                      if (prev) URL.revokeObjectURL(prev)
                      return null
                    })
                  }}
                  aria-label="移除图片"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="floating-assistant__composer-row">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPickImage}
              />
              <button
                type="button"
                className="floating-assistant__icon-btn"
                onClick={() => fileRef.current?.click()}
                disabled={streaming}
                aria-label="上传图片"
              >
                <ImagePlus size={16} />
              </button>
              <textarea
                className="floating-assistant__input"
                rows={2}
                placeholder="输入问题，可粘贴或上传图片"
                value={input}
                disabled={streaming}
                onFocus={() => setMascotState('listen')}
                onBlur={() => !streaming && setMascotState(badge > 0 ? 'alert' : 'idle')}
                onChange={(e) => setInput(e.target.value)}
                onPaste={onPasteImage}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
              />
              <button
                type="button"
                className="floating-assistant__send"
                disabled={streaming || (!input.trim() && !imageFile)}
                onClick={() => sendMessage()}
                aria-label="发送"
              >
                <Send size={16} />
              </button>
            </div>
            {error && <p className="floating-assistant__error">{error}</p>}
            <p className="floating-assistant__hint">
              仅供参考，严重操作请人工确认 · Ctrl+/ 开关
            </p>
          </footer>
        </div>
      )}

      <button
        type="button"
        className={`floating-assistant__fab floating-assistant__fab--idle${fabDragging ? ' is-dragging' : ''}`}
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        onPointerCancel={onFabPointerCancel}
        aria-expanded={open}
        aria-label={open ? '收起飞行助手' : '打开飞行助手，可拖动'}
      >
        {fabMascot === 'thinking' ? (
          <RobotAvatar state="thinking" className="is-fab" alt="" />
        ) : (
          <RobotIdleVideo className="is-fab" alt="" />
        )}
        {badge > 0 && (
          <span className="floating-assistant__badge" aria-label={`${badge} 条告警`}>
            {badge}
          </span>
        )}
      </button>
    </div>
  )
}
