const { buildFlightStats, buildFlightRanking } = require('./flight-query');
const {
  getFlightStatsSnapshotFromHistory,
  getFlightRecordsForAssistant,
} = require('./flight-records-for-assistant');
const { enrichSelectedDeviceFromSnapshots } = require('./device-status-for-assistant');

function buildMonitorStats(devices) {
  const list = devices || [];
  return {
    total: list.length,
    airport: list.filter((d) => d.deviceType === 'airport' || d.deviceType === 'remote').length,
    drone: list.filter((d) => ['drone', 'single', 'virtual'].includes(d.deviceType)).length,
    single: list.filter((d) => d.deviceType === 'single').length,
    normal: list.filter((d) => d.status === 'normal').length,
    warning: list.filter((d) => d.status === 'warning').length,
    critical: list.filter((d) => d.status === 'critical').length,
  };
}

function resolveScopeRegionLabel(regionId, scopeUnmappedOnly, regions, visibleProcessors) {
  if (scopeUnmappedOnly) return '无归属设备';
  if (!regionId || regionId === '__unmapped__') return '全部可见区域';
  const row = (regions || []).find((r) => r.id === regionId);
  if (row?.name) return row.name;
  const names = [...new Set(visibleProcessors.map((p) => p.regionName).filter(Boolean))];
  return names.length ? names.join('、') : regionId;
}

function filterClientContextByScope(ctx, allowedDeviceIds) {
  const alerts = (ctx?.alerts || []).filter((a) => a?.deviceId && allowedDeviceIds.has(a.deviceId));
  const healthAlerts = (ctx?.healthAlerts || []).filter(
    (h) => h?.deviceId && allowedDeviceIds.has(h.deviceId),
  );
  let selectedDevice = ctx?.selectedDevice || null;
  if (selectedDevice?.deviceId && !allowedDeviceIds.has(selectedDevice.deviceId)) {
    selectedDevice = null;
  }
  return {
    ...ctx,
    alerts: alerts.slice(0, 12),
    healthAlerts: healthAlerts.slice(0, 24),
    selectedDevice,
  };
}

/**
 * 按与监控/飞行记录页相同的区域范围，重建飞行助手上下文
 */
function enrichAssistantContextWithScope(ctx, {
  regionRuntime,
  visibleProcessors,
  regions,
  scopeUnmappedOnly,
  regionId,
  visibleRegionIds,
}) {
  const flightView = ctx?.flightView || null;
  const query = flightView || {};
  const history = regionRuntime.collectFlightHistoryFromScope(
    visibleProcessors,
    regions,
    {
      type: query.activeTab || query.type,
      startTime: query.startTime,
      endTime: query.endTime,
      unmappedOnly: scopeUnmappedOnly,
    },
  );

  const active = regionRuntime.buildActiveSessionsFromScope(
    flightView?.activeTab === 'airport' ? 'airport' : (flightView?.activeTab || null),
    visibleProcessors,
    regions,
    { unmappedOnly: scopeUnmappedOnly },
  );

  const flightStats = getFlightStatsSnapshotFromHistory(history, flightView);
  const primaryProcessor = visibleProcessors[0]?.processor || regionRuntime.getDefaultProcessor();
  const flightRecords = getFlightRecordsForAssistant(
    primaryProcessor,
    () => active,
    {
      flightView,
      selectedDevice: ctx?.selectedDevice,
      historyOverride: history,
    },
  );

  const devices = regionRuntime.collectDevicesFromScope(visibleProcessors, regions, {
    unmappedOnly: scopeUnmappedOnly,
  });
  const allowedDeviceIds = new Set(devices.map((d) => d.deviceId).filter(Boolean));
  const scopedClient = filterClientContextByScope(ctx, allowedDeviceIds);
  const scopeRegionLabel = resolveScopeRegionLabel(
    regionId,
    scopeUnmappedOnly,
    regions,
    visibleProcessors,
  );

  return {
    ...scopedClient,
    stats: buildMonitorStats(devices),
    deviceSnapshots: devices,
    selectedDevice: enrichSelectedDeviceFromSnapshots(devices, scopedClient.selectedDevice),
    flightStats,
    flightRecords,
    flightRanking: flightStats.ranking,
    regionScope: visibleRegionIds,
    scopeRegionId: regionId,
    scopeRegionLabel,
    scopeDeviceCount: devices.length,
    scopeLeafRegions: visibleProcessors.map(({ regionId: id, regionName }) => ({
      id,
      name: regionName || id,
    })),
  };
}

module.exports = {
  buildMonitorStats,
  enrichAssistantContextWithScope,
  filterClientContextByScope,
  resolveScopeRegionLabel,
};
