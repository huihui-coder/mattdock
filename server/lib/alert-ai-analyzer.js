const fs = require('fs');
const path = require('path');
const { callZhipuChatCompletion, getApiKey, ZHIPU_MODEL } = require('./zhipu-client');
const { captureStreamSnapshots } = require('./stream-snapshot');
const {
  appendAlertRecord,
  getRecentAlerts,
  formatHistoryForPrompt,
} = require('./alert-history-store');
const { computeLocationDistanceContext } = require('./geo-utils');

const FLIGHT_HISTORY_FILE = path.join(__dirname, '../../haizhuDB/flight-history.json');

const LOST_SYSTEM = `你是海珠无人机管理平台的告警分析专家。对「疑似飞丢/离巢超时」告警，必须按下列逻辑给出结论：

1. **距离测算**：使用系统提供的无人机最后 GPS、机场 GPS 及直线距离；说明飞机最后大致位置（经纬度、高度、距机场多远）。
2. **画面判定（核心）**：结合机场**内部**与**外部**监控截图（及无人机画面如有），判断场景是在机库内还是机库外：
   - **机场外**：内外部画面显示无人机不在机库内/已在外部或备降区域 → 倾向判断为已**降落到备降点**（非正常回巢），不是单纯飞丢；给出最后位置与处置建议（现场核实、回收等）。
   - **机场内**：内外部画面显示无人机实际仍在机库内部 → 倾向判断为**霍尔传感器或在舱检测异常**（误报离巢），飞机很可能仍在机场内，建议检查传感器与舱位检测，而非按飞丢搜救。
3. GPS 距离与画面结论应相互印证；若矛盾，说明可能原因（GPS 漂移、画面角度等）。
4. 结合历史告警/飞行记录补充判断。

输出 Markdown，必须包含：**结论**、**距离与最后位置**、**画面分析（内外部）**、**历史关联**、**建议操作**。简洁务实，勿编造。`;

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
    const inOutShots = shots.filter((s) => s.suffix === '_out' || s.suffix === '_in');
    const shotDesc = shots.length
      ? shots.map((s) => s.label).join('、')
      : '未能获取监控截图（流可能不可用）';

    const airportLoc = deviceState?.location || null;
    const distCtx = computeLocationDistanceContext(location, airportLoc);

    const locStr = location
      ? `${location.latitude}, ${location.longitude}（高度 ${location.height || 0}m）`
      : '未知（未收到绑定无人机 GPS）';

    const airportLocStr = airportLoc
      ? `${airportLoc.latitude}, ${airportLoc.longitude}`
      : '未知（未收到机场 OSD 坐标）';

    const textPrompt = `【告警类型】无人机离巢 / 疑似飞丢
【设备】${deviceName}（${deviceId}）
【离巢时长】${elapsedMin} 分钟
【无人机在线状态】${subDeviceOnline === 1 ? '在线（可能执行任务中）' : '离线'}

${distCtx.promptBlock}

【机场坐标】${airportLocStr}
【无人机最后 GPS】${locStr}
【附带截图】${shotDesc}（请重点分析内外部画面判断飞机在机场内还是外）

【分析要求】
1. 根据直线距离说明飞机最后位置距机场多远；
2. 查看机场外部、内部截图：若飞机在机场外 → 判断为降落到备降点并描述大致位置；若在机场内 → 判断为霍尔传感器/在舱检测异常；
3. 无人机画面（如有）作为辅助参考。

【最后已知设备指标】
${formatDeviceMetrics(deviceState)}

【该设备近期告警记录】
${formatHistoryForPrompt(history)}

【该设备近期飞行记录】
${formatFlightHistory(flights)}

请按系统提示的结构输出分析。`;

    const analysis = await callZhipuChatCompletion({
      messages: [
        { role: 'system', content: LOST_SYSTEM },
        {
          role: 'user',
          content: buildMultimodalUserContent({
            textPrompt,
            // 内外部画面优先送入模型，便于判断是否在机场内
            images: inOutShots.length ? [...inOutShots, ...shots.filter((s) => s.suffix === '_flight')] : shots,
          }),
        },
      ],
      onTokenUsage,
    });

    const record = appendAlertRecord({
      deviceId,
      deviceName,
      alertType: 'lost',
      type: 'lost',
      elapsedMin,
      summary: distCtx.ok
        ? `离巢 ${elapsedMin} 分钟，距机场 ${distCtx.distanceText}`
        : `离巢 ${elapsedMin} 分钟，疑似飞丢`,
      distanceMeters: distCtx.meters ?? null,
      droneLastLocation: location || null,
      airportLocation: airportLoc || null,
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
