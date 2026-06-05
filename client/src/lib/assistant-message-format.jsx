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

/** 按行解析：支持标题与列表紧邻（单换行） */
function parseLines(cleaned) {
  const lines = cleaned.split('\n')
  const nodes = []
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      i += 1
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      nodes.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      nodes.push({ type: 'ul', items })
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i += 1
      }
      nodes.push({ type: 'ol', items })
      continue
    }

    const paraLines = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (!t) break
      if (/^#{1,3}\s+/.test(t)) break
      if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) break
      paraLines.push(lines[i])
      i += 1
    }
    if (paraLines.length) nodes.push({ type: 'p', lines: paraLines })
  }

  return nodes
}

function headingClass(level) {
  if (level <= 1) return 'assistant-h1'
  if (level === 2) return 'assistant-h1'
  return 'assistant-h2'
}

function renderNode(node, index) {
  if (node.type === 'heading') {
    const cls = headingClass(node.level)
    return (
      <div key={index} className={cls} role="heading" aria-level={node.level <= 2 ? 2 : 3}>
        {renderInline(node.text, `h-${index}`)}
      </div>
    )
  }

  if (node.type === 'ul') {
    return (
      <ul key={index} className="assistant-list">
        {node.items.map((item, i) => (
          <li key={`${index}-${i}`} className="assistant-list-item">
            {renderInline(item, `ul-${index}-${i}`)}
          </li>
        ))}
      </ul>
    )
  }

  if (node.type === 'ol') {
    return (
      <ol key={index} className="assistant-list">
        {node.items.map((item, i) => (
          <li key={`${index}-${i}`} className="assistant-list-item">
            {renderInline(item, `ol-${index}-${i}`)}
          </li>
        ))}
      </ol>
    )
  }

  return (
    <p key={index} className="assistant-p">
      {node.lines.map((line, li) => (
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

  const nodes = parseLines(cleaned)
  return (
    <div className={`floating-assistant__rich ${className}`.trim()}>
      {nodes.map((node, i) => renderNode(node, i))}
    </div>
  )
}
