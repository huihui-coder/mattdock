import { SCOPE_ALL, isScopeAll } from '../lib/scope-query'

export default function RegionScopeTabs({ regions, value, onChange, className = '' }) {
  if (!regions?.length || regions.length <= 1) return null

  return (
    <div className={`ui-card px-3 py-2.5 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-dji-muted shrink-0">组织范围</p>
        <div className="ui-nav-bar w-full sm:w-auto overflow-x-auto" role="tablist" aria-label="组织范围">
          {regions.map((region) => (
            <button
              key={region.id}
              type="button"
              role="tab"
              aria-selected={value === region.id}
              onClick={() => onChange(region.id)}
              className={`ui-tab whitespace-nowrap ${value === region.id ? 'ui-tab-active' : 'ui-tab-inactive'}`}
            >
              {region.name || region.id}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={isScopeAll(value)}
            onClick={() => onChange(SCOPE_ALL)}
            className={`ui-tab whitespace-nowrap ${isScopeAll(value) ? 'ui-tab-active' : 'ui-tab-inactive'}`}
          >
            全部
          </button>
        </div>
      </div>
    </div>
  )
}
