const fs = require('fs');
const path = require('path');
const { callZhipuChatCompletion, getApiKey, ZHIPU_MODEL } = require('./zhipu-client');
const { captureStreamSnapshots } = require('./stream-snapshot');
const {
  appendAlertRecord,
  getRecentAlerts,
  formatHistoryForPrompt,
} = require('./alert-history-store');

const FLIGHT_HISTORY_FILE = path.join(__dirname, '../../haizhuDB/flight-history.json');

const LOST_SYSTEM = `你是海珠无人机管理平台的告警分析专家。结合监控画面、实时指标与历史记录，对「疑似飞丢/离巢超时」告警给出专业、可执行的结论。
输出 Markdown，必须包含：**结论**、**画面分析**、**历史关联**、**建议操作** 四部分。简洁务实，勿编造未出现的信息。`;

const OFFLINE_SYSTEM = `你是海珠无人机管理平台的告警分析专家。对「机场离线」告警，重点评估网络与市电稳定性，并结合历史记录判断故障模式。
输出 Markdown，必须包含：**结论**、**网络/供电分析**、**历史关联**、**建议操作** 四部分。若无画面则依据最后已知指标与历史记录分析。`;

function loadFlightHistory(deviceId, limit = 5) {
  try {
    if (!fs.existsSync(FLIGHT_HISTORY_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(FLIGHT_HISTORY_FILE, 'utf8'));
    if (!Array.isArray(list)) return [];
    return list
      .filter((f) => f.deviceId === deviceId || String(f.deviceName || '').includes(deviceId))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function formatFlightHistory(records) {
  if (!records.length) return '暂无相关飞行记录。';
  return records
    .map((f, i) => {
      const start = f.startTime || '';
      const end = f.endTime || '';
      const mileage = f.totalMileage ?? f.mileage;
      const duration = f.totalDuration ?? f.duration;
      return `${i + 1}. ${start} ~ ${end} | 里程 ${mileage ?? '-'}m | 时长 ${duration ?? '-'}s | ${f.status || ''}`;
    })
    .join('\n');
}

function formatDeviceMetrics(deviceState) {
  if (!deviceState) return '无最后已知设备指标（可能从未上报或已过期）。';

  const lines = [];
  lines.push(`设备：${deviceState.deviceName || deviceState.deviceId}`);
  lines.push(`状态：${deviceState.statusText || deviceState.status || '未知'}`);
  lines.push(`最后更新：${deviceState.lastUpdate || '未知'}`);

  const m = deviceState.metrics || {};
  if (m.networkQuality) {
    lines.push(
      `网络：${m.networkQuality.statusText || m.networkQuality.value}（类型 ${m.networkQuality.type ?? '-'}，速率 ${m.networkQuality.rate ?? '-'}）`,
    );
  }
  if (m.droneBattery) {
    lines.push(`无人机电量：${m.droneBattery.value ?? '-'}%`);
  }
  if (m.temperature) lines.push(`机库温度：${m.temperature.value ?? '-'}°C`);
  if (m.humidity) lines.push(`机库湿度：${m.humidity.value ?? '-'}%`);
  if (m.windSpeed) lines.push(`风速：${m.windSpeed.value ?? '-'} m/s`);
  if (m.rainfall) lines.push(`降雨：${m.rainfall.statusText || m.rainfall.value}`);
  if (m.droneInDock) lines.push(`无人机在库：${m.droneInDock.statusText || m.droneInDock.value}`);
  if (m.subDeviceOnline) {
    lines.push(`子设备（无人机）：${m.subDeviceOnline.statusText || m.subDeviceOnline.value}`);
  }
  if (deviceState.location) {
    const loc = deviceState.location;
    lines.push(`位置：${loc.latitude}, ${loc.longitude}（高度 ${loc.height || 0}m）`);
  }
  return lines.join('\n');
}

function buildMultimodalUserContent({ textPrompt, images }) {
  const content = [];
  for (const img of images || []) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime || 'image/jpeg'};base64,${img.base64}` },
    });
  }
  content.push({ type: 'text', text: textPrompt });
  return content;
}

function createAlertAiAnalyzer({ updateTokenUsage } = {}) {
  const onTokenUsage = updateTokenUsage
    ? (usage) => updateTokenUsage(ZHIPU_MODEL, usage)
    : undefined;

  async function analyzeLostAlert({
    deviceId,
    deviceName,
    elapsedMin,
    location,
    subDeviceOnline,
    deviceState,
  }) {
    const history = getRecentAlerts(deviceId, 8);
    const flights = loadFlightHistory(deviceId, 5);

    const shots = await captureStreamSnapshots(deviceId, ['_out', '_in', '_flight']);
    const shotDesc = shots.length
      ? shots.map((s) => s.label).join('、')
      : '未能获取监控截图（流可能不可用）';

    const locStr = location
      ? `${location.latitude}, ${location.longitude}（高度 ${location.height || 0}m）`
      : '未知';

    const textPrompt = `【告警类型】无人机离巢 / 疑似飞丢
【设备】${deviceName}（${deviceId}）
【离巢时长】${elapsedMin} 分钟
【无人机在线状态】${subDeviceOnline === 1 ? '在线（可能执行任务中）' : '离线'}
【最后位置】${locStr}
【附带截图】${shotDesc}

【最后已知设备指标】
${formatDeviceMetrics(deviceState)}

【该设备近期告警记录】
${formatHistoryForPrompt(history)}

【该设备近期飞行记录】
${formatFlightHistory(flights)}

请综合以上信息与截图，判断当前风险等级并给出处置建议。`;

    const analysis = await callZhipuChatCompletion({
      messages: [
        { role: 'system', content: LOST_SYSTEM },
        { role: 'user', content: buildMultimodalUserContent({ textPrompt, images: shots }) },
      ],
      onTokenUsage,
    });

    const record = appendAlertRecord({
      deviceId,
      deviceName,
      alertType: 'lost',
      type: 'lost',
      elapsedMin,
      summary: `离巢 ${elapsedMin} 分钟，疑似飞丢`,
      snapshotCount: shots.length,
      aiAnalysis: analysis,
    });

    return { analysis, record, snapshotCount: shots.length };
  }

  async function analyzeOfflineAlert({
    deviceId,
    deviceName,
    elapsedMin,
    offlineType = 'offline_first',
    deviceState,
  }) {
    const history = getRecentAlerts(deviceId, 8);
    const flights = loadFlightHistory(deviceId, 5);

    const shots = await captureStreamSnapshots(deviceId, ['_out', '_in']);
    const shotDesc = shots.length
      ? shots.map((s) => s.label).join('、')
      : '未能获取监控截图（机场可能已断网/断电）';

    const offlineLabel =
      offlineType === 'offline_repeat' ? `机场持续离线 ${elapsedMin} 分钟` : '机场刚检测到离线';

    const textPrompt = `【告警类型】机场离线
【设备】${deviceName}（${deviceId}）
【离线情况】${offlineLabel}

请重点分析：
1. 该机场网络连接是否稳定（4G/有线、信号质量、历史断连频率）
2. 市电/供电是否稳定（从画面、环境指标与历史记录推断）
3. 结合历史离线/告警记录判断是偶发还是频繁故障

【附带截图】${shotDesc}

【最后已知设备指标（离线前）】
${formatDeviceMetrics(deviceState)}

【该设备近期告警记录】
${formatHistoryForPrompt(history)}

【该设备近期飞行记录】
${formatFlightHistory(flights)}

请给出排查优先级与具体处置步骤。`;

    const analysis = await callZhipuChatCompletion({
      messages: [
        { role: 'system', content: OFFLINE_SYSTEM },
        { role: 'user', content: buildMultimodalUserContent({ textPrompt, images: shots }) },
      ],
      onTokenUsage,
    });

    const record = appendAlertRecord({
      deviceId,
      deviceName,
      alertType: offlineType,
      type: 'offline',
      elapsedMin,
      summary: offlineLabel,
      snapshotCount: shots.length,
      aiAnalysis: analysis,
    });

    return { analysis, record, snapshotCount: shots.length };
  }

  async function analyzeAlert(params) {
    if (!getApiKey()) {
      console.warn('[AlertAI] 未配置 ZHIPU_API_KEY，跳过 AI 分析');
      return null;
    }

    const { alertKind } = params;
    if (alertKind === 'lost') return analyzeLostAlert(params);
    if (alertKind === 'offline' || alertKind === 'offline_first' || alertKind === 'offline_repeat') {
      return analyzeOfflineAlert(params);
    }
    return null;
  }

  return { analyzeAlert, analyzeLostAlert, analyzeOfflineAlert };
}

module.exports = { createAlertAiAnalyzer };
