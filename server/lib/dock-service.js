const NON_DOCK_TYPES = new Set(['drone', 'single', 'remote', 'airport_drone']);

function readDeviceId(device) {
  return String(device?.deviceId || '').trim();
}

function readDeviceType(device) {
  return String(device?.deviceType || '').toLowerCase();
}

/** NEST 前缀为换电系列机场 */
function isNestSeriesAirport(device) {
  const id = readDeviceId(device);
  if (!id.startsWith('NEST')) return false;
  const type = readDeviceType(device);
  return !type || type === 'airport';
}

/** Dock 系列机场：凡非 NEST 开头的 gateway SN（不按 deviceType 卡死） */
function isDockSeriesAirport(device) {
  const id = readDeviceId(device);
  if (!id || id.startsWith('NEST')) return false;
  const type = readDeviceType(device);
  if (NON_DOCK_TYPES.has(type)) return false;
  return true;
}

/** Dock 系列：舱内/舱外共用 _out 推流 */
function isDockSharedOutAirport(device) {
  return isDockSeriesAirport(device);
}

module.exports = {
  isNestSeriesAirport,
  isDockSeriesAirport,
  isDockSharedOutAirport,
};
