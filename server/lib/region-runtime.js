const {
  DEFAULT_REGION_ID,
  ensureDefaultRegion,
  migrateLegacyFilesIfNeeded,
  readRegions,
  createRegion,
  getRegionById,
  slugifyRegionId,
} = require('./region-store');
const {
  buildRegionTree,
  getVisibleRegionIds,
  validateParentAssignment,
} = require('./region-tree');
const DeviceProcessor = require('../device-processor');

class RegionRuntime {
  constructor(thresholdConfig = {}) {
    this.thresholdConfig = thresholdConfig;
    this.processors = new Map();
    this.deviceToRegion = new Map();
    this.defaultRegionId = DEFAULT_REGION_ID;
  }

  init() {
    migrateLegacyFilesIfNeeded();
    const regions = ensureDefaultRegion();
    this.processors.clear();
    for (const region of regions) {
      const processor = new DeviceProcessor(this.thresholdConfig, {
        regionId: region.id,
        regionName: region.name || region.id,
      });
      this.processors.set(region.id, processor);
    }
    this.rebuildDeviceIndex();
    console.log(`[Region] 已加载 ${this.processors.size} 个区域处理器，默认区域: ${this.defaultRegionId}`);
  }

  reloadRegion(regionId) {
    const meta = getRegionById(regionId);
    const processor = new DeviceProcessor(this.thresholdConfig, {
      regionId,
      regionName: meta?.name || regionId,
    });
    this.processors.set(regionId, processor);
    this.rebuildDeviceIndex();
    return processor;
  }

  listRegions() {
    return readRegions();
  }

  addRegion(payload) {
    const regions = readRegions();
    const regionId = slugifyRegionId(payload?.id);
    validateParentAssignment(regionId, payload?.parentId, regions);
    const region = createRegion(payload);
    this.reloadRegion(region.id);
    return region;
  }

  getVisibleRegionIdsForUser(user) {
    const regions = readRegions();
    const regionId = user?.regionId || this.defaultRegionId;
    return getVisibleRegionIds(regionId, regions);
  }

  getScopeForUser(user) {
    const regions = readRegions();
    const regionId = user?.regionId || this.defaultRegionId;
    const visibleRegionIds = getVisibleRegionIds(regionId, regions);
    const processors = visibleRegionIds
      .map((id) => {
        const proc = this.getProcessor(id);
        const meta = regions.find((r) => r.id === id);
        return proc ? { regionId: id, regionName: meta?.name || id, processor: proc } : null;
      })
      .filter(Boolean);
    const primary = this.getProcessor(regionId) || processors[0]?.processor || null;
    return {
      regionId,
      visibleRegionIds,
      processors,
      primaryProcessor: primary,
    };
  }

  getProcessor(regionId) {
    if (!regionId) return this.processors.get(this.defaultRegionId) || null;
    return this.processors.get(regionId) || null;
  }

  getProcessorForUser(user) {
    const regionId = user?.regionId || this.defaultRegionId;
    return this.getProcessor(regionId);
  }

  getDefaultProcessor() {
    return this.getProcessor(this.defaultRegionId);
  }

  _leafRegionIds(regions = readRegions()) {
    return regions.filter((r) => !regions.some((c) => c.parentId === r.id)).map((r) => r.id);
  }

  _processorIterationOrder() {
    const regions = readRegions();
    const leafIdSet = new Set(this._leafRegionIds(regions));
    return [...this.processors.entries()].sort((a, b) => {
      const aLeaf = leafIdSet.has(a[0]) ? 0 : 1;
      const bLeaf = leafIdSet.has(b[0]) ? 0 : 1;
      return aLeaf - bLeaf || String(a[0]).localeCompare(String(b[0]));
    });
  }

  _deviceOwnedByLeafRegistry(deviceId, regionId) {
    const proc = this.getProcessor(regionId);
    if (!proc?.registryOverrides?.[deviceId]) return false;
    return true;
  }

  resolveRegionIdForDevice(deviceId) {
    const id = String(deviceId || '');
    if (!id) return this.defaultRegionId;

    const leafIds = this._leafRegionIds();
    for (const regionId of leafIds) {
      if (this._deviceOwnedByLeafRegistry(id, regionId)) {
        this.deviceToRegion.set(id, regionId);
        return regionId;
      }
    }

    if (this.deviceToRegion.has(id)) return this.deviceToRegion.get(id);

    for (const regionId of leafIds) {
      const processor = this.getProcessor(regionId);
      if (processor?.isDeviceInRegion(id)) {
        this.deviceToRegion.set(id, regionId);
        return regionId;
      }
    }

    for (const [regionId, processor] of this.processors.entries()) {
      if (processor.isDeviceInRegion(id)) {
        this.deviceToRegion.set(id, regionId);
        return regionId;
      }
    }
    return this.defaultRegionId;
  }

  getProcessorForDevice(deviceId) {
    const regionId = this.resolveRegionIdForDevice(deviceId);
    return this.getProcessor(regionId) || this.getDefaultProcessor();
  }

  processMqttMessage(topic, data, sourceRegionId) {
    const processor = sourceRegionId
      ? this.getProcessor(sourceRegionId)
      : this.getProcessorForDevice(this.extractDeviceId(topic, data));
    if (!processor) return null;
    return processor.process(topic, data);
  }

  extractDeviceId(topic, data) {
    const parts = String(topic || '').split('/');
    if (parts[2]) return parts[2];
    return data?.gateway || data?.data?.gateway || data?.device_sn || null;
  }

  rebuildDeviceIndex() {
    this.deviceToRegion.clear();
    for (const [regionId, processor] of this._processorIterationOrder()) {
      for (const deviceId of processor.collectKnownDeviceIds()) {
        if (!this.deviceToRegion.has(deviceId)) {
          this.deviceToRegion.set(deviceId, regionId);
        }
      }
    }
  }

  freezeOnlineToRegion(regionId) {
    const processor = this.getProcessor(regionId);
    if (!processor) throw new Error('区域不存在');
    const payload = processor.freezeOnlineSnapshot();
    this.reloadRegion(regionId);
    this.rebuildDeviceIndex();
    return {
      regionId,
      mappingCount: Object.keys(payload.mappings || {}).length,
      bindingCount: Object.keys(payload.bindings || {}).length,
      remoteBindingCount: Object.keys(payload.remoteBindings || {}).length,
      frozenAt: payload.meta?.frozenAt,
    };
  }

  getDeviceState(deviceId) {
    return this.getProcessorForDevice(deviceId)?.getDeviceState(deviceId) || null;
  }

  findDeviceInScope(deviceId, visibleProcessors) {
    for (const { regionId, regionName, processor } of visibleProcessors) {
      const state = processor.getDeviceState(deviceId);
      if (state) return { ...state, regionId, regionName };
    }
    return null;
  }

  collectDevicesFromScope(visibleProcessors, regions) {
    const procs = regions
      ? getLeafProcessorsInScope(visibleProcessors, regions)
      : visibleProcessors;
    const list = [];
    for (const { regionId, regionName, processor } of procs) {
      for (const d of processor.getAllDeviceStates()) {
        if (!processor.isDeviceInRegion(d.deviceId)) continue;
        list.push({ ...d, regionId, regionName });
      }
    }
    return list;
  }

  collectFlightHistoryFromScope(visibleProcessors, regions) {
    const procs = regions
      ? getLeafProcessorsInScope(visibleProcessors, regions)
      : visibleProcessors;
    const merged = [];
    for (const { regionId, regionName, processor } of procs) {
      processor.syncFlightHistoryFromDisk();
      for (const row of processor.flightHistory) {
        const deviceId = row?.deviceId;
        if (deviceId && !processor.isDeviceInRegion(deviceId)) continue;
        merged.push({ ...processor.enrichFlightRecord(row), regionId, regionName });
      }
    }
    return merged;
  }

  buildActiveSessionsFromScope(type, visibleProcessors, regions) {
    const procs = regions
      ? getLeafProcessorsInScope(visibleProcessors, regions)
      : visibleProcessors;
    const sessions = [];
    for (const { regionId, regionName, processor } of procs) {
      for (const s of processor.activeSessions.values()) {
        if (s?.deviceId && !processor.isDeviceInRegion(s.deviceId)) continue;
        const enriched = processor.enrichFlightRecord(s);
        sessions.push({
          ...enriched,
          regionId,
          regionName,
          totalDuration: processor.calcFlightDuration(s),
          totalMileage: parseFloat((s.mileage || 0).toFixed(2)),
          status: 'active',
        });
      }
      for (const [deviceId, state] of processor.deviceStates.entries()) {
        if (!processor.isDeviceInRegion(deviceId)) continue;
        if (sessions.find((x) => x.deviceId === deviceId && x.regionId === regionId)) continue;
        const flightType = processor.resolveFlightDeviceType(deviceId, state.gateway);
        if (!['drone', 'single', 'virtual'].includes(flightType)) continue;
        if (!processor.isFlightMode(state.raw_mode_code)) continue;
        sessions.push({
          id: `${deviceId}_${new Date(state.lastSeen || Date.now()).getTime()}`,
          deviceId,
          deviceName: processor.getFlightDisplayName(deviceId, state.gateway) || deviceId,
          deviceType: flightType,
          regionId,
          regionName,
          startTime: new Date(state.lastSeen || Date.now()).toISOString(),
          totalDuration: 0,
          totalMileage: 0,
          currentTotalFlightDistance: state.raw_total_flight_distance ?? null,
          status: 'active',
        });
      }
    }
    if (type && type !== 'all') {
      return sessions.filter((s) => (type === 'airport' ? s.deviceType === 'drone' : s.deviceType === type));
    }
    return sessions;
  }

  getRegionTree() {
    return buildRegionTree(readRegions());
  }
}

function getLeafProcessorsInScope(visibleProcessors, regions) {
  const visibleIds = new Set(visibleProcessors.map((p) => p.regionId));
  const leaves = visibleProcessors.filter(({ regionId }) => !regions.some(
    (r) => r.parentId === regionId && visibleIds.has(r.id),
  ));
  return leaves.length ? leaves : visibleProcessors;
}

function isRegisteredDevice(processor, deviceId) {
  const id = String(deviceId || '');
  if (!id) return false;
  if (processor.registryOverrides[id]) return true;
  if (processor.registryBindings[id]) return true;
  if (Object.values(processor.registryBindings).includes(id)) return true;
  if (processor.registryRemoteBindings[id]) return true;
  if (Object.values(processor.registryRemoteBindings).includes(id)) return true;
  return false;
}

function collectScopedDeviceIds(visibleProcessors, regions, { registryOnly = false } = {}) {
  const procs = getLeafProcessorsInScope(visibleProcessors, regions);
  const ids = new Set();
  for (const { processor: proc } of procs) {
    if (!registryOnly) {
      proc.getAllDeviceStates().forEach((d) => {
        if (proc.isDeviceInRegion(d.deviceId)) ids.add(d.deviceId);
      });
    }
    proc.collectKnownDeviceIds().forEach((id) => {
      if (!proc.isDeviceInRegion(id)) return;
      if (registryOnly && !isRegisteredDevice(proc, id)) return;
      ids.add(id);
    });
  }
  return { ids, procs };
}

function collectAlertConfigDeviceIds(visibleProcessors, regions) {
  return collectScopedDeviceIds(visibleProcessors, regions, { registryOnly: true });
}

function resolveRegionIdInScope(deviceId, visibleProcessors, regions) {
  for (const { regionId, processor } of getLeafProcessorsInScope(visibleProcessors, regions)) {
    if (processor.isDeviceInRegion(deviceId)) return regionId;
  }
  return null;
}

module.exports = {
  RegionRuntime,
  getLeafProcessorsInScope,
  collectScopedDeviceIds,
  collectAlertConfigDeviceIds,
  resolveRegionIdInScope,
};
