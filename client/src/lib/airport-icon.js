/** 机场 / 遥控器列表图标 */

export const FACILITY_ICONS = {
  airport: { src: '/images/无人机库,机巢.svg', label: '机场机巢' },
  swap: { src: '/images/换电机场.svg', label: '换电机场', imgClass: 'device-list-icon__img--swap' },
  remote: { src: '/images/无人机遥控器.svg', label: '单兵遥控器' },
}

/** NEST 前缀为换电系列机场（与 server/lib/dock-service.js 一致） */
export function isNestSwapAirport(device) {
  if (device?.deviceType !== 'airport') return false
  const id = String(device.deviceId || '').trim()
  return id.toUpperCase().startsWith('NEST')
}

export function getFacilityIconMeta(device) {
  if (device?.deviceType === 'remote') return FACILITY_ICONS.remote
  if (isNestSwapAirport(device)) return FACILITY_ICONS.swap
  return FACILITY_ICONS.airport
}
