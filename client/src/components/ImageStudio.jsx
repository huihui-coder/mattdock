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

function acceptImageFile(file) {
  return file && file.type.startsWith('image/')
}

export default function ImageStudio() {
  const [configured, setConfigured] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [quality, setQuality] = useState('high')
  const [imageFile, setImageFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [resultUrl, setResultUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const dropRef = useRef(null)

  const isEditMode = !!imageFile

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

  const setImage = useCallback((file) => {
    if (!acceptImageFile(file)) return
    setImageFile(file)
    setError('')
  }, [])

  const clearImage = () => {
    setImageFile(null)
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
    setResultUrl(null)
    try {
      let res
      if (isEditMode) {
        const form = new FormData()
        form.append('image', imageFile)
        form.append('prompt', prompt.trim())
        form.append('size', 'auto')
        form.append('quality', quality)
        form.append('output_format', 'png')
        res = await apiFetch('/api/image/edit', { method: 'POST', body: form })
      } else {
        res = await apiFetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim(), n: 1, size }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(formatApiError(data, isEditMode ? '编辑失败' : '生成失败'))
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
        <p className="text-sm text-slate-500 mt-1">
          GPT Image 2 · 输入提示词生成；拖入或粘贴图片则自动图生图编辑
        </p>
      </div>

      {configured === false && (
        <div className="ui-card p-4 flex items-start gap-3 border-amber-200 bg-amber-50" role="alert">
          <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18} />
          <p className="text-sm text-amber-900">
            服务端未配置 <code className="text-xs bg-amber-100 px-1 rounded">XOMODEL_API_KEY</code>，请在 .env 中填写后重启。
          </p>
        </div>
      )}

      <div className="ui-card overflow-hidden">
        <div
          ref={dropRef}
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
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
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
              placeholder={isEditMode
                ? '描述要如何修改图片，例如：保留构图，只让天空更晴朗'
                : '在这里输入提示词；也可拖入、粘贴或点击添加图片进行图生图'}
              className="ui-input flex-1 py-3 resize-none min-h-[120px] border-0 focus:ring-0 bg-transparent"
            />
          </div>

          {!previewUrl && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-xs text-slate-500 hover:text-violet-600 inline-flex items-center gap-1 transition-colors"
            >
              <ImagePlus size={14} />
              添加图片
            </button>
          )}

          {isEditMode && (
            <p className="mt-2 text-xs text-violet-600 font-medium">已附加参考图 · 将使用图生图编辑</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/80">
          {isEditMode ? (
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">质量</label>
              <select value={quality} onChange={e => setQuality(e.target.value)} className="ui-input py-1.5 text-sm min-w-[100px]">
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">尺寸</label>
              <select value={size} onChange={e => setSize(e.target.value)} className="ui-input py-1.5 text-sm min-w-[130px]">
                {SIZES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1" />

          {error && (
            <p className="text-xs text-red-600 w-full order-first sm:order-none sm:w-auto sm:flex-1" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={loading || configured === false}
            onClick={handleSubmit}
            className="ui-btn-primary inline-flex items-center gap-2 px-6 disabled:opacity-50 shrink-0"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? '生成中…' : '生成'}
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
