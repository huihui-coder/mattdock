import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, Loader2, Download, AlertCircle, X, ImagePlus } from 'lucide-react'

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
    .map(item => {
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

const ASPECT_LABELS = {
  auto: 'Auto',
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
  '3:2': '3:2',
  '2:3': '2:3',
  '5:4': '5:4',
  '4:5': '4:5',
  '21:9': '21:9',
}

function acceptImageFile(file) {
  return file && file.type.startsWith('image/')
}

function MiniField({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-medium text-slate-500 leading-tight">
        {label}
        {hint && <small className="block text-[10px] text-slate-400 font-normal mt-0.5">{hint}</small>}
      </span>
      {children}
    </label>
  )
}

export default function ImageStudio() {
  const [configured, setConfigured] = useState(null)
  const [configHint, setConfigHint] = useState('')
  const [apiOptions, setApiOptions] = useState({
    resolutions: ['1k', '2k', '4k'],
    aspectRatios: DEFAULT_ASPECT_RATIOS,
    counts: [1, 2, 3, 4],
    qualities: ['low', 'medium', 'high'],
    model: 'gpt-image-2',
  })
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState('1k')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [count, setCount] = useState(1)
  const [quality, setQuality] = useState('high')
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [resultUrls, setResultUrls] = useState([])
  const [resultMeta, setResultMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const isEditMode = !!imageFile

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
        if (d.configured) {
          setConfigHint('')
        } else if (d.hasApiKey === false) {
          setConfigHint(
            '当前运行的服务端未读取到 XOMODEL_API_KEY。若在本地已写入 .env，请确认已启动 npm run server 并重启；若访问的是线上地址，请在服务器项目目录的 .env 中配置后执行 pm2 restart haizhu-monitor。',
          )
        } else {
          setConfigHint('服务端未配置生图模型名 XOMODEL_IMAGE_MODEL，请检查 .env 后重启。')
        }
        if (d.resolutions) setApiOptions(prev => ({ ...prev, ...d }))
      })
      .catch(() => {
        setConfigured(false)
        setConfigHint(
          '无法连接后端（请确认 Node 服务已启动：本地开发需 npm run server，端口 3001）。',
        )
      })
  }, [])

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const setImage = useCallback((file) => {
    if (!acceptImageFile(file)) return
    setImageFile(file)
    setAspectRatio('auto')
    setError('')
  }, [])

  const clearImage = () => {
    setImageFile(null)
    setAspectRatio(prev => (prev === 'auto' ? '1:1' : prev))
    if (fileRef.current) fileRef.current.value = ''
  }

  const onFileChange = (e) => {
    const f = e.target.files?.[0]
    if (f) setImage(f)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setImage(f)
  }

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const file = item.getAsFile()
    if (file) setImage(file)
  }

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入提示词')
      return
    }
    setLoading(true)
    setError('')
    setResultUrls([])
    setResultMeta(null)
    try {
      let res
      if (isEditMode) {
        const form = new FormData()
        form.append('image', imageFile)
        form.append('prompt', prompt.trim())
        form.append('resolution', resolution)
        form.append('aspectRatio', aspectRatio)
        form.append('quality', quality)
        form.append('n', String(count))
        form.append('output_format', 'png')
        res = await apiFetch('/api/image/edit', { method: 'POST', body: form })
      } else {
        res = await apiFetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt.trim(),
            n: count,
            resolution,
            aspectRatio,
            quality,
          }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(formatApiError(data, isEditMode ? '编辑失败' : '生成失败'))
      const urls = pickImageUrls(data)
      if (!urls.length) throw new Error('响应中无图片数据')
      setResultUrls(urls)
      setResultMeta(data.meta || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadUrl = (url, index) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-${Date.now()}-${index + 1}.png`
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }

  const aspectOptions = isEditMode
    ? apiOptions.aspectRatios
    : apiOptions.aspectRatios.filter(a => a !== 'auto')

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
          <Sparkles size={22} className="text-violet-600" aria-hidden />
          AI 生图
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {apiOptions.model} · 拖入图片为图生图，否则为文生图
        </p>
      </div>

      {configured === false && configHint && (
        <div className="ui-card p-4 flex items-start gap-3 border-amber-200 bg-amber-50" role="alert">
          <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18} />
          <p className="text-sm text-amber-900">{configHint}</p>
        </div>
      )}

      <div className="ui-card overflow-hidden">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative p-4 transition-colors ${dragOver ? 'bg-violet-50/80 ring-2 ring-violet-300 ring-inset' : ''}`}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onFileChange}
          />

          <div className="flex gap-3 min-h-[140px]">
            {previewUrl && (
              <div className="relative shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shadow-sm">
                <img src={previewUrl} alt="参考图" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                  aria-label="移除图片"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onPaste={onPaste}
              rows={5}
              placeholder="在这里输入提示词，回车换行。拖入或粘贴图片可进行图生图编辑。"
              className="ui-input flex-1 py-3 resize-none min-h-[120px] border-0 focus:ring-0 bg-transparent"
            />
          </div>

          {!previewUrl && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-xs text-slate-500 hover:text-violet-600 inline-flex items-center gap-1"
            >
              <ImagePlus size={14} />
              添加图片
            </button>
          )}
          {isEditMode && (
            <p className="mt-2 text-xs text-violet-600 font-medium">已附加参考图 · 图生图编辑</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/80">
          <MiniField label="模型">
            <select disabled className="ui-input py-1.5 text-sm w-full min-w-[140px] bg-slate-100 text-slate-600">
              <option>{apiOptions.model}</option>
            </select>
          </MiniField>

          <MiniField label="分辨率" hint={isEditMode ? '图生图输出清晰度' : '文生图长边像素'}>
            <select
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              className="ui-input py-1.5 text-sm min-w-[72px]"
            >
              {apiOptions.resolutions.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </MiniField>

          <MiniField label="宽高比">
            <select
              value={aspectRatio}
              onChange={e => setAspectRatio(e.target.value)}
              className="ui-input py-1.5 text-sm min-w-[88px]"
            >
              {aspectOptions.map(a => (
                <option key={a} value={a}>{ASPECT_LABELS[a] || a}</option>
              ))}
            </select>
          </MiniField>

          <MiniField label="数量" hint={count > 1 ? `将生成 ${count} 张` : undefined}>
            <select
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="ui-input py-1.5 text-sm min-w-[56px]"
            >
              {apiOptions.counts.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </MiniField>

          <MiniField label="清晰度">
            <select
              value={quality}
              onChange={e => setQuality(e.target.value)}
              className="ui-input py-1.5 text-sm min-w-[88px]"
            >
              {apiOptions.qualities.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </MiniField>

          <div className="flex-1 min-w-[120px]" />

          {error && (
            <p className="text-xs text-red-600 w-full sm:w-auto sm:max-w-md" role="alert">{error}</p>
          )}

          <button
            type="button"
            disabled={loading || configured === false}
            onClick={handleSubmit}
            className="ui-btn-primary inline-flex items-center gap-2 px-6 py-2.5 disabled:opacity-50 shrink-0"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? '生成中…' : '生成'}
          </button>
        </div>
      </div>

      {resultUrls.length > 0 && (
        <section className="ui-card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                生成结果 {resultUrls.length > 1 ? `(${resultUrls.length} 张)` : ''}
              </h3>
              {resultMeta?.size && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {resultMeta.size}
                  {resultMeta.quality ? ` · ${resultMeta.quality}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className={`grid gap-4 ${resultUrls.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            {resultUrls.map((url, i) => (
              <div key={i} className="relative group rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                <img src={url} alt={`结果 ${i + 1}`} className="w-full h-auto" />
                <button
                  type="button"
                  onClick={() => downloadUrl(url, i)}
                  className="absolute top-2 right-2 ui-btn-secondary text-xs opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                >
                  <Download size={14} aria-hidden />
                  下载
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
