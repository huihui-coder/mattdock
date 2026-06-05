const fs = require('fs');
const path = require('path');
const { getRegionDir, DEFAULT_REGION_ID } = require('./region-store');

function getConnectivityPath(regionId) {
  return path.join(getRegionDir(regionId), 'connectivity.json');
}

function getDefaultMqttConfig() {
  const protocolVersion = Number(process.env.MQTT_PROTOCOL_VERSION || 5);
  return {
    brokerUrl: (process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883').trim(),
    username: (process.env.MQTT_USERNAME || '').trim(),
    password: (process.env.MQTT_PASSWORD || '').trim(),
    clientId: (process.env.MQTT_CLIENT_ID || 'airport_monitor_').trim(),
    topics: (
      process.env.MQTT_TOPICS
      || 'thing/product/+/osd,thing/product/+/state,thing/product/+/events'
    ).trim(),
    protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : 5,
  };
}

/** 区域文件中的空字符串不应覆盖 .env 默认值 */
function mergeMqttConfig(fileMqtt) {
  const defaults = getDefaultMqttConfig();
  if (!fileMqtt || typeof fileMqtt !== 'object') return { ...defaults };
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(fileMqtt)) {
    if (value === undefined || value === null) continue;
    if (key === 'protocolVersion') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 3 && n <= 5) merged.protocolVersion = n;
      continue;
    }
    const str = String(value).trim();
    if (str !== '') merged[key] = str;
  }
  return merged;
}

function getDefaultStreamConfig() {
  return {
    baseUrl: (process.env.STREAM_BASE_URL || 'https://www.hzdkjw.com:1443/live').replace(/\/$/, ''),
    token: (process.env.STREAM_TOKEN || '').trim(),
  };
}

function readRegionConnectivityFile(regionId) {
  const file = getConnectivityPath(regionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn(`[Region] 读取 connectivity.json 失败 (${regionId}):`, e.message);
    return null;
  }
}

function hasRegionConnectivity(regionId) {
  return fs.existsSync(getConnectivityPath(regionId));
}

function resolveConnectivity(regionId) {
  const file = readRegionConnectivityFile(regionId);
  const mqtt = mergeMqttConfig(file?.mqtt);
  const stream = { ...getDefaultStreamConfig(), ...(file?.stream || {}) };
  if (file?.stream?.baseUrl) stream.baseUrl = String(file.stream.baseUrl).replace(/\/$/, '');
  if (file?.stream?.token) stream.token = String(file.stream.token).trim();
  return { mqtt, stream, hasFile: !!file };
}

function buildStreamUrl(regionId, deviceId, suffix = '_out') {
  const { stream } = resolveConnectivity(regionId);
  const base = String(stream.baseUrl || '').replace(/\/$/, '');
  const sn = String(deviceId || '').trim();
  const sfx = String(suffix || '_out');
  const url = `${base}/${sn}${sfx}.live.flv`;
  if (stream.token) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(stream.token)}`;
  }
  return url;
}

function writeRegionConnectivity(regionId, payload) {
  const mqtt = payload?.mqtt || {};
  const stream = payload?.stream || {};
  if (!mqtt.brokerUrl && !stream.baseUrl) {
    throw new Error('至少填写 MQTT 地址或推流基址');
  }
  const file = getConnectivityPath(regionId);
  const existing = readRegionConnectivityFile(regionId) || {};
  const envDefaults = getDefaultMqttConfig();
  const passwordFromRequest = mqtt.password !== undefined && String(mqtt.password).trim()
    ? String(mqtt.password).trim()
    : null;
  let nextPassword = '';
  if (passwordFromRequest) {
    nextPassword = passwordFromRequest;
  } else if (existing.mqtt?.password && String(existing.mqtt.password).trim()) {
    nextPassword = String(existing.mqtt.password).trim();
  } else if (regionId === DEFAULT_REGION_ID && envDefaults.password) {
    nextPassword = envDefaults.password;
  }

  const next = {
    ...existing,
    mqtt: {
      ...(existing.mqtt || {}),
      brokerUrl: String(mqtt.brokerUrl || existing.mqtt?.brokerUrl || '').trim(),
      username: String(mqtt.username ?? existing.mqtt?.username ?? envDefaults.username ?? '').trim(),
      password: String(nextPassword || '').trim(),
      clientId: String(
        mqtt.clientId || existing.mqtt?.clientId || envDefaults.clientId || `monitor-${regionId}`,
      ).trim(),
      topics: String(
        mqtt.topics || existing.mqtt?.topics || envDefaults.topics,
      ).trim(),
      ...(mqtt.protocolVersion !== undefined && mqtt.protocolVersion !== ''
        ? { protocolVersion: Number(mqtt.protocolVersion) }
        : existing.mqtt?.protocolVersion !== undefined
          ? { protocolVersion: existing.mqtt.protocolVersion }
          : {}),
    },
    stream: {
      ...(existing.stream || {}),
      baseUrl: String(stream.baseUrl || existing.stream?.baseUrl || '').replace(/\/$/, ''),
      token: String(stream.token ?? existing.stream?.token ?? '').trim(),
    },
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(temp, file);
  return next;
}

function sanitizeConnectivityForApi(regionId) {
  const { mqtt, stream, hasFile } = resolveConnectivity(regionId);
  return {
    regionId,
    hasFile,
    usesEnvDefaults: regionId === DEFAULT_REGION_ID && !hasFile,
    mqtt: {
      brokerUrl: mqtt.brokerUrl || '',
      username: mqtt.username || '',
      passwordSet: !!mqtt.password,
      clientId: mqtt.clientId || '',
      topics: mqtt.topics || '',
      protocolVersion: mqtt.protocolVersion || 5,
    },
    stream: {
      baseUrl: stream.baseUrl || '',
      tokenSet: !!stream.token,
    },
  };
}

function listRegionsWithConnectivity(regions) {
  return (regions || []).map((r) => ({
    ...r,
    connectivity: sanitizeConnectivityForApi(r.id),
  }));
}

function shouldConnectRegion(regionId) {
  if (regionId === DEFAULT_REGION_ID) return true;
  return hasRegionConnectivity(regionId);
}

module.exports = {
  getConnectivityPath,
  getDefaultMqttConfig,
  getDefaultStreamConfig,
  readRegionConnectivityFile,
  hasRegionConnectivity,
  resolveConnectivity,
  buildStreamUrl,
  writeRegionConnectivity,
  sanitizeConnectivityForApi,
  listRegionsWithConnectivity,
  shouldConnectRegion,
};
