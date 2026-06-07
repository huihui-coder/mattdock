/** 兼容旧会话：等价于选中组织树根节点 */
export const SCOPE_ALL = '__all__'
/** 管理员 Tab「无归属」：仅未映射设备，按 MQTT 连接区分 */
export const SCOPE_UNMAPPED = '__unmapped__'

let scopeRootRegionId = ''

/** 由 App 在加载 regionTree 后注入，根组织即「全部」 */
export function setScopeRootRegionId(regionId) {
  scopeRootRegionId = String(regionId || '').trim()
}

export function getScopeRootRegionId() {
  return scopeRootRegionId
}

export function isScopeAll(scopeRegionId) {
  if (!scopeRegionId || scopeRegionId === SCOPE_ALL) return true
  if (scopeRootRegionId && scopeRegionId === scopeRootRegionId) return true
  return false
}

export function isScopeUnmapped(scopeRegionId) {
  return scopeRegionId === SCOPE_UNMAPPED
}

/** 列表/选中态唯一键：无归属设备同一 SN 可能来自多条 MQTT 配置 */
export function deviceScopeKey(device) {
  if (!device?.deviceId) return ''
  if (device.unmapped) {
    const mqttKey = device.mqttProfileId || device.mqttSourceRegionId
    if (mqttKey) return `${device.deviceId}@${mqttKey}`
  }
  return device.deviceId
}

export function deviceMqttProfileKey(device) {
  return device?.mqttProfileId || device?.mqttSourceRegionId || ''
}

export function withScopeQuery(url, scopeRegionId) {
  if (isScopeAll(scopeRegionId)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}scopeRegionId=${encodeURIComponent(scopeRegionId)}`
}

export function scopeStorageKey(username) {
  return `haizhu_scope_region_${username || ''}`
}

export function readStoredScopeRegion(username, validScopeIds = [], rootRegionId = '') {
  const ids = Array.isArray(validScopeIds)
    ? validScopeIds
    : (validScopeIds || []).map((r) => r?.id).filter(Boolean)
  const rootId = String(rootRegionId || scopeRootRegionId || '').trim()
  const defaultId = rootId && ids.includes(rootId) ? rootId : (ids[0] || '')
  if (!ids.length) return ''
  if (!username) return defaultId
  try {
    const stored = sessionStorage.getItem(scopeStorageKey(username))
    if (stored === SCOPE_ALL) return defaultId
    if (stored === SCOPE_UNMAPPED) return SCOPE_UNMAPPED
    if (stored && ids.includes(stored)) return stored
  } catch {}
  return defaultId
}

export function writeStoredScopeRegion(username, regionId) {
  if (!username || !regionId) return
  try {
    sessionStorage.setItem(scopeStorageKey(username), regionId)
  } catch {}
}
