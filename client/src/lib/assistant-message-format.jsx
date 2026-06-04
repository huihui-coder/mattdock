const REASON_OPEN = '<' + 'redacted_reasoning' + '>'
const REASON_CLOSE = '<' + '/redacted_reasoning' + '>'
const REASON_BLOCK = new RegExp(
  REASON_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '[\\s\\S]*?' +
    REASON_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  'gi',
)
const REASON_TAIL = new RegExp(
  REASON_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*$',
  'i',
)

/** 去掉模型思考标签与多余空白 */
export function stripAssistantNoise(text) {
  return String(text || '')
    .replace(REASON_BLOCK, '')
    .replace(REASON_TAIL, '')
    .replace(new RegExp(REASON_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<think[^>]*>[\s\S]*/gi, '')
    .replace(/<\/think>/gi, '')
    .trim()
}

function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-i${i}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={key} className="assistant-inline-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function renderList(lines, ordered, key) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag key={key} className="assistant-list">
      {lines.map((line, i) => {
        const m = line.match(ordered ? /^\d+\.\s+(.*)$/ : /^[-*]\s+(.*)$/)
        const body = m ? m[1] : line
        return (
          <li key={`${key}-${i}`} className="assistant-list-item">
            {renderInline(body, `${key}-li-${i}`)}
          </li>
        )
      })}
    </Tag>
  )
}

function renderBlock(block, index) {
  const trimmed = block.trim()
  if (!trimmed) return null

  const h3 = trimmed.match(/^###\s+(.+)$/)
  if (h3) {
    return (
      <h4 key={index} className="assistant-h">
        {renderInline(h3[1], `h3-${index}`)}
      </h4>
    )
  }
  const h2 = trimmed.match(/^##\s+(.+)$/)
  if (h2) {
    return (
      <h4 key={index} className="assistant-h">
        {renderInline(h2[1], `h2-${index}`)}
      </h4>
    )
  }

  const lines = trimmed.split('\n')
  const allBullet = lines.every((l) => /^[-*]\s+/.test(l.trim()))
  const allOrdered = lines.every((l) => /^\d+\.\s+/.test(l.trim()))
  if (lines.length > 1 && allBullet) return renderList(lines, false, `ul-${index}`)
  if (lines.length > 1 && allOrdered) return renderList(lines, true, `ol-${index}`)

  return (
    <p key={index} className="assistant-p">
      {lines.map((line, li) => (
        <span key={`${index}-${li}`}>
          {li > 0 && <br />}
          {renderInline(line, `p-${index}-${li}`)}
        </span>
      ))}
    </p>
  )
}

/** 助手回复 Markdown → 易读富文本 */
export function AssistantRichText({ content, className = '' }) {
  const cleaned = stripAssistantNoise(content)
  if (!cleaned) return null

  const blocks = cleaned.split(/\n{2,}/)
  return (
    <div className={`floating-assistant__rich ${className}`.trim()}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  )
}
