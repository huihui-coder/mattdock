/** WebSocket / 轻量 API 用设备快照（不含 MQTT raw、不含内部字段） */

function toWsDevicePayload(processed) {
  if (!processed) return null;
  return {
    deviceId: processed.deviceId,
    deviceName: processed.deviceName,
    deviceType: processed.deviceType,
    gateway: processed.gateway,
    status: processed.status,
    statusText: processed.statusText,
    metrics: processed.metrics,
    location: processed.location,
    alerts: processed.alerts,
    lastUpdate: processed.lastUpdate,
    lastSeen: processed.lastSeen,
    regionId: processed.regionId,
    regionName: processed.regionName,
    boundDroneSn: processed.boundDroneSn,
    flightSession: processed.flightSession || processed.activeSession || null,
    osdSnapshot: processed.osdSnapshot || null,
    unmapped: processed.unmapped,
    mqttConnectionRegionId: processed.mqttConnectionRegionId,
  };
}

module.exports = {
  toWsDevicePayload,
};
