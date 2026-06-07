const fs = require('fs');
const path = require('path');
const { readRegions, getRegionDir } = require('./region-store');

const DATA_ROOT = path.resolve(__dirname, '../../haizhuDB');
const PROFILES_FILE = path.join(DATA_ROOT, 'mqtt-profiles.json');

function readRegionBindingFile(regionId) {
  const file = path.join(getRegionDir(regionId), 'connectivity.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function slugifyProfileId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `mqtt-${Date.now()}`;
}

function readProfilesFile() {
  if (!fs.existsSync(PROFILES_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[MQTT Profiles] 读取失败:', e.message);
    return [];
  }
}

function writeProfilesFile(profiles) {
  fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
  const temp = `${PROFILES_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(profiles, null, 2), 'utf8');
  fs.renameSync(temp, PROFILES_FILE);
}

function sanitizeProfileForApi(profile, { usageCount = 0, connected = null } = {}) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name || profile.id,
    remark: profile.remark || '',
    mqtt: {
      brokerUrl: profile.mqtt?.brokerUrl || '',
      username: profile.mqtt?.username || '',
      passwordSet: !!profile.mqtt?.password,
      clientId: profile.mqtt?.clientId || '',
      topics: profile.mqtt?.topics || '',
      protocolVersion: profile.mqtt?.protocolVersion || 5,
    },
    stream: {
      baseUrl: profile.stream?.baseUrl || '',
      tokenSet: !!profile.stream?.token,
    },
    usageCount,
    connected,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
  };
}

function getProfileUsageMap() {
  const usage = {};
  for (const region of readRegions()) {
    const file = readRegionBindingFile(region.id);
    const profileId = file?.mqttProfileId;
    if (!profileId) continue;
    if (!usage[profileId]) usage[profileId] = [];
    usage[profileId].push({ id: region.id, name: region.name || region.id });
  }
  return usage;
}

function listProfilesForApi({ connectionStatusByProfileId = {} } = {}) {
  const profiles = readProfilesFile();
  const usageMap = getProfileUsageMap();
  return profiles.map((p) => sanitizeProfileForApi(p, {
    usageCount: usageMap[p.id]?.length || 0,
    connected: connectionStatusByProfileId[p.id] ?? null,
  }));
}

function getProfileById(id) {
  return readProfilesFile().find((p) => p.id === id) || null;
}

function createProfile(payload = {}) {
  const profiles = readProfilesFile();
  const id = slugifyProfileId(payload.id || payload.name);
  if (profiles.some((p) => p.id === id)) {
    throw new Error('MQTT 配置 ID 已存在');
  }
  const mqtt = payload.mqtt || {};
  if (!String(mqtt.brokerUrl || '').trim()) {
    throw new Error('请填写 MQTT 地址');
  }
  if (!String(mqtt.clientId || '').trim()) {
    throw new Error('请填写 Client ID');
  }
  const now = new Date().toISOString();
  const profile = {
    id,
    name: String(payload.name || id).trim(),
    remark: String(payload.remark || '').trim(),
    mqtt: {
      brokerUrl: String(mqtt.brokerUrl || '').trim(),
      username: String(mqtt.username || '').trim(),
      password: String(mqtt.password || '').trim(),
      clientId: String(mqtt.clientId || '').trim(),
      topics: String(
        mqtt.topics || 'thing/product/+/osd,thing/product/+/state,thing/product/+/events',
      ).trim(),
      protocolVersion: Number(mqtt.protocolVersion) >= 3 ? Number(mqtt.protocolVersion) : 5,
    },
    stream: {
      baseUrl: String(payload.stream?.baseUrl || '').replace(/\/$/, ''),
      token: String(payload.stream?.token || '').trim(),
    },
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  writeProfilesFile(profiles);
  return profile;
}

function updateProfile(id, payload = {}) {
  const profiles = readProfilesFile();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error('MQTT 配置不存在');
  const existing = profiles[idx];
  const mqtt = payload.mqtt || {};
  const passwordFromRequest = mqtt.password !== undefined && String(mqtt.password).trim()
    ? String(mqtt.password).trim()
    : null;
  const stream = payload.stream || {};
  const tokenFromRequest = stream.token !== undefined && String(stream.token).trim()
    ? String(stream.token).trim()
    : null;

  const next = {
    ...existing,
    name: payload.name !== undefined ? String(payload.name).trim() : existing.name,
    remark: payload.remark !== undefined ? String(payload.remark).trim() : existing.remark,
    mqtt: {
      ...existing.mqtt,
      brokerUrl: mqtt.brokerUrl !== undefined ? String(mqtt.brokerUrl).trim() : existing.mqtt?.brokerUrl,
      username: mqtt.username !== undefined ? String(mqtt.username).trim() : existing.mqtt?.username,
      password: passwordFromRequest || existing.mqtt?.password || '',
      clientId: mqtt.clientId !== undefined ? String(mqtt.clientId).trim() : existing.mqtt?.clientId,
      topics: mqtt.topics !== undefined ? String(mqtt.topics).trim() : existing.mqtt?.topics,
      protocolVersion: mqtt.protocolVersion !== undefined
        ? (Number(mqtt.protocolVersion) >= 3 ? Number(mqtt.protocolVersion) : 5)
        : existing.mqtt?.protocolVersion,
    },
    stream: {
      ...existing.stream,
      baseUrl: stream.baseUrl !== undefined
        ? String(stream.baseUrl).replace(/\/$/, '')
        : existing.stream?.baseUrl,
      token: tokenFromRequest || existing.stream?.token || '',
    },
    updatedAt: new Date().toISOString(),
  };
  profiles[idx] = next;
  writeProfilesFile(profiles);
  return next;
}

function deleteProfile(id) {
  const usage = getProfileUsageMap()[id] || [];
  if (usage.length) {
    throw new Error(`该配置仍被 ${usage.length} 个组织使用，请先解除绑定`);
  }
  const profiles = readProfilesFile().filter((p) => p.id !== id);
  if (profiles.length === readProfilesFile().length) throw new Error('MQTT 配置不存在');
  writeProfilesFile(profiles);
  return { id };
}

module.exports = {
  PROFILES_FILE,
  readProfilesFile,
  listProfilesForApi,
  getProfileById,
  getProfileUsageMap,
  createProfile,
  updateProfile,
  deleteProfile,
  sanitizeProfileForApi,
  slugifyProfileId,
};
