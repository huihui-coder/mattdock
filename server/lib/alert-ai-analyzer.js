const fs = require('fs');
const path = require('path');
const {
  callArkCompletion,
  getApiKey,
  getAssistantModel,
  shouldUseWebSearch,
} = require('./ark-client');
const { captureStreamSnapshots } = require('./stream-snapshot');
const { captureLostAlertSnapshots } = require('./dock-lost-alert-snapshots');
const {
  appendAlertRecord,
  getRecentAlerts,
  formatHistoryForPrompt,
} = require('./alert-history-store');
const { computeLocationDistanceContext } = require('./geo-utils');
const { MODE_CODE_TEXT } = require('../device-processor');

const FLIGHT_HISTORY_FILE = path.join(__dirname, '../../haizhuDB/flight-history.json');

// 识别参考（仅供模型内部对照，禁止写入回复）
const LOST_VISUAL_REFERENCE = `
Dock 舱内空舱：竖金属板+向上三角+通风格栅，无 X 型四旋翼机体。
Dock 舱内有飞机：平台中央白色 X 型四旋翼，可见机臂与机身。
其它系列内部空舱：白色贴标平台空旷，无中央四旋翼。
其它系列内部有飞机：贴标平台中央停有四旋翼整机。
勿把结构件、贴标、光斑当成无人机。`;

const LOST_VISION_SYSTEM = `你是监控画面判读助手。本告警触发时传感器已报「离巢」（认为飞机不在舱内）。你只看截图判断，不写原因、不联网。

${LOST_VISUAL_REFERENCE}

## 「与传感器」怎么判（只比较舱内）
传感器报离巢 = 认为舱内无飞机。此项**只看舱内画面**与传感器是否相符，舱外不参与判断：
- 画面舱内「无无人机」→ **一致**
- 画面舱内「有无人机」→ **不一致**（传感器报离巢但舱内可见飞机）
- 画面舱内「无法确认」→ **无法判断**

## 输出格式（严格遵守）
只输出「画面判读」小节：

### 画面判读
> **舱内**：有无人机 | 无无人机 | 无法确认
> **舱外**：有无人机 | 无无人机 | 无法确认
> **与传感器**：一致 | 不一致 | 无法判断

填「不一致」时括号内一句话说明；填「一致」或「无法判断」时勿加括号解释。

禁止写原因分析、排查步骤、GPS、历史记录。`;

const LOST_FLIGHT_VISION_SYSTEM = `你是无人机机载相机画面判读助手。根据无人机第一视角截图，简要描述当前所见，不写机场舱内舱外判读、不联网。

若画面全黑、花屏、仅噪声无有效场景，状态填「无信号」。

## 输出格式（严格遵守）
只输出「无人机画面」小节：

### 无人机画面
> **状态**：空中飞行 | 地面/近地 | 无信号 | 无法确认
> **场景**：一句话描述视野内容（地形、建筑、作业对象等）
> **飞行迹象**：一句话（如疑似航线作业、刚起飞爬升、悬停、返航中等，仅据画面推断）

禁止写处置建议、GPS 数值、长篇推理。`;

const LOST_REASON_SYSTEM = `你是海珠无人机管理平台的离巢告警分析助手。请**综合**画面判读与用户提供的 OSD、位置、飞行模式、告警时长等信息，给出简短务实的判断。

分析时务必用到已提供的数据，例如：
- 子设备在线/离线、mode_code 飞行模式（航线飞行、自动起飞、返航等）
- 无人机与机场的 GPS 距离、高度
- 离巢已持续多久、与当前检查阈值的关系
- 机场画面舱内/舱外是否有飞机、「与传感器」是否一致（仅比较舱内）
- 若有「无人机画面判读」，结合机载视角判断是否在飞行、执行何种作业

勿套用固定故障模板。按证据判断：可能是正常任务起飞/航线作业、刚起飞尚在机场附近、被人取走、飞丢未归等，把最符合当前数据的解释放在前面。

若 OSD 显示在线且为飞行模式、距机场很近且有高度，离巢时长接近或刚达阈值，应优先考虑**正常执行任务**，建议适当**加大离巢检查时长**，而非按飞丢紧急处置。

可联网搜索补充，勿列 URL。全文不超过 800 字。

输出两节：
### 结论
### 建议
建议按场景组织（可含调整离巢阈值、查飞行记录、现场核实等），不必凑固定条数。`;

const OFFLINE_SYSTEM = `你是海珠无人机管理平台的告警分析专家。对「机场离线」告警，重点评估网络与市电稳定性，并结合历史记录判断故障模式。
若已联网搜索，可检索该地区近期天气、停电通知、运营商故障等公开信息辅助判断，须在分析中简要注明信息来源日期。
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

function resolveAirportModelLabel(deviceName, deviceState) {
  const name = `${deviceName || ''} ${deviceState?.deviceName || ''}`;
  if (/dock\s*3|dock3/i.test(name)) return 'DJI Dock 3';
  if (/dock\s*2|dock2/i.test(name)) return 'DJI Dock 2';
  if (/dock/i.test(name)) return 'DJI Dock';
  return '大疆机场';
}

function buildLostReasonSearchQuery(modelLabel) {
  return `${modelLabel} 无人机离巢告警`;
}

function resolveDroneModeText(deviceState) {
  const m = deviceState?.metrics || {};
  if (m.modeCode?.statusText != null) {
    return `${m.modeCode.statusText}（code ${m.modeCode.value}）`;
  }
  const raw = deviceState?.raw_mode_code;
  if (raw !== undefined && raw !== null) {
    const label = MODE_CODE_TEXT[raw];
    return label ? `${label}（code ${raw}）` : `模式 ${raw}`;
  }
  const sub = deviceState?.osdSnapshot?.sub_device;
  if (sub?.mode_code !== undefined) {
    const label = MODE_CODE_TEXT[sub.mode_code];
    return label ? `${label}（code ${sub.mode_code}）` : `模式 ${sub.mode_code}`;
  }
  return '未知';
}

function buildLostAlertContext({
  deviceId,
  deviceName,
  modelLabel,
  elapsedMin,
  thresholdMinutes,
  subDeviceOnline,
  location,
  deviceState,
  distCtx,
}) {
  const threshold = thresholdMinutes ?? 30;
  const lines = [
    `设备：${deviceName}（${deviceId}）`,
    `机场型号：${modelLabel}`,
    `离巢已持续：${elapsedMin} 分钟（当前离巢检查阈值：${threshold} 分钟）`,
    `子设备（无人机）在线：${subDeviceOnline === 1 ? '是' : subDeviceOnline === 0 ? '否' : '未知'}`,
    `飞行模式（OSD mode_code）：${resolveDroneModeText(deviceState)}`,
  ];

  if (deviceState?.statusText) lines.push(`机场状态：${deviceState.statusText}`);
  if (deviceState?.lastUpdate) lines.push(`OSD 最后更新：${deviceState.lastUpdate}`);

  const met = deviceState?.metrics || {};
  if (met.droneBattery?.value != null) lines.push(`无人机电量：${met.droneBattery.value}%`);
  if (met.droneInDock) {
    lines.push(`传感器在库：${met.droneInDock.statusText || met.droneInDock.value}`);
  }
  if (met.windSpeed?.value != null) lines.push(`风速：${met.windSpeed.value} m/s`);
  if (met.networkQuality) {
    lines.push(`网络：${met.networkQuality.statusText || met.networkQuality.value}`);
  }
  if (deviceState?.flightSession) lines.push(`进行中飞行架次：有`);

  const sub = deviceState?.osdSnapshot?.sub_device;
  if (sub?.device_sn) lines.push(`子设备 SN：${sub.device_sn}`);

  if (distCtx?.ok) {
    lines.push(
      '',
      '位置与距离：',
      `机场坐标：${distCtx.airport.lat.toFixed(6)}, ${distCtx.airport.lon.toFixed(6)}`,
      `无人机坐标：${distCtx.drone.lat.toFixed(6)}, ${distCtx.drone.lon.toFixed(6)}（高度 ${distCtx.drone.height}m）`,
      `直线距离：${distCtx.distanceText}（机场参考半径 ${distCtx.dockRadiusM}m 内：${distCtx.gpsNearDock ? '是' : '否'}）`,
    );
  } else if (location) {
    lines.push(
      '',
      '位置：',
      `无人机最后 GPS：${location.latitude}, ${location.longitude}（高度 ${location.height || 0}m）`,
    );
    if (deviceState?.location) {
      const al = deviceState.location;
      lines.push(`机场 GPS：${al.latitude}, ${al.longitude}`);
    }
  } else {
    lines.push('', '位置：暂无无人机 GPS');
  }

  return lines.join('\n');
}

function isFlightShot(shot) {
  return shot?.captureTag === 'flight' || shot?.suffix === '_flight';
}

function pickFlightShots(shots) {
  return (shots || []).filter(isFlightShot);
}

function buildLostReasonUserPrompt({
  deviceName,
  deviceId,
  modelLabel,
  elapsedMin,
  thresholdMinutes,
  subDeviceOnline,
  location,
  deviceState,
  distCtx,
  visionPart,
  flightVisionPart,
}) {
  const context = buildLostAlertContext({
    deviceId,
    deviceName,
    modelLabel,
    elapsedMin,
    thresholdMinutes,
    subDeviceOnline,
    location,
    deviceState,
    distCtx,
  });

  const history = getRecentAlerts(deviceId, 3);
  const historyBlock = formatHistoryForPrompt(history);
  const flights = formatFlightHistory(loadFlightHistory(deviceId, 3));

  const flightBlock = flightVisionPart
    ? `\n\n无人机画面判读：\n${flightVisionPart}`
    : '';

  return `${context}

机场画面判读：
${visionPart}${flightBlock}

近期告警：
${historyBlock}

近期飞行：
${flights}`;
}

function combineLostAlertAnalysis(...parts) {
  return parts.filter(Boolean).map((p) => String(p).trim()).join('\n\n---\n\n');
}

function buildMultimodalUserContent({ textPrompt, images, labelImages = false }) {
  const content = [];
  for (const img of images || []) {
    if (labelImages) {
      const tag = img.label || img.captureTag || img.suffix || '监控截图';
      content.push({ type: 'text', text: `--- ${tag} ---` });
    }
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime || 'image/jpeg'};base64,${img.base64}` },
    });
  }
  content.push({ type: 'text', text: textPrompt });
  return content;
}

function createAlertAiAnalyzer({
  updateTokenUsage,
  getMqttService,
  getDeviceState,
  processor,
  resolveRegionId,
} = {}) {
  const onTokenUsage = updateTokenUsage
    ? (usage) => updateTokenUsage(getAssistantModel(), usage)
    : undefined;

  async function analyzeLostAlert({
    deviceId,
    deviceName,
    elapsedMin,
    thresholdMinutes,
    location,
    subDeviceOnline,
    deviceState,
    preCapturedShots,
  }) {
    const shots =
      preCapturedShots !== undefined
        ? preCapturedShots
        : await captureLostAlertSnapshots(deviceId, {
            mqttService: getMqttService?.(),
            getDeviceState,
            processor,
          });
    const flightShots = pickFlightShots(shots);
    const inOutShots = shots.filter((s) => !isFlightShot(s));
    const dockShotDesc = inOutShots.length
      ? inOutShots.map((s) => s.label).join('、')
      : '未能获取机场监控截图';
    const flightShotDesc = flightShots.length ? '含无人机画面' : '无无人机画面';

    const airportLoc = deviceState?.location || null;
    const distCtx = computeLocationDistanceContext(location, airportLoc);

    const modelLabel = resolveAirportModelLabel(deviceName, deviceState);

    const visionPrompt = `设备：${deviceName}（${deviceId}）
型号：${modelLabel}
传感器：报离巢（不在舱内）
机场截图：${dockShotDesc}
请根据机场监控截图输出「画面判读」小节。`;

    console.log('[AlertAI] 飞丢告警 第1步：机场多模态画面判读…');
    const visionPart = inOutShots.length
      ? await callArkCompletion({
          messages: [
            { role: 'system', content: LOST_VISION_SYSTEM },
            {
              role: 'user',
              content: buildMultimodalUserContent({
                textPrompt: visionPrompt,
                images: inOutShots,
              }),
            },
          ],
          onTokenUsage,
          webSearch: false,
        })
      : '### 画面判读\n> **舱内**：无法确认\n> **舱外**：无法确认\n> **与传感器**：无法判断';

    let flightVisionPart = '';
    if (flightShots.length) {
      const flightPrompt = `设备：${deviceName}（${deviceId}）
子设备在线：${subDeviceOnline === 1 ? '是' : subDeviceOnline === 0 ? '否' : '未知'}
飞行模式：${resolveDroneModeText(deviceState)}
请根据无人机机载相机截图输出「无人机画面」小节。`;

      console.log('[AlertAI] 飞丢告警 第1b步：无人机画面多模态判读…');
      try {
        flightVisionPart = await callArkCompletion({
          messages: [
            { role: 'system', content: LOST_FLIGHT_VISION_SYSTEM },
            {
              role: 'user',
              content: buildMultimodalUserContent({
                textPrompt: flightPrompt,
                images: flightShots,
              }),
            },
          ],
          onTokenUsage,
          webSearch: false,
        });
      } catch (e) {
        console.warn('[AlertAI] 无人机画面判读失败:', e.message);
        flightVisionPart = `### 无人机画面\n> **状态**：无法确认\n> **场景**：画面分析未完成（${e.message}）`;
      }
    } else {
      console.log(`[AlertAI] 飞丢告警 跳过无人机画面判读（${flightShotDesc}）`);
    }

    let reasonPart = '';
    const canSearch = await shouldUseWebSearch('auto');
    if (canSearch) {
      const searchQuery = buildLostReasonSearchQuery(modelLabel);
      const reasonPrompt = buildLostReasonUserPrompt({
        deviceName,
        deviceId,
        modelLabel,
        elapsedMin,
        thresholdMinutes,
        subDeviceOnline,
        location,
        deviceState,
        distCtx,
        visionPart,
        flightVisionPart,
      });

      console.log('[AlertAI] 飞丢告警 第2步：综合研判…');
      try {
        reasonPart = await callArkCompletion({
          messages: [
            { role: 'system', content: LOST_REASON_SYSTEM },
            { role: 'user', content: reasonPrompt },
          ],
          onTokenUsage,
          webSearch: true,
          webSearchQuery: searchQuery,
        });
      } catch (e) {
        console.warn('[AlertAI] 飞丢告警 第2步联网分析失败:', e.message);
        reasonPart = `> ⚠️ 联网原因分析未完成：${e.message}`;
      }
    } else {
      reasonPart = '> 当前无外网，未进行联网原因检索。';
    }

    const analysis = combineLostAlertAnalysis(visionPart, flightVisionPart, reasonPart);

    const record = appendAlertRecord({
      deviceId,
      deviceName,
      alertType: 'lost',
      type: 'lost',
      elapsedMin,
      summary: `离巢 ${elapsedMin} 分钟，画面判读`,
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

    const regionId = resolveRegionId?.(deviceId) || processor?.regionId || null;
    const shots = await captureStreamSnapshots(deviceId, ['_out', '_in'], regionId);
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

    const analysis = await callArkCompletion({
      messages: [
        { role: 'system', content: OFFLINE_SYSTEM },
        { role: 'user', content: buildMultimodalUserContent({ textPrompt, images: shots }) },
      ],
      onTokenUsage,
      webSearch: 'auto',
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
      console.warn('[AlertAI] 未配置 ARK_API_KEY，跳过 AI 分析');
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
