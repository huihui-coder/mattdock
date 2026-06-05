const crypto = require('crypto');
const { isDockSharedOutAirport } = require('./dock-service');

function resolveVideoId(gatewaySn, override) {
  if (override && String(override).trim()) return String(override).trim();
  const envKey = `LIVE_VIDEO_ID_${gatewaySn}`;
  if (process.env[envKey]) return process.env[envKey];
  const template =
    process.env.DOCK_LIVE_VIDEO_ID_TEMPLATE ||
    process.env.DOCK3_LIVE_VIDEO_ID_TEMPLATE ||
    '{deviceId}/165-0-7/normal-0';
  return template.replace(/\{deviceId\}/g, gatewaySn);
}

function newMqttIds() {
  const id = crypto.randomUUID();
  return { bid: id, tid: id };
}

/** @deprecated 请用 isDockSharedOutAirport */
const isDock3SharedOutAirport = isDockSharedOutAirport;

module.exports = {
  isDockSharedOutAirport,
  isDock3SharedOutAirport,
  resolveVideoId,
  newMqttIds,
  METHOD_LIVE_CAMERA_CHANGE: 'live_camera_change',
};
