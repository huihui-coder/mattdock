import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Sparkles } from 'lucide-react'

function formatNumber(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN')
}

function ModelSpecGrid({ model }) {
  const limits = model.limits || {}
  const rate = model.rateLimits || {}
  return (
    <dl className="assistant-model-picker__spec-grid">
      <div className="assistant-model-picker__spec-item">
        <dt>上下文窗口</dt>
        <dd>{limits.contextWindow || '—'}</dd>
      </div>
      <div className="assistant-model-picker__spec-item">
        <dt>最大输入</dt>
        <dd>{limits.maxInput || '—'}</dd>
      </div>
      <div className="assistant-model-picker__spec-item">
        <dt>最大回答</dt>
        <dd>
          {limits.maxOutput || '—'}
          {limits.maxOutputDefault ? ` (默认 ${limits.maxOutputDefault})` : ''}
        </dd>
      </div>
      {limits.maxThinkingChain != null && (
        <div className="assistant-model-picker__spec-item">
          <dt>最大思维链</dt>
          <dd>{limits.maxThinkingChain || '—'}</dd>
        </div>
      )}
      <div className="assistant-model-picker__spec-item">
        <dt>最大 RPM</dt>
        <dd>{formatNumber(rate.maxRpm)}</dd>
      </div>
      <div className="assistant-model-picker__spec-item">
        <dt>最大 TPM</dt>
        <dd>{formatNumber(rate.maxTpm)}</dd>
      </div>
    </dl>
  )
}

function ModelOptionCard({ model, active, disabled, onSelect }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(model.id)}
      className={`assistant-model-picker__option ${active ? 'is-active' : ''}`}
      aria-pressed={active}
    >
      <div className="assistant-model-picker__option-head">
        <div className="min-w-0">
          <div className="assistant-model-picker__option-title">
            {model.name}
            {model.recommended && <span className="assistant-model-picker__badge">推荐</span>}
            {model.versionTag && (
              <span className="assistant-model-picker__badge assistant-model-picker__badge--muted">
                {model.versionTag}
              </span>
            )}
          </div>
          <code className="assistant-model-picker__option-id">{model.id}</code>
        </div>
        {active && (
          <span className="assistant-model-picker__active-mark" aria-hidden>
            <Check size={14} />
          </span>
        )}
      </div>

      {model.description && (
        <p className="assistant-model-picker__option-desc">{model.description}</p>
      )}

      {!!model.capabilities?.length && (
        <div className="assistant-model-picker__caps">
          <span className="assistant-model-picker__caps-label">能力支持</span>
          <div className="assistant-model-picker__cap-list">
            {model.capabilities.map((cap) => (
              <span key={cap} className="assistant-model-picker__cap">{cap}</span>
            ))}
          </div>
        </div>
      )}

      <div className="assistant-model-picker__limits-block">
        <span className="assistant-model-picker__caps-label">长度限制（token）</span>
        <ModelSpecGrid model={model} />
      </div>

      {model.rateLimitNote && (
        <p className="assistant-model-picker__rate-note">{model.rateLimitNote}</p>
      )}
    </button>
  )
}

export default function AssistantModelPicker({
  models = [],
  value,
  loading = false,
  saving = false,
  onChange,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const listId = useId()
  const selected = models.find((m) => m.id === value) || null

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSelect = (modelId) => {
    if (saving || modelId === value) {
      setOpen(false)
      return
    }
    onChange?.(modelId)
    setOpen(false)
  }

  if (loading) {
    return (
      <div className="assistant-model-picker assistant-model-picker--loading">
        <Loader2 size={16} className="animate-spin text-dji-subtle" />
        <span>加载模型列表…</span>
      </div>
    )
  }

  if (!models.length) {
    return (
      <div className="assistant-model-picker assistant-model-picker--empty">
        暂无可用模型
      </div>
    )
  }

  return (
    <div className="assistant-model-picker" ref={rootRef}>
      <button
        type="button"
        className={`assistant-model-picker__trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="assistant-model-picker__trigger-icon" aria-hidden>
          <Sparkles size={15} />
        </span>
        <span className="assistant-model-picker__trigger-body">
          <span className="assistant-model-picker__trigger-label">可选模型 ID (Model ID)</span>
          <span className="assistant-model-picker__trigger-value">
            {selected ? selected.name : '请选择模型'}
          </span>
          {selected && (
            <code className="assistant-model-picker__trigger-id">{selected.id}</code>
          )}
        </span>
        <span className="assistant-model-picker__trigger-tail">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open && (
        <div className="assistant-model-picker__panel" id={listId} role="listbox">
          <div className="assistant-model-picker__panel-head">
            <div>
              <div className="assistant-model-picker__panel-title">火山方舟模型</div>
              <p className="assistant-model-picker__panel-sub">
                切换后全站飞行助手与告警 AI 分析立即生效
              </p>
            </div>
            <span className="assistant-model-picker__panel-count">{models.length} 个可选</span>
          </div>
          <div className="assistant-model-picker__list">
            {models.map((model) => (
              <ModelOptionCard
                key={model.id}
                model={model}
                active={model.id === value}
                disabled={saving}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>
      )}

      {selected && !open && (
        <div className="assistant-model-picker__summary">
          {!!selected.capabilities?.length && (
            <div className="assistant-model-picker__caps assistant-model-picker__caps--compact">
              <span className="assistant-model-picker__caps-label">能力支持</span>
              <div className="assistant-model-picker__cap-list">
                {selected.capabilities.map((cap) => (
                  <span key={cap} className="assistant-model-picker__cap">{cap}</span>
                ))}
              </div>
            </div>
          )}
          <div className="assistant-model-picker__limits-block">
            <span className="assistant-model-picker__caps-label">长度限制（token）· 限流</span>
            <ModelSpecGrid model={selected} />
          </div>
          {selected.rateLimitNote && (
            <p className="assistant-model-picker__rate-note">{selected.rateLimitNote}</p>
          )}
        </div>
      )}
    </div>
  )
}
