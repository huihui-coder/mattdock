/** Dock OSD 分片合并 + 白名单裁剪（防止 live_status 等大字段常驻内存） */

const OSD_SCALAR_KEYS = new Set([
  'wind_speed',
  'humidity',
  'temperature',
  'environment_temperature',
  'rainfall',
  'mode_code',
  'drone_in_dock',
  'cover_state',
  'emergency_stop_state',
  'silent_mode',
  'battery_store_mode',
  'putter_state',
  'home_position_is_valid',
  'first_power_on',
  'supplement_light_state',
  'latitude',
  'longitude',
  'height',
  'attitude_head',
  'battery',
  'electric_supply_voltage',
  'working_voltage',
  'working_current',
]);

const OSD_NESTED_KEYS = new Set([
  'sub_device',
  'network_state',
  'storage',
  'position_state',
  'drone_charge_state',
  'air_conditioner',
  'alternate_land_point',
]);

const OSD_TOP_LEVEL_KEYS = new Set([...OSD_SCALAR_KEYS, ...OSD_NESTED_KEYS]);

const SUB_DEVICE_KEYS = new Set([
  'device_sn',
  'device_model_key',
  'device_online_status',
  'device_paired',
  'mode_code',
  'total_flight_distance',
  'total_flight_time',
]);

function pruneSubDevice(sub) {
  if (!sub || typeof sub !== 'object') return sub;
  const out = {};
  for (const key of SUB_DEVICE_KEYS) {
    if (sub[key] !== undefined) out[key] = sub[key];
  }
  return out;
}

function mergeNestedObject(prev = {}, incoming = {}) {
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
      next[key] = mergeNestedObject(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** 合并后裁剪，丢弃 live_status 等未白名单字段 */
function pruneOsdSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const out = {};
  for (const key of OSD_TOP_LEVEL_KEYS) {
    if (snapshot[key] === undefined) continue;
    out[key] = key === 'sub_device'
      ? pruneSubDevice(snapshot[key])
      : snapshot[key];
  }
  return out;
}

function mergeOsdSnapshot(prev = {}, incoming = {}) {
  if (!incoming || typeof incoming !== 'object') return pruneOsdSnapshot(prev);
  const next = { ...prev };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (!OSD_TOP_LEVEL_KEYS.has(key)) continue;
    if (key === 'sub_device') {
      next[key] = pruneSubDevice(mergeNestedObject(next[key] || {}, value));
    } else if (OSD_NESTED_KEYS.has(key)) {
      next[key] = mergeNestedObject(next[key] || {}, value);
    } else {
      next[key] = value;
    }
  }
  return pruneOsdSnapshot(next);
}

module.exports = {
  mergeOsdSnapshot,
  pruneOsdSnapshot,
};
