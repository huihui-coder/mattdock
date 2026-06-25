/**
 * 飞丢告警监控截图（按推流后缀直接截取，不切换舱内/舱外相机）
 */
const { captureStreamSnapshots } = require('./stream-snapshot');
const { isDockSharedOutAirport } = require('./dock-service');

async function captureLostAlertSnapshots(deviceId, { getDeviceState, processor } = {}) {
  const state = getDeviceState?.(deviceId);
  const dock = isDockSharedOutAirport({
    deviceId,
    deviceType: state?.deviceType || 'airport',
    deviceName: state?.deviceName || deviceId,
  });
  const suffixes = dock ? ['_out', '_flight'] : ['_out', '_in', '_flight'];
  return captureStreamSnapshots(deviceId, suffixes, processor?.regionId);
}

module.exports = {
  captureLostAlertSnapshots,
};
