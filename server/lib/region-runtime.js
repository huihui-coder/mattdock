const {
  DEFAULT_REGION_ID,
  ensureDefaultRegion,
  migrateLegacyFilesIfNeeded,
  readRegions,
  createRegion,
  getRegionById,
  slugifyRegionId,
} = require('./region-store');
const { resolveConnectivity, getMqttConnectionKey } = require('./region-connectivity');
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

  updateRegionMeta(regionId, payload) {
    const { updateRegion } = require('./region-store');
    const regions = readRegions();
    if (payload.parentId !== undefined) {
      validateParentAssignment(regionId, payload.parentId, regions);
    }
    const region = updateRegion(regionId, payload);
    if (this.processors.has(region.id)) {
      const proc = this.processors.get(region.id);
      if (proc && payload.name !== undefined) proc.regionName = region.name;
    } else if (payload.name !== undefined) {
      this.reloadRegion(region.id);
    }
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
    if (this.processors.has(regionId)) return this.processors.get(regionId);
    // regions.json 手改或导入后未重启时，按需加载处理器
    if (getRegionById(regionId)) return this.reloadRegion(regionId);
    return null;
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
    if (!proc) return false;
    const id = String(deviceId || '');
    if (isRegisteredDevice(proc, id)) return true;
    return !!(proc.deviceNames?.[id] && proc.deviceNames[id] !== id);
  }

  isRegisteredInLeafRegion(deviceId, regionId) {
    return this._deviceOwnedByLeafRegistry(deviceId, regionId);
  }

  isRegisteredInAnyLeafRegion(deviceId) {
    const id = String(deviceId || '');
    if (!id) return false;
    return this._leafRegionIds().some((regionId) => this.isRegisteredInLeafRegion(id, regionId));
  }

  /** 未映射设备统一落入默认区域处理器，避免多 MQTT 连接重复入库 */
  getUnmappedSinkRegionId() {
    return this.defaultRegionId;
  }

  /** 多区域共用 MQTT 配置池时，按 mqttProfileId 匹配连接，避免重复入库 */
  shouldProcessOnRegionConnection(deviceId, connectionRegionId) {
    const id = String(deviceId || '');
    if (!id || !connectionRegionId) return true;

    for (const regionId of this._leafRegionIds()) {
      if (this.isRegisteredInLeafRegion(id, regionId)) {
        const deviceKey = getMqttConnectionKey(regionId);
        return deviceKey === connectionRegionId || regionId === connectionRegionId;
      }
    }
    // 未映射：各连接均可接收，统一写入 sink 处理器（见 processMqttMessage）
    return true;
  }

  resolveDeviceRegionForBroadcast(deviceId, connectionRegionId) {
    const id = String(deviceId || '');
    if (id && connectionRegionId && this.isRegisteredInLeafRegion(id, connectionRegionId)) {
      const proc = this.getProcessor(connectionRegionId);
      return {
        regionId: connectionRegionId,
        regionName: proc?.regionName || connectionRegionId,
      };
    }
    for (const regionId of this._leafRegionIds()) {
      if (this.isRegisteredInLeafRegion(id, regionId)) {
        const proc = this.getProcessor(regionId);
        return { regionId, regionName: proc?.regionName || regionId };
      }
    }
    return { regionId: null, regionName: null };
  }

  resolveRegionIdForDevice(deviceId) {
    const id = String(deviceId || '');
    if (!id) return null;

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

    return null;
  }

  getProcessorForDevice(deviceId) {
    const regionId = this.resolveRegionIdForDevice(deviceId);
    if (regionId) return this.getProcessor(regionId);
    for (const [, proc] of this.processors) {
      if (proc.getDeviceState(deviceId)) return proc;
    }
    return this.getDefaultProcessor();
  }

  _flightUnmappedMeta(connectionRegionId) {
    const conn = resolveConnectivity(connectionRegionId);
    const mqttProfileId = conn.mqttProfileId || `__region__:${connectionRegionId}`;
    const mqttProfileName = conn.mqttProfileName || connectionRegionId;
    return {
      regionId: null,
      regionName: null,
      unmapped: true,
      mqttConnectionRegionId: connectionRegionId,
      mqttProfileId,
      mqttProfileName,
      mqttSourceRegionId: mqttProfileId,
      mqttSourceRegionName: mqttProfileName,
      mqttBroker: conn.mqtt?.brokerUrl || null,
    };
  }

  _enrichUnmappedDevice(state, fallbackRegionId) {
    const connectionKey = state.mqttConnectionRegionId || fallbackRegionId;
    return {
      ...state,
      ...this._flightUnmappedMeta(connectionKey),
    };
  }

  collectUnmappedDevicesFromScope(visibleProcessors) {
    const list = [];
    const seen = new Set();
    for (const { regionId, processor } of visibleProcessors) {
      for (const d of processor.getAllDeviceStates()) {
        if (this.isRegisteredInAnyLeafRegion(d.deviceId)) continue;
        const enriched = this._enrichUnmappedDevice(d, regionId);
        const key = `${enriched.deviceId}@${enriched.mqttProfileId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(enriched);
      }
    }
    return list;
  }

  processMqttMessage(topic, data, sourceRegionId) {
    const deviceId = this.extractDeviceId(topic, data);
    if (!deviceId) return null;

    const registered = this.isRegisteredInAnyLeafRegion(deviceId);
    let processor = registered
      ? this.getProcessorForDevice(deviceId)
      : this.getDefaultProcessor();
    if (!processor && sourceRegionId && this.getProcessor(sourceRegionId)) {
      processor = this.getProcessor(sourceRegionId);
    }
    if (!processor) return null;

    const result = processor.process(topic, data);
    if (result && !registered && sourceRegionId) {
      processor.patchDeviceMqttSource(deviceId, sourceRegionId);
    }
    return result;
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

  findDeviceInScope(deviceId, visibleProcessors, { unmappedOnly = false, mqttSourceRegionId = null } = {}) {
    const id = String(deviceId || '');
    if (unmappedOnly) {
      if (this.isRegisteredInAnyLeafRegion(id)) return null;
      for (const { regionId, processor } of visibleProcessors) {
        const state = processor.getDeviceState(deviceId);
        if (!state) continue;
        const enriched = this._enrichUnmappedDevice(state, regionId);
        if (mqttSourceRegionId && enriched.mqttProfileId !== mqttSourceRegionId) continue;
        return enriched;
      }
      return null;
    }
    for (const { regionId, regionName, processor } of visibleProcessors) {
      if (!this.isRegisteredInLeafRegion(id, regionId)) continue;
      const state = processor.getDeviceState(deviceId);
      if (state) return { ...state, regionId, regionName };
    }
    return null;
  }

  collectDevicesFromScope(visibleProcessors, regions, { unmappedOnly = false } = {}) {
    const procs = regions
      ? getLeafProcessorsInScope(visibleProcessors, regions)
      : visibleProcessors;

    if (unmappedOnly) {
      return this.collectUnmappedDevicesFromScope(procs);
    }

    const list = [];
    const seen = new Set();

    for (const { regionId, regionName, processor } of procs) {
      for (const d of processor.getAllDeviceStates()) {
        const id = d.deviceId;
        if (seen.has(id)) continue;
        if (!this.isRegisteredInLeafRegion(id, regionId)) continue;
        seen.add(id);
        list.push({ ...d, regionId, regionName });
      }
    }

    return list;
  }

  collectFlightHistoryFromScope(visibleProcessors, regions, options = {}) {
    const { matchesFlightType, matchesFlightTime, parseFlightTimeRange } = require('./flight-query');
    const {
      type,
      startTime,
      endTime,
      forceSync,
      unmappedOnly = false,
      mqttProfileId = null,
    } = options;
    const { start, end } = parseFlightTimeRange(startTime, endTime);
    const procs = regions
      ? getLeafProcessorsInScope(visibleProcessors, regions)
      : visibleProcessors;
    const merged = [];
    const seen = unmappedOnly ? new Set() : null;
    for (const { regionId, regionName, processor } of procs) {
      processor.syncFlightHistoryFromDisk(!!forceSync);
      for (const row of processor.flightHistory) {
        const deviceId = row?.deviceId;
        if (deviceId) {
          if (unmappedOnly) {
            if (this.isRegisteredInAnyLeafRegion(deviceId)) continue;
          } else if (!processor.isDeviceInRegion(deviceId)) {
            continue;
          }
        }
        if ((startTime || endTime) && !matchesFlightTime(row, start, end)) continue;
        const enriched = processor.enrichFlightRecord(row);
        if (type && !matchesFlightType(enriched, type)) continue;
        if (unmappedOnly) {
          const item = { ...enriched, ...this._flightUnmappedMeta(regionId) };
          if (mqttProfileId && item.mqttProfileId !== mqttProfileId) continue;
          const key = `${item.id || item.deviceId}-${item.startTime}@${item.mqttProfileId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(item);
        } else {
          merged.push({ ...enriched, regionId, regionName });
        }
      }
    }
    return merged;
  }

  buildActiveSessionsFromScope(type, visibleProcessors, regions, options = {}) {
    const { unmappedOnly = false, mqttProfileId = null } = options;
    const procs = regions
      ? getLeafProcessorsInScope(visibleProcessors, regions)
      : visibleProcessors;
    const sessions = [];
    const seen = unmappedOnly ? new Set() : null;
    for (const { regionId, regionName, processor } of procs) {
      const meta = unmappedOnly
        ? this._flightUnmappedMeta(regionId)
        : { regionId, regionName };
      if (unmappedOnly && mqttProfileId && meta.mqttProfileId !== mqttProfileId) {
        continue;
      }
      for (const s of processor.activeSessions.values()) {
        if (s?.deviceId) {
          if (unmappedOnly) {
            if (this.isRegisteredInAnyLeafRegion(s.deviceId)) continue;
          } else if (!processor.isDeviceInRegion(s.deviceId)) {
            continue;
          }
        }
        const enriched = processor.enrichFlightRecord(s);
        const session = {
          ...enriched,
          ...meta,
          totalDuration: processor.calcFlightDuration(s),
          totalMileage: parseFloat((s.mileage || 0).toFixed(2)),
          status: 'active',
        };
        if (unmappedOnly) {
          const key = `${session.deviceId}@${session.mqttProfileId}`;
          if (seen.has(key)) continue;
          seen.add(key);
        }
        sessions.push(session);
      }
      for (const [deviceId, state] of processor.deviceStates.entries()) {
        if (unmappedOnly) {
          if (this.isRegisteredInAnyLeafRegion(deviceId)) continue;
        } else if (!processor.isDeviceInRegion(deviceId)) {
          continue;
        }
        const sessionKey = unmappedOnly
          ? `${deviceId}@${meta.mqttProfileId}`
          : `${deviceId}@${regionId}`;
        if (sessions.some((x) => (
          unmappedOnly
            ? `${x.deviceId}@${x.mqttProfileId}` === sessionKey
            : x.deviceId === deviceId && x.regionId === regionId
        ))) continue;
        const flightType = processor.resolveFlightDeviceType(deviceId, state.gateway);
        if (!['drone', 'single', 'virtual'].includes(flightType)) continue;
        if (!processor.isFlightMode(state.raw_mode_code)) continue;
        const session = {
          id: `${deviceId}_${new Date(state.lastSeen || Date.now()).getTime()}`,
          deviceId,
          deviceName: processor.getFlightDisplayName(deviceId, state.gateway) || deviceId,
          deviceType: flightType,
          ...meta,
          startTime: new Date(state.lastSeen || Date.now()).toISOString(),
          totalDuration: 0,
          totalMileage: 0,
          currentTotalFlightDistance: state.raw_total_flight_distance ?? null,
          status: 'active',
        };
        if (unmappedOnly) {
          if (seen.has(sessionKey)) continue;
          seen.add(sessionKey);
        }
        sessions.push(session);
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
  const id = String(deviceId || '');
  for (const { regionId, processor } of getLeafProcessorsInScope(visibleProcessors, regions)) {
    if (processor.isDeviceInRegion(id)) return regionId;
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
