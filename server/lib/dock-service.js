const NON_DOCK_TYPES = new Set(['drone', 'single', 'remote', 'airport_drone']);

function readDeviceId(device) {
  return String(device?.deviceId || '').trim();
}

function readDeviceType(device) {
  return String(device?.deviceType || '').toLowerCase();
}

/** NEST 前缀为换电系列机场 */
function isNestSeriesAirport(device) {
  const id = readDeviceId(device);
  if (!id.startsWith('NEST')) return false;
  const type = readDeviceType(device);
  return !type || type === 'airport';
}

/** Dock 系列机场：凡非 NEST 开头的 gateway SN（不按 deviceType 卡死） */
function isDockSeriesAirport(device) {
  const id = readDeviceId(device);
  if (!id || id.startsWith('NEST')) return false;
  const type = readDeviceType(device);
  if (NON_DOCK_TYPES.has(type)) return false;
  return true;
}

/** Dock 系列：舱内/舱外共用 _out 推流，切换需 MQTT live_camera_change */
function isDockSharedOutAirport(device) {
  return isDockSeriesAirport(device);
}

const METHOD_SUPPLEMENT_LIGHT_OPEN = 'supplement_light_open';
const METHOD_SUPPLEMENT_LIGHT_CLOSE = 'supplement_light_close';

const SUPPLEMENT_LIGHT_ACTIONS = {
  open: METHOD_SUPPLEMENT_LIGHT_OPEN,
  close: METHOD_SUPPLEMENT_LIGHT_CLOSE,
};

const SUPPLEMENT_LIGHT_SOURCE_LABELS = {
  manual: '手动(UI)',
  lost_alert: '飞丢告警-内部接口',
  lost_alert_snap: '飞丢告警-截图流程',
  osd_telemetry: '设备OSD上报',
  control_patch: '控制状态同步',
};

function isSupplementLightMethod(method) {
  return method === METHOD_SUPPLEMENT_LIGHT_OPEN || method === METHOD_SUPPLEMENT_LIGHT_CLOSE;
}

function supplementLightActionFromMethod(method) {
  if (method === METHOD_SUPPLEMENT_LIGHT_OPEN) return 'open';
  if (method === METHOD_SUPPLEMENT_LIGHT_CLOSE) return 'close';
  return null;
}

function supplementLightStateLabel(state) {
  if (state === 1) return '开启';
  if (state === 0) return '关闭';
  return String(state);
}

/**
 * 补光灯开/关统一日志（pm2/console），便于排查自动或手动触发
 * @param {'open'|'close'} action
 * @param {string} source manual | lost_alert | lost_alert_snap | osd_telemetry | control_patch
 */
function logSupplementLightControl(deviceId, action, source, extra = {}) {
  const verb = action === 'open' ? '打开' : '关闭';
  const src = SUPPLEMENT_LIGHT_SOURCE_LABELS[source] || source || '未知';
  const parts = [`[补光灯] ${deviceId}`, verb, `来源=${src}`];
  if (extra.operator) parts.push(`操作人=${extra.operator}`);
  if (extra.regionId) parts.push(`region=${extra.regionId}`);
  if (extra.method) parts.push(`method=${extra.method}`);
  if (extra.prevState != null && extra.nextState != null) {
    parts.push(`状态=${supplementLightStateLabel(extra.prevState)}→${supplementLightStateLabel(extra.nextState)}`);
  } else if (extra.nextState != null) {
    parts.push(`目标=${supplementLightStateLabel(extra.nextState)}`);
  }
  if (extra.note) parts.push(String(extra.note));
  console.log(parts.join(' '));
}

module.exports = {
  isNestSeriesAirport,
  isDockSeriesAirport,
  isDockSharedOutAirport,
  METHOD_SUPPLEMENT_LIGHT_OPEN,
  METHOD_SUPPLEMENT_LIGHT_CLOSE,
  SUPPLEMENT_LIGHT_ACTIONS,
  isSupplementLightMethod,
  supplementLightActionFromMethod,
  logSupplementLightControl,
};
