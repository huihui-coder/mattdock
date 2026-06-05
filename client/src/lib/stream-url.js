const cache = new Map()

function getToken() {
  return localStorage.getItem('auth_token') || ''
}

export async function fetchStreamUrl(deviceId, suffix = '_out', regionId = '') {
  const key = `${regionId || 'auto'}:${deviceId}:${suffix}`
  if (cache.has(key)) return cache.get(key)

  const params = new URLSearchParams({ deviceId, suffix })
  if (regionId) params.set('regionId', regionId)

  const res = await fetch(`/api/stream/url?${params}`, {
    headers: { 'x-auth-token': getToken() },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '获取推流地址失败')

  cache.set(key, data.url)
  return data.url
}

export function clearStreamUrlCache() {
  cache.clear()
}
