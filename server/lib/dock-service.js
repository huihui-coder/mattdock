/** Dock 系列机场（Dock / Dock2 / Dock3 等） */
function isDockSeriesAirport(device) {
  if (!device) return false;
  const type = device.deviceType || (device.deviceId?.startsWith('NEST') ? 'airport' : '');
  if (type !== 'airport') return false;
  const name = device.deviceName || device.deviceId || '';
  if (/dock/i.test(name)) return true;
  const sns = [process.env.DOCK_GATEWAY_SNS, process.env.DOCK3_GATEWAY_SNS]
    .filter(Boolean)
    .join(',');
  const list = sns
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(device.deviceId);
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
  isDockSeriesAirport,
  isDockSharedOutAirport,
  METHOD_SUPPLEMENT_LIGHT_OPEN,
  METHOD_SUPPLEMENT_LIGHT_CLOSE,
  SUPPLEMENT_LIGHT_ACTIONS,
};
