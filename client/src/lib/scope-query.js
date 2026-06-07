/** 组织 Tab「全部」：不传 scopeRegionId，加载所有可见叶子区域 */
export const SCOPE_ALL = '__all__'

export function isScopeAll(scopeRegionId) {
  return !scopeRegionId || scopeRegionId === SCOPE_ALL
}

export function withScopeQuery(url, scopeRegionId) {
  if (isScopeAll(scopeRegionId)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}scopeRegionId=${encodeURIComponent(scopeRegionId)}`
}

export function scopeStorageKey(username) {
  return `haizhu_scope_region_${username || ''}`
}

export function readStoredScopeRegion(username, leafRegions) {
  if (!leafRegions?.length) return ''
  if (!username) return leafRegions[0]?.id || ''
  try {
    const stored = sessionStorage.getItem(scopeStorageKey(username))
    if (stored === SCOPE_ALL) return SCOPE_ALL
    if (stored && leafRegions.some((r) => r.id === stored)) return stored
  } catch {}
  return leafRegions[0]?.id || ''
}

export function writeStoredScopeRegion(username, regionId) {
  if (!username || !regionId) return
  try {
    sessionStorage.setItem(scopeStorageKey(username), regionId)
  } catch {}
}
