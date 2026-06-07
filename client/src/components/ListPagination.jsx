import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100]

function buildPageItems(current, totalPages) {
  if (totalPages <= 1) return totalPages ? [1] : []
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items = [1]
  if (current > 4) items.push('...')
  const start = Math.max(2, current - 2)
  const end = Math.min(totalPages - 1, current + 1)
  for (let p = start; p <= end; p += 1) items.push(p)
  if (current < totalPages - 3) items.push('...')
  items.push(totalPages)
  return items
}

export default function ListPagination({
  total = 0,
  page = 1,
  pageSize = 20,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  className = '',
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const [jumpInput, setJumpInput] = useState(String(safePage))

  useEffect(() => {
    setJumpInput(String(safePage))
  }, [safePage])

  if (total <= 0) return null

  const pageItems = buildPageItems(safePage, totalPages)

  const goPage = (next) => {
    const p = Math.min(Math.max(next, 1), totalPages)
    if (p !== safePage) onPageChange?.(p)
  }

  const submitJump = (e) => {
    e.preventDefault()
    const n = parseInt(jumpInput, 10)
    if (!Number.isNaN(n)) goPage(n)
  }

  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-dji-border/60 ${className}`}>
      <p className="text-xs text-dji-muted tabular-nums shrink-0">共 {total} 条</p>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {onPageSizeChange && (
          <div className="relative">
            <select
              value={pageSize}
              disabled={disabled}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="ui-input !w-auto !py-1.5 !pr-8 !text-xs cursor-pointer appearance-none min-w-[96px]"
              aria-label="每页条数"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size} 条/页</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-dji-subtle pointer-events-none" aria-hidden />
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={disabled || safePage <= 1}
            onClick={() => goPage(safePage - 1)}
            className="min-w-[2rem] h-8 px-2 rounded-lg border border-dji-border text-dji-ink hover:bg-dji-page disabled:opacity-40 cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20"
            aria-label="上一页"
          >
            <ChevronLeft size={16} className="mx-auto" />
          </button>

          {pageItems.map((item, i) => (
            item === '...' ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-dji-subtle select-none">…</span>
            ) : (
              <button
                key={item}
                type="button"
                disabled={disabled}
                onClick={() => goPage(item)}
                aria-current={safePage === item ? 'page' : undefined}
                className={`min-w-[2rem] h-8 px-2 rounded-lg border text-xs tabular-nums transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20 ${
                  safePage === item
                    ? 'border-blue-600 bg-blue-600 text-white font-medium'
                    : 'border-dji-border text-dji-ink hover:bg-dji-page cursor-pointer'
                }`}
              >
                {item}
              </button>
            )
          ))}

          <button
            type="button"
            disabled={disabled || safePage >= totalPages}
            onClick={() => goPage(safePage + 1)}
            className="min-w-[2rem] h-8 px-2 rounded-lg border border-dji-border text-dji-ink hover:bg-dji-page disabled:opacity-40 cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dji-black/20"
            aria-label="下一页"
          >
            <ChevronRight size={16} className="mx-auto" />
          </button>
        </div>

        <form onSubmit={submitJump} className="flex items-center gap-1.5 text-xs text-dji-muted">
          <span className="shrink-0">前往</span>
          <input
            type="text"
            inputMode="numeric"
            value={jumpInput}
            disabled={disabled}
            onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ''))}
            className="ui-input !w-12 !py-1 !px-2 !text-xs text-center tabular-nums"
            aria-label="页码"
          />
          <span className="shrink-0">页</span>
        </form>
      </div>
    </div>
  )
}

export function paginateSlice(items, page, pageSize) {
  const start = (Math.max(page, 1) - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function PaginatedList({ items, children, defaultPageSize = 20, resetKey = '' }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  useEffect(() => {
    setPage(1)
  }, [items.length, pageSize, resetKey])

  const slice = paginateSlice(items, page, pageSize)

  return (
    <>
      {children(slice)}
      <ListPagination
        total={items.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
      />
    </>
  )
}
