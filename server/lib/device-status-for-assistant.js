const MAX_DEVICES = Number(process.env.ASSISTANT_DEVICE_LIMIT) || 60;

const TYPE_LABELS = {
  airport: '机场',
  remote: '遥控器',
  drone: '无人机',
  single: '单兵',
  virtual: '虚拟',
};

function isAirportLike(device) {
  return device?.deviceType === 'airport' || device?.deviceType === 'remote';
}

function metricText(metric, fallback = '-') {
  if (!metric) return fallback;
  if (metric.statusText) {
    const val = metric.value != null ? `${metric.value}${metric.unit || ''}` : '';
    return val ? `${metric.statusText}(${val})` : metric.statusText;
  }
  return metric.value != null ? `${metric.value}${metric.unit || ''}` : fallback;
}

function formatNetworkType(type) {
  if (type == null) return null;
  if (type === 2) return '4G';
  return `类型${type}`;
}

function formatNetwork(metric) {
  if (!metric) return '-';
  const parts = [];
  const netType = formatNetworkType(metric.type);
  if (netType) parts.push(netType);
  if (metric.value != null) parts.push(`${metric.value}/5`);
  if (metric.statusText) parts.push(metric.statusText);
  if (metric.rate != null) parts.push(`${Number(metric.rate).toFixed(1)}Mbps`);
  return parts.join(' ') || '-';
}

function isRaining(device) {
  const rainfall = device?.metrics?.rainfall;
  if (!rainfall) return false;
  if (Number(rainfall.value) > 0) return true;
  return rainfall.statusText != null && rainfall.statusText !== '无雨';
}

function formatAirportLine(device) {
  const metrics = device.metrics || {};
  const parts = [
    device.deviceName || device.deviceId,
    device.regionName ? `@${device.regionName}` : '',
    `状态:${device.statusText || device.status || '未知'}`,
    `降雨:${metricText(metrics.rainfall, '未知')}`,
    `网络:${formatNetwork(metrics.networkQuality)}`,
    `无人机:${metricText(metrics.droneInDock, '-')}`,
    `子设备:${metricText(metrics.subDeviceOnline, '-')}`,
  ];
  if (metrics.windSpeed) parts.push(`风速:${metricText(metrics.windSpeed)}`);
  if (metrics.modeCode) parts.push(`模式:${metrics.modeCode.statusText || metrics.modeCode.value}`);
  if (metrics.droneBattery) parts.push(`电量:${metricText(metrics.droneBattery)}`);
  if (metrics.temperature) parts.push(`机库温:${metricText(metrics.temperature)}`);
  if (metrics.batterySlots) parts.push(`电池槽:${metrics.batterySlots.statusText || metrics.batterySlots.value}`);
  return `- ${parts.join(' | ')}`;
}

function formatOtherDeviceLine(device) {
  const metrics = device.metrics || {};
  const typeLabel = TYPE_LABELS[device.deviceType] || device.deviceType || '设备';
  const parts = [
    device.deviceName || device.deviceId,
    device.regionName ? `@${device.regionName}` : '',
    typeLabel,
    `状态:${device.statusText || device.status || '未知'}`,
  ];
  if (metrics.windSpeed) parts.push(`风速:${metricText(metrics.windSpeed)}`);
  if (metrics.droneBattery) parts.push(`电量:${metricText(metrics.droneBattery)}`);
  if (metrics.modeCode) parts.push(`模式:${metrics.modeCode.statusText || metrics.modeCode.value}`);
  if (metrics.operational) parts.push(`链路:${metrics.operational.statusText || metrics.operational.value}`);
  return `- ${parts.join(' | ')}`;
}

function formatRainfallSummary(airports) {
  const raining = airports.filter(isRaining);
  const noRain = airports.filter((d) => d.metrics?.rainfall && !isRaining(d));
  const unknown = airports.filter((d) => !d.metrics?.rainfall);
  const lines = [
    `降雨汇总：共 ${airports.length} 台机场，下雨 ${raining.length} 台、无雨 ${noRain.length} 台${unknown.length ? `、无降雨数据 ${unknown.length} 台` : ''}`,
  ];
  if (raining.length) {
    lines.push(
      `  正在下雨：${raining.map((d) => `${d.deviceName || d.deviceId}(${metricText(d.metrics?.rainfall)})`).join('、')}`,
    );
  }
  return lines.join('\n');
}

function formatDevicesForAssistant(devices) {
  if (!Array.isArray(devices) || !devices.length) {
    return '【设备实时状态】当前可见范围内无设备上报数据（可能 MQTT 未连接或设备尚未上报）。';
  }

  const list = devices.slice(0, MAX_DEVICES);
  const airports = list.filter(isAirportLike).sort((a, b) =>
    String(a.deviceName || a.deviceId).localeCompare(String(b.deviceName || b.deviceId), 'zh-CN'),
  );
  const others = list.filter((d) => !isAirportLike(d)).sort((a, b) =>
    String(a.deviceName || a.deviceId).localeCompare(String(b.deviceName || b.deviceId), 'zh-CN'),
  );

  const lines = [
    '【设备实时状态（MQTT 最新上报；回答降雨/网络/在库/电量/风速等问题时使用，禁止编造）】',
  ];

  if (airports.length) {
    lines.push(formatRainfallSummary(airports));
    lines.push(`机场明细（${airports.length} 台）：`);
    for (const device of airports) lines.push(formatAirportLine(device));
  } else {
    lines.push('机场：当前范围内无机场设备。');
  }

  if (others.length) {
    lines.push(`其他设备（${others.length} 台）：`);
    for (const device of others) lines.push(formatOtherDeviceLine(device));
  }

  if (devices.length > MAX_DEVICES) {
    lines.push(`（仅展示前 ${MAX_DEVICES} 台，共 ${devices.length} 台）`);
  }

  return lines.join('\n');
}

function enrichSelectedDeviceFromSnapshots(devices, selectedDevice) {
  if (!selectedDevice?.deviceId) return selectedDevice;
  const full = (devices || []).find((d) => d.deviceId === selectedDevice.deviceId);
  if (!full) return selectedDevice;
  const metrics = full.metrics || {};
  return {
    ...selectedDevice,
    name: selectedDevice.name || full.deviceName,
    deviceType: selectedDevice.deviceType || full.deviceType,
    status: selectedDevice.status || full.status,
    statusText: full.statusText || selectedDevice.status,
    regionName: full.regionName,
    windSpeed: selectedDevice.windSpeed ?? metrics.windSpeed?.value,
    battery: selectedDevice.battery ?? metrics.droneBattery?.value,
    rainfall: metrics.rainfall?.statusText || metrics.rainfall?.value,
    networkQuality: metrics.networkQuality?.statusText,
    droneInDock: metrics.droneInDock?.statusText,
    subDeviceOnline: metrics.subDeviceOnline?.statusText,
    modeCode: metrics.modeCode?.statusText,
  };
}

module.exports = {
  formatDevicesForAssistant,
  enrichSelectedDeviceFromSnapshots,
  isRaining,
};
