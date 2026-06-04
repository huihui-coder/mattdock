/** 将前端监控快照整理为 system 附加上下文 */
function buildAssistantContext(context = {}) {
  const lines = ['【当前平台数据快照】'];
  const { stats, alerts, selectedDevice, mqttConnected, wsConnected } = context;

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
    lines.push('近期告警：');
    for (const a of list) {
      lines.push(
        `  - ${a.deviceName || a.deviceId || '设备'} | ${a.type || a.alertType || '告警'} | ${a.level || a.severity || ''} | ${a.message || a.detail || ''}`,
      );
    }
  } else {
    lines.push('近期告警：无（或用户未在监控页）');
  }

  lines.push(
    '回答要求：基于以上数据分析，勿编造未出现的设备或数值；处置建议需标注依据；严重操作仅建议、由人工确认。',
  );
  return lines.join('\n');
}

module.exports = { buildAssistantContext };
