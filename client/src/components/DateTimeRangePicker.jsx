import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarRange, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowRight,
} from 'lucide-react'

const pad = (n) => String(n).padStart(2, '0')

export const toDatetimeLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

export const formatDatetimeDisplay = (dtLocal) => {
  if (!dtLocal) return '--'
  const d = new Date(dtLocal)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const PRESETS = [
  {
    id: 'today',
    label: '今天',
    getRange: () => {
      const now = new Date()
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return [toDatetimeLocal(start), toDatetimeLocal(now)]
    },
  },
  {
    id: 'yesterday',
    label: '昨天',
    getRange: () => {
      const now = new Date()
      const start = new Date(now)
      start.setDate(start.getDate() - 1)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setHours(23, 59, 0, 0)
      return [toDatetimeLocal(start), toDatetimeLocal(end)]
    },
  },
  {
    id: 'week',
    label: '近一周',
    getRange: () => {
      const now = new Date()
      const start = new Date(now.getTime() - 6 * 86400000)
      start.setHours(0, 0, 0, 0)
      return [toDatetimeLocal(start), toDatetimeLocal(now)]
    },
  },
  {
    id: 'month',
    label: '近一月',
    getRange: () => {
      const now = new Date()
      const start = new Date(now.getTime() - 29 * 86400000)
      start.setHours(0, 0, 0, 0)
      return [toDatetimeLocal(start), toDatetimeLocal(now)]
    },
  },
]

function splitDatetime(dtLocal) {
  if (!dtLocal) return { date: '', time: '00:00' }
  const [date, time = '00:00'] = dtLocal.split('T')
  return { date, time: time.slice(0, 5) }
}

function joinDatetime(date, time) {
  if (!date) return ''
  return `${date}T${time || '00:00'}`
}

function parseDateKey(dateKey) {
  if (!dateKey) return null
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toDateKey(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function normalizeMonth(year, month) {
  const d = new Date(year, month, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function buildMonthCells(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay()
  const totalDays = daysInMonth(year, month)
  const prev = normalizeMonth(year, month - 1)
  const prevTotal = daysInMonth(prev.year, prev.month)
  const cells = []

  for (let i = firstWeekday - 1; i >= 0; i -= 1) {
    cells.push({
      year: prev.year,
      month: prev.month,
      day: prevTotal - i,
      outside: true,
    })
  }
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push({ year, month, day, outside: false })
  }
  const next = normalizeMonth(year, month + 1)
  let nextDay = 1
  while (cells.length < 42) {
    cells.push({ year: next.year, month: next.month, day: nextDay, outside: true })
    nextDay += 1
  }
  return cells
}

function clampEndToMax(end, max) {
  if (!end || !max) return end
  return new Date(end).getTime() > new Date(max).getTime() ? max : end
}

function compareDateOnly(a, b) {
  if (!a || !b) return 0
  return parseDateKey(a).getTime() - parseDateKey(b).getTime()
}

function MonthPanel({ year, month, rangeStart, rangeEnd, maxDateKey, onPick, onPrev, onNext, onPrevYear, onNextYear, showNav = 'both' }) {
  const cells = useMemo(() => buildMonthCells(year, month), [year, month])
  const title = `${year}年 ${month + 1}月`

  const isInRange = (key) => {
    if (!rangeStart || !rangeEnd) return false
    const t = parseDateKey(key)?.getTime()
    const s = parseDateKey(rangeStart)?.getTime()
    const e = parseDateKey(rangeEnd)?.getTime()
    if (t == null || s == null || e == null) return false
    const lo = Math.min(s, e)
    const hi = Math.max(s, e)
    return t >= lo && t <= hi
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-0.5">
          {showNav !== 'right' && (
            <>
              <button type="button" onClick={onPrevYear} className="dtp-nav-btn" aria-label="上一年">
                <ChevronsLeft size={14} />
              </button>
              <button type="button" onClick={onPrev} className="dtp-nav-btn" aria-label="上一月">
                <ChevronLeft size={14} />
              </button>
            </>
          )}
        </div>
        <span className="text-sm font-medium text-slate-800 tabular-nums">{title}</span>
        <div className="flex items-center gap-0.5">
          {showNav !== 'left' && (
            <>
              <button type="button" onClick={onNext} className="dtp-nav-btn" aria-label="下一月">
                <ChevronRight size={14} />
              </button>
              <button type="button" onClick={onNextYear} className="dtp-nav-btn" aria-label="下一年">
                <ChevronsRight size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[11px] text-slate-500 py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const key = toDateKey(cell.year, cell.month, cell.day)
          const selected = key === rangeStart || key === rangeEnd
          const inRange = isInRange(key)
          const disabled = maxDateKey && compareDateOnly(key, maxDateKey) > 0
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onPick(key)}
              className={[
                'dtp-day',
                cell.outside && 'dtp-day-outside',
                inRange && 'dtp-day-in-range',
                selected && 'dtp-day-selected',
                disabled && 'dtp-day-disabled',
              ].filter(Boolean).join(' ')}
            >
              {cell.day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function DateTimeRangePicker({
  value = ['', ''],
  onChange,
  max,
  className = '',
  placeholder = '选择时间范围',
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [viewMonth, setViewMonth] = useState(() => {
    const src = value[0] || value[1] || toDatetimeLocal(new Date())
    const d = new Date(src)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const maxDt = max || toDatetimeLocal(new Date())
  const maxDateKey = maxDt.split('T')[0]

  useEffect(() => {
    if (!open) {
      setDraft(value)
      return
    }
    setDraft(value)
    const src = value[0] || value[1] || maxDt
    const d = new Date(src)
    if (!Number.isNaN(d.getTime())) {
      setViewMonth({ year: d.getFullYear(), month: d.getMonth() })
    }
  }, [open, value, maxDt])

  const updatePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const panelW = Math.min(720, window.innerWidth - 16)
    let left = rect.left
    if (left + panelW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - panelW - 8)
    }
    const top = rect.bottom + 6
    setPos({ top, left, width: panelW })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    updatePosition()
    const onResize = () => updatePosition()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const startParts = splitDatetime(draft[0])
  const endParts = splitDatetime(draft[1])
  const rangeStartKey = startParts.date
  const rangeEndKey = endParts.date

  const rightMonth = normalizeMonth(viewMonth.year, viewMonth.month + 1)

  const setDraftPart = (anchor, part, val) => {
    setDraft((prev) => {
      const parts = splitDatetime(prev[anchor === 'start' ? 0 : 1])
      const next = joinDatetime(
        part === 'date' ? val : parts.date,
        part === 'time' ? val : parts.time,
      )
      const idx = anchor === 'start' ? 0 : 1
      const out = [...prev]
      out[idx] = idx === 1 ? clampEndToMax(next, maxDt) : next
      if (out[0] && out[1] && new Date(out[0]).getTime() > new Date(out[1]).getTime()) {
        if (anchor === 'start') out[1] = out[0]
        else out[0] = out[1]
      }
      return out
    })
  }

  const handleDayPick = (dateKey) => {
    if (maxDateKey && compareDateOnly(dateKey, maxDateKey) > 0) return

    setDraft((prev) => {
      const out = [...prev]
      const sp = splitDatetime(out[0])
      const ep = splitDatetime(out[1])
      const startDate = sp.date
      const startTime = sp.time || '00:00'
      const endTime = ep.time || sp.time || '23:59'

      if (!startDate) {
        out[0] = joinDatetime(dateKey, startTime)
        out[1] = clampEndToMax(joinDatetime(dateKey, endTime), maxDt)
        return out
      }

      if (compareDateOnly(dateKey, startDate) >= 0) {
        let endVal = joinDatetime(dateKey, endTime)
        if (new Date(endVal).getTime() < new Date(out[0]).getTime()) {
          endVal = joinDatetime(dateKey, startTime)
        }
        out[1] = clampEndToMax(endVal, maxDt)
        return out
      }

      const prevStart = out[0]
      const prevEnd = out[1] || prevStart
      out[0] = joinDatetime(dateKey, startTime)
      out[1] = clampEndToMax(
        new Date(prevEnd).getTime() >= new Date(prevStart).getTime() ? prevEnd : prevStart,
        maxDt,
      )
      return out
    })

    const d = parseDateKey(dateKey)
    if (d) setViewMonth({ year: d.getFullYear(), month: d.getMonth() })
  }

  const applyPreset = (preset) => {
    const range = preset.getRange()
    setDraft(range)
    const d = new Date(range[0])
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() })
  }

  const handleConfirm = () => {
    const out = [
      draft[0] || '',
      clampEndToMax(draft[1] || '', maxDt) || '',
    ]
    onChange?.(out)
    setOpen(false)
  }

  const handleClear = () => {
    setDraft(['', ''])
  }

  const displayText = value[0] || value[1]
    ? `${formatDatetimeDisplay(value[0])} — ${formatDatetimeDisplay(value[1])}`
    : placeholder

  const shiftMonth = (delta) => {
    setViewMonth((m) => normalizeMonth(m.year, m.month + delta))
  }

  const shiftYear = (delta) => {
    setViewMonth((m) => ({ year: m.year + delta, month: m.month }))
  }

  const panel = open ? createPortal(
    <div
      ref={panelRef}
      className="dtp-panel fixed z-50 rounded-xl overflow-hidden"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      role="dialog"
      aria-label="选择时间范围"
    >
      <div className="flex flex-col sm:flex-row">
        {/* 快捷预设 */}
        <aside className="dtp-sidebar shrink-0 flex sm:flex-col gap-0.5 sm:gap-1 p-2 sm:py-4 sm:px-3 border-b sm:border-b-0 sm:border-r border-slate-200">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className="dtp-preset"
            >
              {p.label}
            </button>
          ))}
        </aside>

        <div className="flex-1 min-w-0 p-4">
          {/* 顶部汇总 */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 mb-3">
            <CalendarRange size={15} className="text-blue-600 shrink-0" />
            <span className="text-sm text-slate-700 truncate tabular-nums">
              {draft[0] || draft[1]
                ? `${formatDatetimeDisplay(draft[0])} — ${formatDatetimeDisplay(draft[1])}`
                : '开始时间 — 结束时间'}
            </span>
          </div>

          {/* 日期时间输入 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              type="date"
              value={startParts.date}
              max={endParts.date || maxDt.split('T')[0]}
              onChange={(e) => setDraftPart('start', 'date', e.target.value)}
              className="dtp-field"
              aria-label="开始日期"
            />
            <input
              type="time"
              step={60}
              value={startParts.time}
              onChange={(e) => setDraftPart('start', 'time', e.target.value)}
              className="dtp-field dtp-field-time"
              aria-label="开始时间"
            />
            <ArrowRight size={14} className="text-slate-400 shrink-0 hidden sm:block" />
            <input
              type="date"
              value={endParts.date}
              min={startParts.date || undefined}
              max={maxDt.split('T')[0]}
              onChange={(e) => setDraftPart('end', 'date', e.target.value)}
              className="dtp-field"
              aria-label="结束日期"
            />
            <input
              type="time"
              step={60}
              value={endParts.time}
              max={endParts.date === maxDt.split('T')[0] ? maxDt.split('T')[1] : undefined}
              onChange={(e) => setDraftPart('end', 'time', e.target.value)}
              className="dtp-field dtp-field-time"
              aria-label="结束时间"
            />
          </div>

          {/* 双月历 */}
          <div className="flex flex-col md:flex-row gap-4 md:gap-6 mb-4">
            <MonthPanel
              year={viewMonth.year}
              month={viewMonth.month}
              rangeStart={rangeStartKey}
              rangeEnd={rangeEndKey}
              maxDateKey={maxDateKey}
              onPick={handleDayPick}
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
              onPrevYear={() => shiftYear(-1)}
              onNextYear={() => shiftYear(1)}
              showNav="left"
            />
            <MonthPanel
              year={rightMonth.year}
              month={rightMonth.month}
              rangeStart={rangeStartKey}
              rangeEnd={rangeEndKey}
              maxDateKey={maxDateKey}
              onPick={handleDayPick}
              onPrev={() => shiftMonth(-1)}
              onNext={() => shiftMonth(1)}
              onPrevYear={() => shiftYear(-1)}
              onNextYear={() => shiftYear(1)}
              showNav="right"
            />
          </div>

          {/* 底部操作 */}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button type="button" onClick={handleClear} className="dtp-btn-ghost">
              清空
            </button>
            <button type="button" onClick={handleConfirm} className="dtp-btn-primary">
              确定
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 flex-1 min-w-[280px] max-w-xl border rounded-lg bg-white px-3 py-2 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 transition-colors ${open ? 'border-blue-400 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-blue-300'} ${className}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <CalendarRange size={15} className="text-slate-400 shrink-0" />
        <span className={`text-sm truncate tabular-nums flex-1 min-w-0 ${value[0] || value[1] ? 'text-slate-700' : 'text-slate-400'}`}>
          {displayText}
        </span>
      </button>
      {panel}
    </>
  )
}
