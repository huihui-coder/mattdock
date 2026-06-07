/** 将前端监控快照整理为 system 附加上下文 */
const {
  formatFlightRecordsForAssistant,
  formatFlightRankingForAssistant,
  formatFlightStatsForAssistant,
} = require('./flight-records-for-assistant');

function buildAssistantContext(context = {}) {
  const lines = ['【平台参考数据（仅供回答相关问题时引用，勿整段复述）】'];
  const {
    stats,
    alerts,
    selectedDevice,
    mqttConnected,
    wsConnected,
    flightRecords,
    flightRanking,
    flightStats,
    healthAlerts,
    scopeRegionLabel,
    scopeDeviceCount,
    scopeLeafRegions,
  } = context;

  if (scopeRegionLabel) {
    const leafHint = scopeLeafRegions?.length
      ? `（含 ${scopeLeafRegions.map((r) => r.name).join('、')}）`
      : '';
    lines.push(`当前数据范围：${scopeRegionLabel}${leafHint}；可见设备 ${scopeDeviceCount ?? stats?.total ?? 0} 台`);
  }
  if (stats) {
    lines.push(
      `设备：共 ${stats.total ?? 0} 台（机场 ${stats.airport ?? 0} / 无人机 ${stats.drone ?? 0}）；正常 ${stats.normal ?? 0}、警告 ${stats.warning ?? 0}、严重 ${stats.critical ?? 0}`,
    );
  }
  lines.push(`MQTT：${mqttConnected ? '已连接' : '未连接'}；实时通道：${wsConnected ? '在线' : '离线'}`);

  if (selectedDevice) {
    const d = selectedDevice;
    lines.push(
      `当前关注设备：${d.name || d.deviceId}（${d.deviceId}）状态=${d.status || 'unknown'}`,
    );
    if (d.windSpeed != null) lines.push(`  风速 ${d.windSpeed} m/s`);
    if (d.battery != null) lines.push(`  电量 ${d.battery}%`);
  }

  const list = Array.isArray(alerts) ? alerts.slice(0, 12) : [];
  if (list.length) {
    lines.push('离巢/环境类告警（近期）：');
    for (const a of list) {
      lines.push(
        `  - ${a.deviceName || a.deviceId || '设备'} | ${a.type || a.alertType || '告警'} | ${a.level || a.severity || ''} | ${a.message || a.detail || ''}`,
      );
    }
  } else {
    lines.push('离巢/环境类告警：无（或用户未在监控页）');
  }

  const hmsList = Array.isArray(healthAlerts) ? healthAlerts.slice(0, 20) : [];
  if (hmsList.length) {
    lines.push('健康告警 HMS（机械臂/电机/任务等，回答设备故障时优先查此表）：');
    for (const h of hmsList) {
      lines.push(
        `  - ${h.deviceName || h.deviceId || '设备'} | ${h.levelText || h.level || ''} | ${h.module || ''} | ${h.message || h.code || ''}`,
      );
    }
  } else {
    lines.push('健康告警 HMS：无');
  }

  lines.push(formatFlightStatsForAssistant(flightStats));

  lines.push(
    formatFlightRecordsForAssistant(flightRecords, {
      tabLabel: flightStats?.tabLabel,
    }),
  );

  lines.push(
    formatFlightRankingForAssistant(flightRanking, {
      tabLabel: flightStats?.tabLabel,
    }),
  );

  lines.push(
    '数据使用说明：以上仅为后台参考；须先理解并直接回答用户当前问题，再按需引用相关条目，禁止答非所问或擅自输出与用户无关的摘要。',
  );
  return lines.join('\n');
}

module.exports = { buildAssistantContext };
