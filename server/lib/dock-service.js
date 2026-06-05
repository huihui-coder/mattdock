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

/** Dock 系列：舱内/舱外共用 _out 推流，切换需 MQTT live_camera_change */
function isDockSharedOutAirport(device) {
  return isDockSeriesAirport(device);
}

const METHOD_SUPPLEMENT_LIGHT_OPEN = 'supplement_light_open';
const METHOD_SUPPLEMENT_LIGHT_CLOSE = 'supplement_light_close';

const SUPPLEMENT_LIGHT_ACTIONS = {
  open: METHOD_SUPPLEMENT_LIGHT_OPEN,
  close: METHOD_SUPPLEMENT_LIGHT_CLOSE,
};

module.exports = {
  isNestSeriesAirport,
  isDockSeriesAirport,
  isDockSharedOutAirport,
  METHOD_SUPPLEMENT_LIGHT_OPEN,
  METHOD_SUPPLEMENT_LIGHT_CLOSE,
  SUPPLEMENT_LIGHT_ACTIONS,
};
