/**
 * Dock OSD 分片合并与状态解析
 *
 * 舱内/舱外（camera_position）说明：
 * - DJI live_camera_change 用 camera_position：0=舱内，1=舱外
 * - 内外相机 camera_index 均为 165-0-7，live_status 无 camera_position 字段
 * - 只能从显式上报字段 + 控制指令回写 + 持久化记录识别
 */

const { getLiveCameraPosition } = require('./dock-live-state-store');

function mergeOsdSnapshot(prev = {}, incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return { ...prev };
  const next = { ...prev };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === 'object' &&
      !Array.isArray(next[key])
    ) {
      next[key] = mergeOsdSnapshot(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function readSupplementLightState(osd) {
  if (!osd || osd.supplement_light_state === undefined || osd.supplement_light_state === null) {
    return null;
  }
  return Number(osd.supplement_light_state) === 1 ? 1 : 0;
}

function normalizeCameraPosition(value) {
  if (value === 0 || value === 1) return value;
  const n = Number(value);
  if (n === 0 || n === 1) return n;
  return null;
}

function readCameraPositionFromLiveStatus(liveStatus, gatewaySn) {
  if (!liveStatus) return null;
  const list = Array.isArray(liveStatus) ? liveStatus : [liveStatus];

  const outVideoSuffix = `/${gatewaySn}/165-0-7/`;
  const active = list.filter((item) => item && item.status === 1);
  const candidates = active.length ? active : list;

  for (const item of candidates) {
    const pos = normalizeCameraPosition(item.camera_position ?? item.fpv_position ?? item.live_camera_position);
    if (pos !== null) return pos;

    const videoId = item.video_id;
    if (typeof videoId === 'string' && videoId.includes(outVideoSuffix)) {
      const nested = normalizeCameraPosition(item.camera_position);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/**
 * 从 OSD 读取舱内(0)/舱外(1)
 * 不使用 camera_index 推断（内外均为 165-0-7）
 */
function resolveLiveCameraPosition(osd, gatewaySn, fallback = null) {
  if (!osd || typeof osd !== 'object') return fallback;

  const direct =
    normalizeCameraPosition(osd.camera_position) ??
    normalizeCameraPosition(osd.live_camera_position) ??
    normalizeCameraPosition(osd.fpv_position);
  if (direct !== null) return direct;

  const fromLiveStatus = readCameraPositionFromLiveStatus(osd.live_status, gatewaySn);
  if (fromLiveStatus !== null) return fromLiveStatus;

  const persisted = getLiveCameraPosition(gatewaySn);
  if (persisted !== null) return persisted;

  return fallback;
}

function buildDockTelemetry(osd, gatewaySn, prevTelemetry = {}) {
  const supplementOn = readSupplementLightState(osd);
  const cameraPosition = resolveLiveCameraPosition(
    osd,
    gatewaySn,
    prevTelemetry.liveCameraPosition ?? null,
  );

  return {
    supplementLightState:
      supplementOn === null ? prevTelemetry.supplementLightState ?? null : supplementOn,
    liveCameraPosition: cameraPosition,
  };
}

module.exports = {
  mergeOsdSnapshot,
  readSupplementLightState,
  resolveLiveCameraPosition,
  buildDockTelemetry,
};
