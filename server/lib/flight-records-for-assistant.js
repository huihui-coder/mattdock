const DEFAULT_DAYS = Number(process.env.ASSISTANT_FLIGHT_DAYS) || 7;
const MAX_RECORDS = Number(process.env.ASSISTANT_FLIGHT_LIMIT) || 18;
const RANKING_TOP = Number(process.env.ASSISTANT_FLIGHT_RANK_TOP) || 10;

const TYPE_LABELS = {
  all: '全部设备',
  airport: '自动机场（绑定无人机）',
  single: '单兵无人机',
  virtual: '虚拟机场',
};

function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0');
}

function formatDurationHms(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function formatDurationHuman(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '-';
  const s = Math.floor(Number(sec));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs ? `${m}分${rs}秒` : `${m}分钟`;
}

function formatMileage(m) {
  if (m == null || Number.isNaN(Number(m))) return '-';
  const n = Number(m);
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${Math.round(n)} m`;
}

function isValidFlight(record) {
  const mileage = record.totalMileage ?? record.mileage ?? 0;
  const duration = record.totalDuration ?? record.duration ?? 0;
  return mileage > 0 && duration > 5;
}

function matchFlightType(record, type) {
  if (!type || type === 'all') return true;
  if (type === 'airport') return record.deviceType === 'drone';
  return record.deviceType === type;
}

function defaultFlightDateRange() {
  const end = new Date();
  const start = new Date(Date.now() - (DEFAULT_DAYS - 1) * 86400000);
  start.setHours(0, 0, 0, 0);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function resolveFlightQueryRange(flightView) {
  if (flightView?.startTime && flightView?.endTime) {
    return {
      startTime: flightView.startTime,
      endTime: flightView.endTime,
      activeTab: flightView.activeTab || 'all',
      tabLabel: flightView.tabLabel || TYPE_LABELS[flightView.activeTab] || '全部设备',
    };
  }
  const range = defaultFlightDateRange();
  return { ...range, activeTab: 'all', tabLabel: TYPE_LABELS.all };
}

function filterFlightHistory(history, { type, startTime, endTime }) {
  const start = startTime ? new Date(startTime).getTime() : 0;
  const end = endTime ? new Date(endTime).getTime() : Infinity;
  return history.filter((h) => {
    const t = new Date(h.startTime).getTime();
    return matchFlightType(h, type) && !Number.isNaN(t) && t >= start && t <= end;
  });
}

/** 与飞行记录页一致：仅统计有效已完成架次 */
function computeFlightStats(history) {
  const valid = history.filter(isValidFlight);
  const count = valid.length;
  const totalMileage = valid.reduce((s, r) => s + (r.totalMileage ?? r.mileage ?? 0), 0);
  const totalDuration = valid.reduce((s, r) => s + (r.totalDuration ?? r.duration ?? 0), 0);
  return {
    count,
    totalMileage,
    totalDuration,
    avgMileage: count ? totalMileage / count : 0,
    avgDuration: count ? totalDuration / count : 0,
  };
}

function buildRankingFromHistory(history, top = RANKING_TOP) {
  const deviceMap = new Map();
  for (const r of history) {
    if (!isValidFlight(r)) continue;
    const id = r.deviceId || r.deviceName;
    const name = (r.deviceName || r.deviceId || '').replace(/-无人机$/, '');
    if (!deviceMap.has(id)) {
      deviceMap.set(id, { deviceId: id, deviceName: name, count: 0, mileage: 0, duration: 0 });
    }
    const d = deviceMap.get(id);
    d.count += 1;
    d.mileage += r.totalMileage ?? r.mileage ?? 0;
    d.duration += r.totalDuration ?? r.duration ?? 0;
  }
  return Array.from(deviceMap.values())
    .sort((a, b) => b.count - a.count || b.mileage - a.mileage)
    .slice(0, top);
}

/**
 * 飞行统计快照（与飞行记录页同一套过滤与聚合）
 */
function getFlightStatsSnapshot(processor, flightView) {
  processor.syncFlightHistoryFromDisk();
  const query = resolveFlightQueryRange(flightView);
  const { startTime, endTime, activeTab, tabLabel } = query;

  const byType = {};
  for (const type of ['single', 'airport', 'virtual', 'all']) {
    const history = filterFlightHistory(processor.flightHistory, { type, startTime, endTime });
    byType[type] = computeFlightStats(history);
  }

  const currentHistory = filterFlightHistory(processor.flightHistory, {
    type: activeTab,
    startTime,
    endTime,
  });

  return {
    startTime,
    endTime,
    activeTab,
    tabLabel,
    current: computeFlightStats(currentHistory),
    byType,
    ranking: buildRankingFromHistory(currentHistory),
  };
}

function formatStatsLine(label, s) {
  if (!s.count) {
    return `  ${label}：有效架次 0（无数据）`;
  }
  return [
    `  ${label}：有效架次 ${s.count}`,
    `累计里程 ${formatMileage(s.totalMileage)}`,
    `累计时长 ${formatDurationHms(s.totalDuration)}`,
    `平均里程 ${formatMileage(s.avgMileage)}/架`,
    `平均时长 ${formatDurationHuman(s.avgDuration)}/架（${formatDurationHms(s.avgDuration)}）`,
  ].join(' | ');
}

function formatFlightStatsForAssistant(snapshot) {
  if (!snapshot) return '飞行统计：暂无数据。';

  const rangeStr = `${new Date(snapshot.startTime).toLocaleString('zh-CN', { hour12: false })} ~ ${new Date(snapshot.endTime).toLocaleString('zh-CN', { hour12: false })}`;
  const lines = [
    `【飞行统计（服务端已计算，回答架次/平均值/排名时请直接使用，禁止自行从明细推算）】`,
    `统计时间范围：${rangeStr}`,
    `用户当前飞行记录页 Tab：${snapshot.tabLabel || TYPE_LABELS[snapshot.activeTab] || snapshot.activeTab}`,
    formatStatsLine('当前 Tab', snapshot.current),
    formatStatsLine('单兵无人机', snapshot.byType.single),
    formatStatsLine('自动机场', snapshot.byType.airport),
    formatStatsLine('虚拟机场', snapshot.byType.virtual),
    formatStatsLine('全部设备', snapshot.byType.all),
  ];
  return lines.join('\n');
}

function normalizeSelectedDevice(selectedDevice) {
  if (!selectedDevice?.deviceId) return null;
  return {
    deviceId: selectedDevice.deviceId,
    name: selectedDevice.name || selectedDevice.deviceName || selectedDevice.deviceId,
    deviceType: selectedDevice.deviceType,
  };
}

function filterBySelectedDevice(records, selectedDevice) {
  const sel = normalizeSelectedDevice(selectedDevice);
  if (!sel) return records;
  const nameKey = String(sel.name).replace(/-无人机$/, '').trim();
  const filtered = records.filter((r) => {
    if (r.deviceId === sel.deviceId) return true;
    if (nameKey && r.deviceName && String(r.deviceName).includes(nameKey)) return true;
    return false;
  });
  return filtered.length ? filtered : records;
}

function formatRecordLine(r, index) {
  const start = r.startTime
    ? new Date(r.startTime).toLocaleString('zh-CN', { hour12: false })
    : '-';
  const status =
    r.status === 'active' ? '进行中' : r.status === 'completed' ? '已完成' : r.status || '';
  const mileage = formatMileage(r.totalMileage ?? r.mileage);
  const duration = formatDurationHuman(r.totalDuration ?? r.duration);
  const typeTag = r.deviceType ? `[${r.deviceType}]` : '';
  return `${index + 1}. ${r.deviceName || r.deviceId}${typeTag} | ${start} | 里程 ${mileage} | 时长 ${duration} | ${status}`;
}

function getFlightRecordsForAssistant(processor, getActiveSessions, options = {}) {
  const snapshot = getFlightStatsSnapshot(processor, options.flightView);
  const limit = options.limit ?? MAX_RECORDS;
  const selectedDevice = options.selectedDevice;

  const history = filterFlightHistory(processor.flightHistory, {
    type: snapshot.activeTab,
    startTime: snapshot.startTime,
    endTime: snapshot.endTime,
  });
  const active = typeof getActiveSessions === 'function'
    ? getActiveSessions(snapshot.activeTab === 'airport' ? 'airport' : snapshot.activeTab)
    : [];

  let all = [...active, ...history].sort(
    (a, b) => new Date(b.startTime) - new Date(a.startTime),
  );
  all = filterBySelectedDevice(all, selectedDevice);

  return all.slice(0, limit).map((r) => ({
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    deviceType: r.deviceType,
    startTime: r.startTime,
    endTime: r.endTime,
    totalMileage: r.totalMileage ?? r.mileage,
    totalDuration: r.totalDuration ?? r.duration,
    status: r.status,
  }));
}

function formatFlightRecordsForAssistant(records, options = {}) {
  const tab = options.tabLabel || '当前筛选';
  if (!records?.length) {
    return `飞行记录明细（${tab}）：暂无记录。`;
  }
  const header = `飞行记录明细（${tab}，展示最近 ${records.length} 条，完整数据以统计区为准）：`;
  return [header, ...records.map((r, i) => `  ${formatRecordLine(r, i)}`)].join('\n');
}

function formatFlightRankingForAssistant(ranking, options = {}) {
  const tab = options.tabLabel || '当前筛选';
  if (!ranking?.length) {
    return `设备飞行排名（${tab}）：暂无有效架次。`;
  }
  const lines = [`设备飞行排名（${tab}，按架次降序）：`];
  ranking.forEach((r, i) => {
    lines.push(
      `  ${i + 1}. ${r.deviceName || r.deviceId} | 架次 ${r.count} | 累计里程 ${formatMileage(r.mileage)} | 累计时长 ${formatDurationHuman(r.duration)}`,
    );
  });
  lines.push('  （下载 Excel：飞行记录页 → 设备排名 → 导出排名）');
  return lines.join('\n');
}

function getFlightRankingForAssistant(processor, options = {}) {
  const snapshot = getFlightStatsSnapshot(processor, options.flightView);
  return snapshot.ranking;
}

module.exports = {
  DEFAULT_DAYS,
  MAX_RECORDS,
  RANKING_TOP,
  getFlightStatsSnapshot,
  formatFlightStatsForAssistant,
  getFlightRecordsForAssistant,
  getFlightRankingForAssistant,
  formatFlightRecordsForAssistant,
  formatFlightRankingForAssistant,
};
