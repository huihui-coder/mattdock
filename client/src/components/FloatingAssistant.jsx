import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Minus, X, Send, ImagePlus, Trash2 } from 'lucide-react'
import {
  loadAssistantMessages,
  saveAssistantMessages,
  clearAssistantMessages,
  loadReadCursor,
  saveReadCursor,
  countUnreadAssistantMessages,
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
import {
  pickIdlePhrase,
  IDLE_SPEECH_INTERVAL_MS,
  IDLE_SPEECH_FIRST_SHOW_MS,
  IDLE_SPEECH_VISIBLE_MS,
  IDLE_TYPE_CURSOR_BLINK_DURATION_S,
  IDLE_TYPE_INITIAL_DELAY_MS,
} from '../lib/assistant-idle-phrases'
import TextType from './TextType'
import { AssistantAvatar, AssistantFabMascot, AssistantMascot } from './AssistantMascot'

const QUICK_PROMPTS = [
  { label: '解读告警', text: '请根据当前近期告警，逐条用通俗语言解读原因和建议操作。' },
  { label: '今日摘要', text: '根据当前设备、告警与飞行记录快照，生成一段简短的值班摘要（概况、风险点、待办）。' },
  { label: '飞行记录', text: '请根据近期飞行记录，汇总飞行频次、里程、时长，并指出值得关注的情况。' },
  { label: '问当前设备', text: '请说明当前关注设备的运行状态、近期飞行情况与需要注意的事项。' },
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

function AssistantIdleBubble({ text, visible, panelOpen }) {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  if (panelOpen || !visible || !text) return null
  const compact = text.length <= 14

  return (
    <div className="floating-assistant__idle-bubble-anchor">
      <div
        className={`floating-assistant__idle-bubble${compact ? ' is-compact' : ''}`}
        role="status"
        aria-live="polite"
        aria-label={text}
      >
        {reduceMotion ? (
          text
        ) : (
          <TextType
            key={text}
            as="span"
            text={text}
            typingSpeed={72}
            cursorBlinkDuration={IDLE_TYPE_CURSOR_BLINK_DURATION_S}
            initialDelay={IDLE_TYPE_INITIAL_DELAY_MS}
            loop={false}
            showCursor
            cursorCharacter="|"
            variableSpeed={{ min: 48, max: 96 }}
            className="floating-assistant__idle-type"
            cursorClassName="floating-assistant__idle-type-cursor"
          />
        )}
      </div>
    </div>
  )
}

export default function FloatingAssistant({ context }) {
  const [open, setOpen] = useState(false)
  const [configured, setConfigured] = useState(null)
  const [assistantModelName, setAssistantModelName] = useState('')
  const [messages, setMessages] = useState(() => loadAssistantMessages())
  const [readCursor, setReadCursor] = useState(() => loadReadCursor(loadAssistantMessages().length))
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
  const [fabWalkDir, setFabWalkDir] = useState(null)
  const [idlePhrase, setIdlePhrase] = useState('')
  const [idleBubbleVisible, setIdleBubbleVisible] = useState(false)
  const lastIdlePhraseRef = useRef('')
  const idleHideTimerRef = useRef(null)
  const idleIntervalRef = useRef(null)
  const pageEnteredAtRef = useRef(Date.now())
  const firstIdleFiredRef = useRef(false)
  const openRef = useRef(false)
  const streamingRef = useRef(false)
  const fabDraggingRef = useRef(false)

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
        if (!cancelled) {
          setConfigured(!!d.configured)
          setAssistantModelName(d.modelName || d.model || '')
        }
      })
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])

  useEffect(() => {
    fabDraggingRef.current = fabDragging
  }, [fabDragging])

  const dismissIdleBubble = useCallback(() => {
    if (idleHideTimerRef.current) {
      window.clearTimeout(idleHideTimerRef.current)
      idleHideTimerRef.current = null
    }
    setIdleBubbleVisible(false)
    window.setTimeout(() => setIdlePhrase(''), 280)
  }, [])

  const showIdlePhrase = useCallback(() => {
    if (openRef.current || streamingRef.current || fabDraggingRef.current) return
    const phrase = pickIdlePhrase(lastIdlePhraseRef.current)
    lastIdlePhraseRef.current = phrase
    setIdlePhrase(phrase)
    setIdleBubbleVisible(true)
    if (idleHideTimerRef.current) window.clearTimeout(idleHideTimerRef.current)
    idleHideTimerRef.current = window.setTimeout(dismissIdleBubble, IDLE_SPEECH_VISIBLE_MS)
  }, [dismissIdleBubble])

  useEffect(() => {
    if (!open) return
    dismissIdleBubble()
  }, [open, dismissIdleBubble])

  useEffect(() => {
    if (open || streaming || configured === false) {
      dismissIdleBubble()
      return undefined
    }

    let firstTimer
    if (!firstIdleFiredRef.current) {
      const elapsed = Date.now() - pageEnteredAtRef.current
      const firstDelay = Math.max(0, IDLE_SPEECH_FIRST_SHOW_MS - elapsed)
      firstTimer = window.setTimeout(() => {
        firstIdleFiredRef.current = true
        showIdlePhrase()
      }, firstDelay)
    }

    idleIntervalRef.current = window.setInterval(showIdlePhrase, IDLE_SPEECH_INTERVAL_MS)

    return () => {
      if (firstTimer) window.clearTimeout(firstTimer)
      window.clearInterval(idleIntervalRef.current)
      dismissIdleBubble()
    }
  }, [open, streaming, configured, showIdlePhrase, dismissIdleBubble])

  useEffect(() => {
    if (fabDragging) dismissIdleBubble()
  }, [fabDragging, dismissIdleBubble])

  useEffect(() => {
    if (!open) return
    const idx = messages.length
    setReadCursor(idx)
    saveReadCursor(idx)
  }, [open, messages.length])

  const unreadCount = useMemo(() => {
    if (open) return 0
    return countUnreadAssistantMessages(messages, readCursor)
  }, [messages, readCursor, open])

  const badge = unreadCount > 0 ? Math.min(unreadCount, 99) : 0
  const fabMascot = useMemo(() => {
    if (fabDragging) {
      return fabWalkDir === 'right' ? 'running-right' : 'running-left'
    }
    if (mascotState === 'thinking') return 'thinking'
    return 'idle'
  }, [fabDragging, fabWalkDir, mascotState])

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
    if (drag.moved) {
      if (Math.abs(dx) > 2) {
        setFabWalkDir(dx >= 0 ? 'right' : 'left')
      } else if (Math.abs(dy) > 2) {
        setFabWalkDir((prev) => prev || 'left')
      }
    }
    setFabPos({ left: drag.originLeft + dx, top: drag.originTop + dy })
  }

  const finishFabPointer = (e, toggleIfClick) => {
    const drag = fabDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    fabDragRef.current = null
    setFabDragging(false)
    setFabWalkDir(null)
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
        setError('服务端未配置火山方舟 API，请联系管理员')
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
        setTimeout(() => setMascotState('idle'), 1200)
      }
    },
    [input, imageFile, imagePreview, configured, streaming, messages, context],
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
    setReadCursor(0)
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
              <AssistantMascot state={streaming ? 'thinking' : 'idle'} useIdleVideo={!streaming} />
            </div>
            <div className="floating-assistant__header-text">
              <h2 className="floating-assistant__title">飞行助手</h2>
              <p className="floating-assistant__subtitle">
                {assistantModelName ? `火山方舟 · ${assistantModelName}` : '基于监控数据与飞行记录'}
              </p>
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
                <AssistantMascot
                  state="idle"
                  className="is-lg"
                  useIdleVideo
                />
                <p>
                  你好，我是飞行助手。
                  {badge > 0
                    ? ` 你有 ${badge} 条未读回复，点开看看？`
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
                  <AssistantAvatar
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
                <AssistantAvatar state="thinking" className="is-sm" />
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
                onBlur={() => !streaming && setMascotState('idle')}
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

      <div className="floating-assistant__fab-wrap">
        <AssistantIdleBubble
          text={idlePhrase}
          visible={idleBubbleVisible && !streaming && !fabDragging}
          panelOpen={open}
        />
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
          <AssistantFabMascot state={fabMascot} className="is-fab" alt="" />
          {badge > 0 && (
            <span className="floating-assistant__badge" aria-label={`${badge} 条未读回复`}>
              {badge}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
