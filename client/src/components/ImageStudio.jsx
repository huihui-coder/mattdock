import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AlertCircle } from 'lucide-react'

function getToken() {
  return localStorage.getItem('auth_token') || ''
}

function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

function pickImageUrls(data) {
  const list = data?.data || []
  return list
    .map((item) => {
      if (item?.url) return item.url
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`
      return null
    })
    .filter(Boolean)
}

function formatApiError(data, fallback) {
  if (!data) return fallback
  if (typeof data.error === 'string') return data.error
  if (data.error?.message) return data.error.message
  if (data.message) return data.message
  return fallback
}

const DEFAULT_ASPECT_RATIOS = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9',
]

const MODEL_LABELS = {
  'gpt-image-2': 'GPT Image 2',
  'nova-g-image-2': 'Nova G-Image 2',
}

function modelLabel(slug) {
  return MODEL_LABELS[slug] || slug || 'GPT Image 2'
}

function aspectToCss(ratio) {
  if (!ratio || ratio === 'auto') return '1'
  const [w, h] = ratio.split(':').map(Number)
  if (!w || !h) return '1'
  return `${w} / ${h}`
}

function formatDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatRuntime(ms) {
  if (!ms || ms < 1000) return `${Math.round((ms || 0) / 1000)}s`
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function acceptImageFile(file) {
  return file && file.type.startsWith('image/')
}

function newTaskId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function UserPromptBubble({ prompt }) {
  const [expanded, setExpanded] = useState(false)
  const long = prompt.length > 280 || prompt.split('\n').length > 5
  return (
    <div className="bubble">
      <p className={`task-prompt-body m-0 whitespace-pre-wrap ${long && !expanded ? 'is-collapsed' : ''}`}>
        {prompt}
      </p>
      {long && (
        <button type="button" className="bubble-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  )
}

function TaskCard({
  task,
  userInitial,
  onDelete,
  onRegenerate,
  onEditInComposer,
  onCopyPrompt,
  onPreview,
}) {
  const gridCols = Math.min(Math.max(task.count, 1), 4)
  const aspectCss = aspectToCss(task.aspectRatio === 'auto' ? '1:1' : task.aspectRatio)
  const slots = task.status === 'RUNNING'
    ? Array.from({ length: task.count }, (_, i) => ({ type: 'loading', key: `l-${i}` }))
    : (task.results || []).map((url, i) => ({ type: 'result', url, key: `r-${i}` }))

  return (
    <article className="task-card" data-task-id={task.id}>
      <div className="message-row user">
        <div className="avatar user">{userInitial}</div>
        <div className="message-col">
          <div className="message-meta">
            <span>你</span>
            <span>{formatDateTime(task.startedAt)}</span>
          </div>
          {task.references?.length > 0 && (
            <div className="user-reference-strip">
              {task.references.map((ref, i) => (
                <button
                  key={i}
                  type="button"
                  className="user-reference-thumb"
                  onClick={() => onPreview(ref.url)}
                  aria-label={`预览参考图 ${i + 1}`}
                >
                  <img src={ref.url} alt="" />
                </button>
              ))}
            </div>
          )}
          <UserPromptBubble prompt={task.prompt} />
        </div>
      </div>

      <div className="message-row assistant">
        <div className="avatar assistant">✦</div>
        <div className="message-col">
          <div className="message-meta">
            <span className="model-name">{task.modelLabel}</span>
            <span className={`status-badge ${task.status === 'SUCCESS' ? 'success' : task.status === 'FAILED' ? 'failed' : 'loading'}`}>
              <span className="status-dot" />
              <span>{task.status}</span>
            </span>
            <span>{formatDateTime(task.startedAt)}</span>
            {task.status === 'SUCCESS' && (
              <span>
                {task.results.length} 张
              </span>
            )}
          </div>
          <div className="assistant-card">
            {task.status === 'FAILED' ? (
              <p className="text-sm text-red-600 m-0">{task.error || '生成失败'}</p>
            ) : (
              <div
                className={`result-grid count-${gridCols}`}
                style={{
                  '--result-grid-columns': gridCols,
                  '--task-result-aspect-ratio': aspectCss,
                }}
              >
                {slots.map((slot) =>
                  slot.type === 'loading' ? (
                    <div key={slot.key} className="result-unit">
                      <div className="loading-item" aria-label="生成中" />
                    </div>
                  ) : (
                    <div key={slot.key} className="result-unit">
                      <div className="result-item">
                        <img
                          src={slot.url}
                          alt="生成结果"
                          onClick={() => onPreview(slot.url)}
                        />
                      </div>
                      <div className="image-actions">
                        <button type="button" className="image-action-btn" onClick={() => onCopyPrompt(task.prompt)}>
                          ⧉ 复制
                        </button>
                        <button type="button" className="image-action-btn" onClick={() => onEditInComposer(task)}>
                          ✎ 编辑
                        </button>
                        <button type="button" className="image-action-btn" onClick={() => onRegenerate(task)}>
                          ↻ 重新生成
                        </button>
                        <button type="button" className="image-action-btn danger" onClick={() => onDelete(task.id)}>
                          ⌫ 删除
                        </button>
                        <button
                          type="button"
                          className="image-action-btn"
                          onClick={() => downloadUrl(slot.url, task.id)}
                        >
                          ⇩ 下载
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
            <div className="assistant-foot">
              <div className="foot-meta">
                <span>{task.resolution}</span>
                <span>{task.aspectRatio === 'auto' ? 'Auto' : task.aspectRatio}</span>
                {task.count > 1 && <span>×{task.count}</span>}
                {task.runtimeMs != null && (
                  <span className="task-runtime">{formatRuntime(task.runtimeMs)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function downloadUrl(url, id) {
  const a = document.createElement('a')
  a.href = url
  a.download = `image-${id}-${Date.now()}.png`
  a.target = '_blank'
  a.rel = 'noopener'
  a.click()
}

export default function ImageStudio() {
  const [configured, setConfigured] = useState(null)
  const [configHint, setConfigHint] = useState('')
  const [apiOptions, setApiOptions] = useState({
    resolutions: ['1k', '2k', '4k'],
    aspectRatios: DEFAULT_ASPECT_RATIOS,
    counts: [1, 2, 3, 4],
    model: 'gpt-image-2',
  })
  const [tasks, setTasks] = useState([])
  const [prompt, setPrompt] = useState('')
  const [refFiles, setRefFiles] = useState([])
  const [resolution, setResolution] = useState('1k')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [count, setCount] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [userInitial, setUserInitial] = useState('U')

  const fileRef = useRef(null)
  const feedRef = useRef(null)
  const quality = 'high'

  const refPreviews = useMemo(
    () => refFiles.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [refFiles],
  )

  useEffect(() => {
    return () => {
      refPreviews.forEach((r) => URL.revokeObjectURL(r.url))
    }
  }, [refPreviews])

  const scrollFeedToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = feedRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  useEffect(() => {
    apiFetch('/api/image/config')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          setConfigured(false)
          setConfigHint(
            r.status === 401
              ? '请先登录后再使用 AI 生图。'
              : r.status === 403
                ? '当前账号无「AI 生图」权限，请联系管理员开通。'
                : (d.error || `无法读取配置（HTTP ${r.status}）`),
          )
          return
        }
        setConfigured(!!d.configured)
        if (d.configured) setConfigHint('')
        else if (d.hasApiKey === false) {
          setConfigHint(
            '当前运行的服务端未读取到 XOMODEL_API_KEY。请确认 .env 已配置并重启 Node / PM2。',
          )
        } else {
          setConfigHint('服务端未配置 XOMODEL_IMAGE_MODEL，请检查 .env 后重启。')
        }
        if (d.resolutions) {
          setApiOptions((prev) => ({
            ...prev,
            ...d,
            model: (d.model && String(d.model).trim()) || prev.model || 'gpt-image-2',
          }))
        }
      })
      .catch(() => {
        setConfigured(false)
        setConfigHint('无法连接后端（本地开发需 npm run server，端口 3001）。')
      })

    apiFetch('/api/me')
      .then((r) => r.json())
      .then((d) => {
        const name = d.user?.username || ''
        setUserInitial(name ? name.charAt(0).toUpperCase() : 'U')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    scrollFeedToBottom()
  }, [tasks.length, submitting, scrollFeedToBottom])

  const runningCount = tasks.filter((t) => t.status === 'RUNNING').length
  useEffect(() => {
    if (runningCount === 0) return undefined
    const id = setInterval(() => {
      setTasks((prev) =>
        prev.map((t) =>
          t.status === 'RUNNING'
            ? { ...t, runtimeMs: Date.now() - new Date(t.startedAt).getTime() }
            : t,
        ),
      )
    }, 1000)
    return () => clearInterval(id)
  }, [runningCount])

  const addRefFiles = useCallback((files) => {
    const list = [...files].filter(acceptImageFile).slice(0, 3)
    if (!list.length) return
    setRefFiles((prev) => [...prev, ...list].slice(0, 3))
    setAspectRatio('auto')
    setFormError('')
  }, [])

  const removeRef = (index) => {
    setRefFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) {
        setAspectRatio((r) => (r === 'auto' ? '1:1' : r))
      }
      return next
    })
  }

  const isEditMode = refFiles.length > 0

  const aspectOptions = isEditMode
    ? apiOptions.aspectRatios
    : apiOptions.aspectRatios.filter((a) => a !== 'auto')

  const runGeneration = async (params) => {
    const {
      prompt: taskPrompt,
      refFiles: refs,
      resolution: res,
      aspectRatio: ar,
      count: n,
      model: modelName,
    } = params

    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    const taskId = newTaskId()
    const refsSnapshot = (refs || []).map((f) => ({
      url: URL.createObjectURL(f),
      name: f.name,
    }))

    const pending = {
      id: taskId,
      status: 'RUNNING',
      prompt: taskPrompt,
      references: refsSnapshot,
      model: modelName,
      modelLabel: modelLabel(modelName),
      resolution: res,
      aspectRatio: ar,
      count: n,
      results: [],
      startedAt,
      finishedAt: null,
      runtimeMs: null,
      error: null,
      isEdit: refs?.length > 0,
    }

    setTasks((prev) => [...prev, pending])

    try {
      let resHttp
      if (refs?.length > 0) {
        const form = new FormData()
        form.append('model', modelName)
        form.append('prompt', taskPrompt)
        form.append('image', refs[0])
        form.append('resolution', res)
        form.append('aspectRatio', ar)
        form.append('quality', quality)
        form.append('n', String(n))
        form.append('output_format', 'png')
        resHttp = await apiFetch('/api/image/edit', { method: 'POST', body: form })
      } else {
        resHttp = await apiFetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            prompt: taskPrompt,
            n,
            resolution: res,
            aspectRatio: ar,
            quality,
          }),
        })
      }
      const data = await resHttp.json()
      if (!resHttp.ok) throw new Error(formatApiError(data, refs?.length ? '编辑失败' : '生成失败'))
      const urls = pickImageUrls(data)
      if (!urls.length) throw new Error('响应中无图片数据')

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'SUCCESS',
                results: urls,
                finishedAt: new Date().toISOString(),
                runtimeMs: Date.now() - t0,
              }
            : t,
        ),
      )
    } catch (err) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'FAILED',
                error: err.message,
                finishedAt: new Date().toISOString(),
                runtimeMs: Date.now() - t0,
              }
            : t,
        ),
      )
      throw err
    }
  }

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!prompt.trim()) {
      setFormError('请输入提示词')
      return
    }
    if (configured === false) return

    const modelName = (apiOptions.model && String(apiOptions.model).trim()) || 'gpt-image-2'
    const params = {
      prompt: prompt.trim(),
      refFiles: [...refFiles],
      resolution,
      aspectRatio,
      count,
      model: modelName,
    }

    setSubmitting(true)
    setFormError('')
    try {
      await runGeneration(params)
      setPrompt('')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegenerate = async (task) => {
    setSubmitting(true)
    setFormError('')
    try {
      await runGeneration({
        prompt: task.prompt,
        refFiles: [],
        resolution: task.resolution,
        aspectRatio: task.aspectRatio,
        count: task.count,
        model: task.model,
      })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEditInComposer = (task) => {
    setPrompt(task.prompt)
    setResolution(task.resolution)
    setAspectRatio(task.aspectRatio)
    setCount(task.count)
    setRefFiles([])
    setFormError('')
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  const handleCopyPrompt = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  const handlePreview = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const file = item.getAsFile()
    if (file) addRefFiles([file])
  }

  const onDropComposer = (e) => {
    e.preventDefault()
    const files = [...(e.dataTransfer?.files || [])]
    if (files.length) addRefFiles(files)
  }

  return (
    <div className="image-studio">
      {configured === false && configHint && (
        <div className="ui-card p-3 mb-3 flex items-start gap-2 border-amber-200 bg-amber-50" role="alert">
          <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={16} />
          <p className="text-sm text-amber-900 m-0">{configHint}</p>
        </div>
      )}

      <section className="chat-panel">
        <div ref={feedRef} className="task-stream">
          {tasks.length === 0 && (
            <div className="feed-empty">
              <p className="m-0 text-slate-500">在下方输入提示词开始创作</p>
              <p className="m-0 mt-1 text-xs">支持多图参考（图生图）、多分辨率与批量生成</p>
            </div>
          )}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              userInitial={userInitial}
              onDelete={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
              onRegenerate={handleRegenerate}
              onEditInComposer={handleEditInComposer}
              onCopyPrompt={handleCopyPrompt}
              onPreview={handlePreview}
            />
          ))}
        </div>

        <section className="composer is-docked">
          <form className="composer-form" onSubmit={handleSubmit}>
            <div className="composer-top" onDragOver={(e) => e.preventDefault()} onDrop={onDropComposer}>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  addRefFiles([...(e.target.files || [])])
                  e.target.value = ''
                }}
              />
              <div className="prompt-input-wrap">
                <button
                  type="button"
                  className="prompt-upload"
                  title="添加参考图"
                  onClick={() => fileRef.current?.click()}
                >
                  ▧
                </button>
                {refPreviews.length > 0 && (
                  <div className="reference-preview-list">
                    {refPreviews.map((r, i) => (
                      <div key={r.url} className="reference-thumb-wrap">
                        <img src={r.url} alt="" />
                        <button
                          type="button"
                          className="reference-thumb-remove"
                          aria-label="移除"
                          onClick={() => removeRef(i)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={onPaste}
                  rows={3}
                  maxLength={8000}
                  placeholder="在这里输入提示词，回车换行。"
                  className="prompt-textarea"
                />
              </div>
            </div>

            <div className="composer-control-row">
              <label className="mini-field">
                <span>模型</span>
                <select disabled className="opacity-70" title={apiOptions.model}>
                  <option>{modelLabel(apiOptions.model)}</option>
                </select>
              </label>
              <label className="mini-field">
                <span>分辨率</span>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  {apiOptions.resolutions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="mini-field">
                <span>宽高比</span>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                  {aspectOptions.map((a) => (
                    <option key={a} value={a}>{a === 'auto' ? 'Auto' : a}</option>
                  ))}
                </select>
              </label>
              <label className="mini-field">
                <span>数量</span>
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {apiOptions.counts.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="generate-btn"
                disabled={submitting || configured === false}
                aria-busy={submitting}
              >
                <span className="generate-icon">✦</span>
                <span>{submitting ? '生成中…' : '生成'}</span>
              </button>
            </div>
            {formError && (
              <p className="text-xs text-red-600 m-0" role="alert">{formError}</p>
            )}
            {isEditMode && (
              <p className="text-xs text-violet-600 m-0">已附加参考图 · 图生图（多张时仅用第一张）</p>
            )}
          </form>
        </section>
      </section>
    </div>
  )
}
