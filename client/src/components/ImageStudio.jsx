import { useState, useEffect, useRef } from 'react'
import { Sparkles, ImagePlus, Upload, Loader2, Download, AlertCircle } from 'lucide-react'

function getToken() {
  return localStorage.getItem('auth_token') || ''
}

function apiFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), 'x-auth-token': getToken() },
  })
}

function pickImageUrl(data) {
  const item = data?.data?.[0]
  if (!item) return null
  if (item.url) return item.url
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  return null
}

function formatApiError(data, fallback) {
  if (!data) return fallback
  if (typeof data.error === 'string') return data.error
  if (data.error?.message) return data.error.message
  if (data.message) return data.message
  return fallback
}

const SIZES = ['1024x1024', '1024x1536', '1536x1024']

export default function ImageStudio() {
  const [mode, setMode] = useState('generate')
  const [configured, setConfigured] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [quality, setQuality] = useState('high')
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [resultUrl, setResultUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    apiFetch('/api/image/config')
      .then(r => r.json())
      .then(d => setConfigured(!!d.configured))
      .catch(() => setConfigured(false))
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

  const onFileChange = (e) => {
    const f = e.target.files?.[0]
    setImageFile(f || null)
    setError('')
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('请输入提示词')
      return
    }
    setLoading(true)
    setError('')
    setResultUrl(null)
    try {
      const res = await apiFetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), n: 1, size }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(formatApiError(data, '生成失败'))
      const url = pickImageUrl(data)
      if (!url) throw new Error('响应中无图片数据')
      setResultUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = async () => {
    if (!prompt.trim()) {
      setError('请输入编辑提示词')
      return
    }
    if (!imageFile) {
      setError('请上传参考图')
      return
    }
    setLoading(true)
    setError('')
    setResultUrl(null)
    try {
      const form = new FormData()
      form.append('image', imageFile)
      form.append('prompt', prompt.trim())
      form.append('size', 'auto')
      form.append('quality', quality)
      form.append('output_format', 'png')

      const res = await apiFetch('/api/image/edit', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(formatApiError(data, '编辑失败'))
      const url = pickImageUrl(data)
      if (!url) throw new Error('响应中无图片数据')
      setResultUrl(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadResult = () => {
    if (!resultUrl) return
    const a = document.createElement('a')
    a.href = resultUrl
    a.download = `gpt-image-${Date.now()}.png`
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-800 tracking-tight flex items-center gap-2">
          <Sparkles size={22} className="text-violet-600" aria-hidden />
          AI 生图
        </h2>
        <p className="text-sm text-slate-500 mt-1">GPT Image 2 · 文生图 / 图生图</p>
      </div>

      {configured === false && (
        <div className="ui-card p-4 flex items-start gap-3 border-amber-200 bg-amber-50" role="alert">
          <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18} />
          <p className="text-sm text-amber-900">
            服务端未配置 <code className="text-xs bg-amber-100 px-1 rounded">XOMODEL_API_KEY</code>，请在服务器 .env 中填写后重启。
          </p>
        </div>
      )}

      <div className="ui-card p-4">
        <div className="ui-nav-bar mb-4" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'generate'}
            onClick={() => { setMode('generate'); setError('') }}
            className={`ui-tab ${mode === 'generate' ? 'ui-tab-active' : 'ui-tab-inactive'}`}
          >
            <ImagePlus size={15} aria-hidden />
            文生图
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            onClick={() => { setMode('edit'); setError('') }}
            className={`ui-tab ${mode === 'edit' ? 'ui-tab-active' : 'ui-tab-inactive'}`}
          >
            <Upload size={15} aria-hidden />
            图生图
          </button>
        </div>

        <div className="space-y-4">
          {mode === 'edit' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">参考图片</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onFileChange}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="ui-btn-secondary"
                >
                  <Upload size={14} aria-hidden />
                  选择图片
                </button>
                {imageFile && (
                  <span className="text-xs text-slate-500 truncate max-w-[200px]">{imageFile.name}</span>
                )}
              </div>
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="参考图预览"
                  className="mt-3 max-h-48 rounded-lg border border-slate-200 object-contain"
                />
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-2">
              {mode === 'generate' ? '提示词' : '编辑说明'}
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
              placeholder={mode === 'generate'
                ? '描述你想生成的画面，例如：清晨机场上的无人机巡检场景，写实风格'
                : '描述要如何修改图片，例如：保留构图，只让天空更晴朗'}
              className="ui-input w-full py-2 resize-y min-h-[96px]"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            {mode === 'generate' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">尺寸</label>
                <select value={size} onChange={e => setSize(e.target.value)} className="ui-input py-2">
                  {SIZES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}
            {mode === 'edit' && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">质量</label>
                <select value={quality} onChange={e => setQuality(e.target.value)} className="ui-input py-2">
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={loading || configured === false}
            onClick={mode === 'generate' ? handleGenerate : handleEdit}
            className="ui-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? '生成中…' : mode === 'generate' ? '生成图片' : '编辑图片'}
          </button>
        </div>
      </div>

      {resultUrl && (
        <section className="ui-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">生成结果</h3>
            <button type="button" onClick={downloadResult} className="ui-btn-secondary text-xs">
              <Download size={14} aria-hidden />
              下载
            </button>
          </div>
          <img
            src={resultUrl}
            alt="生成结果"
            className="w-full max-w-2xl mx-auto rounded-lg border border-slate-200"
          />
        </section>
      )}
    </div>
  )
}
