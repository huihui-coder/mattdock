const fs = require('fs');
const path = require('path');
const { readRegions, getRegionAlertConfigPath } = require('./region-store');

const DATA_ROOT = path.resolve(__dirname, '../../haizhuDB');
const PROFILES_FILE = path.join(DATA_ROOT, 'webhook-profiles.json');

const WEBHOOK_TYPES = ['wecom', 'feishu', 'dingtalk', 'custom'];

function slugifyProfileId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `webhook-${Date.now()}`;
}

function readProfilesFile() {
  if (!fs.existsSync(PROFILES_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Webhook Profiles] 读取失败:', e.message);
    return [];
  }
}

function writeProfilesFile(profiles) {
  fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
  const temp = `${PROFILES_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(profiles, null, 2), 'utf8');
  fs.renameSync(temp, PROFILES_FILE);
}

function readRegionAlertConfig(regionId) {
  const file = getRegionAlertConfigPath(regionId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function getProfileUsageMap() {
  const usage = {};
  const deviceCounts = {};

  for (const region of readRegions()) {
    const data = readRegionAlertConfig(region.id);
    if (!data) continue;

    const profileId = data.webhookProfileId;
    if (profileId) {
      if (!usage[profileId]) usage[profileId] = [];
      usage[profileId].push({ id: region.id, name: region.name || region.id, kind: 'region' });
    }

    for (const [deviceId, cfg] of Object.entries(data.deviceConfigs || {})) {
      const devProfileId = cfg?.webhookProfileId;
      if (!devProfileId) continue;
      if (!usage[devProfileId]) usage[devProfileId] = [];
      usage[devProfileId].push({
        id: deviceId,
        name: deviceId,
        kind: 'device',
        regionId: region.id,
      });
      deviceCounts[devProfileId] = (deviceCounts[devProfileId] || 0) + 1;
    }
  }

  return { usage, deviceCounts };
}

function sanitizeProfileForApi(profile, { usageCount = 0, boundRegions = [], boundDeviceCount = 0 } = {}) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name || profile.id,
    remark: profile.remark || '',
    type: profile.type || 'wecom',
    url: profile.url || '',
    enabled: profile.enabled !== false,
    lastTestAt: profile.lastTestAt || null,
    lastTestStatus: profile.lastTestStatus || null,
    lastTestMessage: profile.lastTestMessage || '',
    usageCount,
    boundRegions,
    boundDeviceCount,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
  };
}

function listProfilesForApi() {
  const profiles = readProfilesFile();
  const { usage, deviceCounts } = getProfileUsageMap();
  return profiles.map((p) => {
    const bound = (usage[p.id] || []).filter((u) => u.kind === 'region');
    return sanitizeProfileForApi(p, {
      usageCount: (usage[p.id] || []).length,
      boundRegions: bound,
      boundDeviceCount: deviceCounts[p.id] || 0,
    });
  });
}

function getProfileById(id) {
  return readProfilesFile().find((p) => p.id === id) || null;
}

function getProfileUrl(id) {
  const profile = getProfileById(id);
  if (!profile || profile.enabled === false) return '';
  return String(profile.url || '').trim();
}

function createProfile(payload = {}) {
  const profiles = readProfilesFile();
  const id = slugifyProfileId(payload.id || payload.name);
  if (profiles.some((p) => p.id === id)) {
    throw new Error('Webhook 配置 ID 已存在');
  }
  const url = String(payload.url || '').trim();
  if (!url) throw new Error('请填写 Webhook URL');
  const type = WEBHOOK_TYPES.includes(payload.type) ? payload.type : 'wecom';
  const now = new Date().toISOString();
  const profile = {
    id,
    name: String(payload.name || id).trim(),
    remark: String(payload.remark || '').trim(),
    type,
    url,
    enabled: payload.enabled !== false,
    lastTestAt: null,
    lastTestStatus: null,
    lastTestMessage: '',
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
  if (idx === -1) throw new Error('Webhook 配置不存在');
  const existing = profiles[idx];
  const next = {
    ...existing,
    name: payload.name !== undefined ? String(payload.name).trim() : existing.name,
    remark: payload.remark !== undefined ? String(payload.remark).trim() : existing.remark,
    type: payload.type !== undefined && WEBHOOK_TYPES.includes(payload.type)
      ? payload.type
      : existing.type,
    url: payload.url !== undefined ? String(payload.url).trim() : existing.url,
    enabled: payload.enabled !== undefined ? !!payload.enabled : existing.enabled !== false,
    updatedAt: new Date().toISOString(),
  };
  if (!next.url) throw new Error('请填写 Webhook URL');
  profiles[idx] = next;
  writeProfilesFile(profiles);
  return next;
}

function recordProfileTest(id, { ok, message = '' } = {}) {
  const profiles = readProfilesFile();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error('Webhook 配置不存在');
  profiles[idx] = {
    ...profiles[idx],
    lastTestAt: new Date().toISOString(),
    lastTestStatus: ok ? 'success' : 'failed',
    lastTestMessage: String(message || '').slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
  writeProfilesFile(profiles);
  return profiles[idx];
}

function deleteProfile(id) {
  const { usage } = getProfileUsageMap();
  const refs = usage[id] || [];
  if (refs.length) {
    throw new Error(`该 Webhook 仍被 ${refs.length} 处引用，请先解除绑定`);
  }
  const profiles = readProfilesFile().filter((p) => p.id !== id);
  if (profiles.length === readProfilesFile().length) throw new Error('Webhook 配置不存在');
  writeProfilesFile(profiles);
  return { id };
}

module.exports = {
  PROFILES_FILE,
  WEBHOOK_TYPES,
  readProfilesFile,
  listProfilesForApi,
  getProfileById,
  getProfileUrl,
  getProfileUsageMap,
  createProfile,
  updateProfile,
  recordProfileTest,
  deleteProfile,
  sanitizeProfileForApi,
  slugifyProfileId,
};
