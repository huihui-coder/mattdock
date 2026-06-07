import { useMemo } from 'react'
import { SCOPE_UNMAPPED, isScopeAll, isScopeUnmapped, getScopeRootRegionId } from '../lib/scope-query'
import { Unplug } from 'lucide-react'

function flattenTreeTabs(nodes, depth = 0, out = []) {
  for (const node of nodes || []) {
    out.push({ id: node.id, name: node.name || node.id, depth })
    if (node.children?.length) flattenTreeTabs(node.children, depth + 1, out)
  }
  return out
}

export default function RegionScopeTabs({
  regions,
  tree,
  value,
  onChange,
  showUnmappedTab = false,
  className = '',
}) {
  const rootId = tree?.[0]?.id || getScopeRootRegionId()
  const tabRegions = useMemo(() => {
    if (tree?.length) return flattenTreeTabs(tree)
    return (regions || []).map((r) => ({ id: r.id, name: r.name || r.id, depth: 0 }))
  }, [tree, regions])

  if (tabRegions.length <= 1 && !showUnmappedTab) return null

  const isTabActive = (regionId) => {
    if (isScopeUnmapped(value)) return false
    if (value === regionId) return true
    return regionId === rootId && isScopeAll(value)
  }

  return (
    <div className={`ui-card px-3 py-2.5 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-dji-muted shrink-0">组织范围</p>
        <div className="ui-nav-bar w-full sm:w-auto overflow-x-auto" role="tablist" aria-label="组织范围">
          {tabRegions.map((region) => (
            <button
              key={region.id}
              type="button"
              role="tab"
              aria-selected={isTabActive(region.id)}
              onClick={() => onChange(region.id)}
              className={`ui-tab whitespace-nowrap cursor-pointer ${isTabActive(region.id) ? 'ui-tab-active' : 'ui-tab-inactive'}`}
            >
              {region.depth > 0 && (
                <span className="text-slate-400 mr-0.5" aria-hidden>
                  {'└'.repeat(Math.min(region.depth, 1))}
                </span>
              )}
              {region.name}
            </button>
          ))}
          {showUnmappedTab && (
            <button
              type="button"
              role="tab"
              aria-selected={isScopeUnmapped(value)}
              onClick={() => onChange(SCOPE_UNMAPPED)}
              className={`ui-tab whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 ${
                isScopeUnmapped(value)
                  ? 'ui-tab-active !bg-amber-600 !shadow-amber-600/25'
                  : 'ui-tab-inactive text-amber-800/90 hover:bg-amber-50'
              }`}
            >
              <Unplug size={13} aria-hidden />
              无归属
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
