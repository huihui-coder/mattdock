const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '../../haizhuDB');
const REGIONS_FILE = path.join(DATA_ROOT, 'regions.json');
const REGIONS_DIR = path.join(DATA_ROOT, 'regions');
const LEGACY_REGISTRY = path.join(DATA_ROOT, 'device-registry.json');
const LEGACY_FLIGHT = path.join(DATA_ROOT, 'flight-history.json');
const LEGACY_ALERT = path.join(DATA_ROOT, 'alert-config.json');

const DEFAULT_REGION_ID = (process.env.DEFAULT_REGION_ID || 'haizhu').trim();

function slugifyRegionId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function readRegions() {
  try {
    if (!fs.existsSync(REGIONS_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(REGIONS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[Region] 读取 regions.json 失败:', e.message);
    return [];
  }
}

function writeRegions(list) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(REGIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function ensureDefaultRegion() {
  let regions = readRegions();
  if (!regions.length) {
    const rootId = (process.env.DEFAULT_ROOT_REGION_ID || 'gz-jhzd').trim();
    const rootName = process.env.DEFAULT_ROOT_REGION_NAME || '广州市警航支队';
    regions = [
      {
        id: rootId,
        name: rootName,
        parentId: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: DEFAULT_REGION_ID,
        name: process.env.DEFAULT_REGION_NAME || '海珠分局',
        parentId: rootId,
        createdAt: new Date().toISOString(),
      },
    ];
    writeRegions(regions);
  } else {
    regions = regions.map((r) => ({
      ...r,
      parentId: r.parentId ?? null,
    }));
    const needsParent = regions.filter((r) => r.parentId == null);
    if (needsParent.length > 1) {
      const rootId = (process.env.DEFAULT_ROOT_REGION_ID || 'gz-jhzd').trim();
      if (!regions.some((r) => r.id === rootId)) {
        regions.unshift({
          id: rootId,
          name: process.env.DEFAULT_ROOT_REGION_NAME || '广州市警航支队',
          parentId: null,
          createdAt: new Date().toISOString(),
        });
      }
      for (const r of regions) {
        if (r.id === rootId) continue;
        if (r.parentId == null && r.id !== rootId) {
          r.parentId = rootId;
        }
      }
      writeRegions(regions);
    }
  }
  for (const r of regions) {
    fs.mkdirSync(getRegionDir(r.id), { recursive: true });
  }
  return regions;
}

function getRegionDir(regionId) {
  return path.join(REGIONS_DIR, String(regionId));
}

function getRegionFile(regionId, filename) {
  return path.join(getRegionDir(regionId), filename);
}

function getRegionDeviceRegistryPath(regionId) {
  return getRegionFile(regionId, 'device-registry.json');
}

function getRegionFlightHistoryPath(regionId) {
  return getRegionFile(regionId, 'flight-history.json');
}

function getRegionAlertConfigPath(regionId) {
  return getRegionFile(regionId, 'alert-config.json');
}

function getRegionById(regionId) {
  return readRegions().find((r) => r.id === regionId) || null;
}

function createRegion({ id, name, parentId }) {
  const regionId = slugifyRegionId(id);
  if (!regionId) throw new Error('区域 ID 无效，请使用字母、数字、连字符');
  const regions = readRegions();
  if (regions.some((r) => r.id === regionId)) {
    throw new Error('区域 ID 已存在');
  }
  const parent = parentId ? String(parentId).trim() : null;
  if (parent && !regions.some((r) => r.id === parent)) {
    throw new Error('上级区域不存在');
  }
  const region = {
    id: regionId,
    name: String(name || regionId).trim(),
    parentId: parent,
    createdAt: new Date().toISOString(),
  };
  regions.push(region);
  writeRegions(regions);
  fs.mkdirSync(getRegionDir(regionId), { recursive: true });
  return region;
}

function updateRegion(regionId, { name, parentId } = {}) {
  const id = String(regionId || '').trim();
  if (!id) throw new Error('区域 ID 无效');
  const regions = readRegions();
  const idx = regions.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error('区域不存在');
  const patch = { ...regions[idx] };
  let changed = false;
  if (name !== undefined) {
    const nextName = String(name).trim();
    if (!nextName) throw new Error('区域名称不能为空');
    patch.name = nextName;
    changed = true;
  }
  if (parentId !== undefined) {
    patch.parentId = parentId ? String(parentId).trim() : null;
    changed = true;
  }
  if (!changed) throw new Error('没有可更新的字段');
  patch.updatedAt = new Date().toISOString();
  regions[idx] = patch;
  writeRegions(regions);
  return regions[idx];
}

function migrateLegacyFilesIfNeeded() {
  const regions = ensureDefaultRegion();
  const primary = regions.find((r) => r.id === DEFAULT_REGION_ID) || regions[0];
  if (!primary) return;

  const pairs = [
    [LEGACY_REGISTRY, getRegionDeviceRegistryPath(primary.id)],
    [LEGACY_FLIGHT, getRegionFlightHistoryPath(primary.id)],
    [LEGACY_ALERT, getRegionAlertConfigPath(primary.id)],
  ];
  for (const [legacy, target] of pairs) {
    if (fs.existsSync(legacy) && !fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(legacy, target);
      console.log(`[Region] 已迁移 ${path.basename(legacy)} → regions/${primary.id}/`);
    }
  }
}

module.exports = {
  DATA_ROOT,
  DEFAULT_REGION_ID,
  readRegions,
  writeRegions,
  ensureDefaultRegion,
  migrateLegacyFilesIfNeeded,
  getRegionDir,
  getRegionFile,
  getRegionDeviceRegistryPath,
  getRegionFlightHistoryPath,
  getRegionAlertConfigPath,
  getRegionById,
  createRegion,
  updateRegion,
  slugifyRegionId,
};
