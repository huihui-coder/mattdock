import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Search,
  Unplug,
} from 'lucide-react'
import { SCOPE_UNMAPPED, isScopeAll, isScopeUnmapped, getScopeRootRegionId } from '../lib/scope-query'
import { collectAllIds, filterTree } from '../lib/region-tree'

function ScopeFolderItem({
  node,
  depth,
  selectedId,
  rootId,
  expandedIds,
  onToggleExpand,
  onSelect,
}) {
  const hasChildren = node.children?.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = !isScopeUnmapped(selectedId) && (
    node.id === selectedId || (node.id === rootId && isScopeAll(selectedId))
  )

  return (
    <div>
      <div
        className={`flex w-full items-center gap-0.5 rounded-lg text-sm transition-colors duration-200 ${
          isSelected ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20' : 'text-dji-ink hover:bg-slate-50'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(node.id)}
            className={`flex h-8 w-7 shrink-0 items-center justify-center rounded-md cursor-pointer transition-colors ${
              isSelected ? 'hover:bg-blue-500/80' : 'hover:bg-slate-200/80'
            }`}
            aria-label={isExpanded ? '收起' : '展开'}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left cursor-pointer"
        >
          {isExpanded && hasChildren ? (
            <FolderOpen size={15} className={`shrink-0 ${isSelected ? 'text-blue-100' : 'text-blue-500'}`} aria-hidden />
          ) : (
            <Folder size={15} className={`shrink-0 ${isSelected ? 'text-blue-100' : 'text-slate-400'}`} aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{node.name || node.id}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <ScopeFolderItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              rootId={rootId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function RegionScopeSidebar({
  tree,
  value,
  onChange,
  showUnmappedTab = false,
  className = '',
}) {
  const [treeSearch, setTreeSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  useEffect(() => {
    setExpandedIds(new Set(collectAllIds(tree)))
  }, [tree])

  const filteredTree = useMemo(() => filterTree(tree, treeSearch), [tree, treeSearch])

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const rootId = tree[0]?.id || getScopeRootRegionId()

  if (!tree?.length) return null

  return (
    <aside
      className={`w-full lg:w-[240px] shrink-0 border border-dji-border bg-slate-50/40 rounded-xl p-3 overflow-y-auto max-h-[280px] lg:max-h-[calc(100vh-12rem)] lg:sticky lg:top-5 ${className}`}
      aria-label="组织范围"
    >
      <div className="relative mb-2">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dji-subtle pointer-events-none" aria-hidden />
        <input
          type="search"
          value={treeSearch}
          onChange={(e) => setTreeSearch(e.target.value)}
          placeholder="搜索组织"
          className="ui-input w-full !py-1.5 !pl-8 !text-xs"
        />
      </div>
      <p className="px-1 py-1 text-[11px] font-medium text-dji-subtle">组织目录</p>

      <div role="tree" aria-label="组织目录">
        {filteredTree.length ? (
          filteredTree.map((node) => (
            <ScopeFolderItem
              key={node.id}
              node={node}
              depth={0}
              selectedId={value}
              rootId={rootId}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
              onSelect={onChange}
            />
          ))
        ) : (
          <p className="text-xs text-dji-subtle px-1 py-4 text-center">无匹配组织</p>
        )}
      </div>

      {showUnmappedTab && (
        <div className="mt-3 pt-3 border-t border-dji-border/80 space-y-1">
          <button
            type="button"
            onClick={() => onChange(SCOPE_UNMAPPED)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors duration-200 ${
              isScopeUnmapped(value)
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/25'
                : 'text-amber-900/90 hover:bg-amber-50'
            }`}
          >
            <Unplug size={15} className="shrink-0" aria-hidden />
            <span className="font-medium">无归属</span>
          </button>
        </div>
      )}
    </aside>
  )
}
