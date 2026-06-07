const fs = require('fs');
const path = require('path');
const { mergeOsdSnapshot, buildDockTelemetry } = require('./lib/dock-osd');
const { getLiveCameraPosition, setLiveCameraPosition } = require('./lib/dock-live-state-store');

const { getRegionDeviceRegistryPath, getRegionFlightHistoryPath } = require('./lib/region-store');
const { isValidCompletedFlight, MAX_FLIGHT_MILEAGE_M } = require('./lib/flight-query');

const DEVICE_CATEGORY_LABELS = {
  airport: '自动机场',
  single: '单兵无人机',
  airport_drone: '机库无人机',
  remote: '遥控器',
  unknown: '未分类',
};

/** DJI mode_code 飞行器状态（enum_int 官方枚举） */
const MODE_CODE_TEXT = {
  0: '待机',
  1: '起飞准备',
  2: '起飞准备完毕',
  3: '手动飞行',
  4: '自动起飞',
  5: '航线飞行',
  6: '全景拍照',
  7: '智能跟随',
  8: 'ADS-B 躲避',
  9: '自动返航',
  10: '自动降落',
  11: '强制降落',
  12: '三桨叶降落',
  13: '升级中',
  14: '未连接',
  15: 'APAS',
  16: '虚拟摇杆状态',
  17: '指令飞行',
  18: '空中 RTK 收敛模式',
  19: '机场选址中',
};

// 飞行态：3–12、15–19；非飞行态：0–2、13、14
const FLIGHT_MODES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19]);
const NON_FLIGHT_MODES = new Set([0, 1, 2, 13, 14]);
const FLIGHT_STALE_TIMEOUT_MS = 90 * 1000;

/** 机场 SN -> 绑定无人机 SN（与 DJI 司空平台一致） */
const BUILTIN_AIRPORT_BINDINGS = {
  AHRXN9600A00R6: '1581F9F4X25AF00A00X0',
  '8UUXP3B00A10VD': '1581F9F4X25AF00A00TN',
  '7CTDM1200B453R': '1581F6Q8D242S00C9DS2',
  NEST44202512U014: '1581F9HEC259S00CVJW1',
  AHRXNAH00A01C6: '1581F9F4X25AF00A00TB',
  AHRXNAH00A01CE: '1581F9F4X25AF00A00ZZ',
  'NEST15202602U001-2': '1581F9HEC259S00CKTBC',
  AHRXNAH00A01DM: '1581F9F4X25AF00A0146',
  AHRXNAH00A019D: '1581F9F4X25AF00A00SW',
  AHRXNAH00A018Z: '1581F9F4X25AF00A00ZQ',
  NEST20202412U002: '1581F5FJD239G00D0JNT',
  AHRXNAH00A01DF: '1581F9F4X258L00A00R5',
  'NEST15202602U001-1': '1581F9HEC258T00CSGJJ',
  AHRXNAH00A019F: '1581F9F4X25AF00A011W',
  NEST44202602U002: '1581F9HEC258V00CGDVG',
  AHRXNAH00A0192: '1581F9F4X25AF00A00ZG',
};

/** 遥控器 SN -> 绑定单兵无人机 SN */
const BUILTIN_REMOTE_BINDINGS = {
  '9N9CN960016LZZ': '1581F9HEC259S00CFP71',
};

function inferDockModel(airportSn, name = '') {
  const n = String(name);
  if (n.includes('Dock3') || String(airportSn).startsWith('AHRX')) return 'DJI Dock3';
  if (n.includes('Dock2') || String(airportSn).startsWith('7CTD')) return 'DJI Dock2';
  if (String(airportSn).startsWith('NEST4420')) return 'XNest 4Plus';
  if (String(airportSn).startsWith('NEST1520')) return 'XNest 4DPlus';
  if (String(airportSn).startsWith('NEST2020')) return 'XNest 3E';
  return '自动机场';
}

function inferDroneModel(name = '', sn = '') {
  const n = String(name);
  if (n.includes('M3TD') || n.includes('M3T')) return 'Matrice 3TD';
  if (n.includes('M4TD')) return 'Matrice 4TD';
  if (n.includes('M4T')) return 'Matrice 4T';
  if (n.includes('M400')) return 'Matrice 400';
  if (String(sn).startsWith('1581F5')) return 'Mavic 3T';
  return '无人机';
}

function resolveOperationalLink(mode, session) {
  const modeNum = mode !== undefined && mode !== null ? Number(mode) : undefined;
  const modeLabel =
    modeNum !== undefined && !Number.isNaN(modeNum) && MODE_CODE_TEXT[modeNum] != null
      ? MODE_CODE_TEXT[modeNum]
      : null;

  if (session != null || (modeNum !== undefined && !Number.isNaN(modeNum) && FLIGHT_MODES.has(modeNum))) {
    return {
      value: 'flying',
      status: 'normal',
      statusText: modeLabel || '飞行中',
    };
  }
  if (modeNum === 14) {
    return { value: 'disconnected', status: 'warning', statusText: MODE_CODE_TEXT[14] };
  }
  if (modeLabel) {
    return { value: 'ground', status: 'normal', statusText: modeLabel };
  }
  return null;
}

/**
 * 设备数据处理模块
 * 解析JSON数据并判断设备状态
 */

class DeviceProcessor {
  constructor(customThresholds = {}, options = {}) {
    this.regionId = options.regionId || 'default';
    this.regionName = options.regionName || this.regionId;
    this.historyFile = options.historyFile || getRegionFlightHistoryPath(this.regionId);
    this.registryFile = options.registryFile || getRegionDeviceRegistryPath(this.regionId);
    this.registryFrozen = false;
    
    // 运行时飞行会话缓存 (deviceId -> sessionData)
    this.activeSessions = new Map();
    this.staleFlightTimer = setInterval(() => this.closeStaleFlightSessions(), 30 * 1000);
    
    // 加载历史数据
    this.flightHistory = this.loadFlightHistory();

    // 设备状态阈值配置 - 默认值，可被外部配置覆盖
    this.thresholds = {
      temperature: {
        normal: { min: 15, max: 35 },
        warning: { min: 10, max: 40 },
        critical: { min: 0, max: 50 }
      },
      battery: {
        normal: { min: 50, max: 100 },
        warning: { min: 20, max: 50 },
        critical: { min: 0, max: 20 }
      },
      signal: {
        normal: { min: -50, max: 0 },
        warning: { min: -70, max: -50 },
        critical: { min: -100, max: -70 }
      },
      // 风速和湿度阈值从.env配置读取
      windSpeed: customThresholds.windSpeed || {
        normal: { min: 0, max: 6.6 },
        warning: { min: 6.6, max: 12 },
        critical: { min: 12, max: 999 }
      },
      humidity: customThresholds.humidity || {
        normal: { min: 30, max: 70 },
        warning: { min: 20, max: 80 },
        critical: { min: 0, max: 100 }
      }
    };

    // 设备状态缓存
    this.deviceStates = new Map();
    /** 单兵遥控器 SN -> 绑定无人机 SN（由 OSD gateway / sub_device 自动学习） */
    this.remoteDroneBindings = new Map();
    /** 用户自定义映射（device-registry.json，优先级最高） */
    this.registryOverrides = {};
    this.registryBindings = {};
    this.registryRemoteBindings = {};
    this.customRemoteBindingKeys = new Set();
    this.deviceCategoryOverrides = {};

    // 设备名称映射 - 海珠机场设备
    const builtinDeviceNames = {
      '8UUXP3B00A10VD': '南洲-Dock3-M4TD',
      '7CTDM1200B453R': '华洲-Dock2-M3TD',
      'NEST20202412U002': '江南中-充电-M3T',
      'NEST44202512U014': '区府-换电-M4T',
      'AHRXNAH00A01C6': '凤阳-Dock3-M4TD',
      'AHRXNAH00A01DF': '华洲-Dock3-M4TD',
      'AHRXNAH00A0192': '中大-Dock3-M4TD',
      'AHRXNAH00A01CE': '金碧二中-Dock3-M4TD',
      'NEST15202602U001-1': '会展-双机换电1号-M4T',
      'NEST15202602U001-2': '会展-双机换电2号-M4T',
      'AHRXNAH00A019F': '官洲-Dock3-M4TD',
      'AHRXNAH00A01DM': '新看守-Dock3-M4TD',
      'AHRXNAH00A019D': '三中-Dock3-M4TD',
      'NEST44202602U002': '艺术博物馆-换电-M4T',
      'AHRXNAH00A018Z': '分局-Dock3-M4TD',
      'AHRXN9600A00R6': '市局（凤阳）-Dock3-M4TD',
      '1581F9F4X25AF00A00X0': '市局（凤阳）-M4TD-无人机',
      '1581F9F4X25AF00A00TN': '南洲充电机场-M4TD无人机',
      '1581F6Q8D242S00C9DS2': '华洲充电机场-M3TD无人机',
      '1581F9HEC259S00CVJW1': '区府换电机场-M4T无人机',
      '1581F9F4X25AF00A00TB': '凤阳充电机场-M4TD无人机',
      '1581F9F4X25AF00A00ZZ': '金碧二中-无人机',
      '1581F9HEC259S00CKTBC': '会展双机2号-无人机',
      '1581F9F4X25AF00A0146': '新看守充电机场-M4TD无人机',
      '1581F9F4X25AF00A00SW': '三中充电机场-M4TD无人机',
      '1581F9F4X25AF00A00ZQ': '分局充电机场-M4TD无人机',
      '1581F5FJD239G00D0JNT': '江南中-充电-M3T-无人机',
      '1581F9F4X258L00A00R5': '华洲充电机场-M4TD无人机',
      '1581F9HEC258T00CSGJJ': '会展双机1号-无人机',
      '1581F9F4X25AF00A011W': '官洲充电机场-M4TD无人机',
      '1581F9HEC258V00CGDVG': '艺术博物馆换电机场-M4T无人机',
      '1581F9F4X25AF00A00ZG': '中大充电机场-M4TD无人机',
      '1581F9HEC259S00CFP71': '昌岗派出所-M4T',
      '1581F9HEC259S00CTR1C': '南华西派出所-M4T',
      '1581F9HEC259S00CSJ05': '南石头派出所-M4T',
      '1581F9HEC256P00CY9TF': '赤岗派出所-M4T',
      '1581F9HEC258T00CJD4W': '新港派出所-M4T',
      '1581FACGW25AN00A2LBY': '巡特警一中队-M400',
      '1581F9HEC258V00CNZ1P': '瑞宝派出所-M4T',
      '1581F9HEC259S00CR5UD': '江南中派出所-M4T',
      '1581F9HEC259S00CTEF7': '滨江派出所-M4T',
      '1581F9HEC259S00C06UH': '巡特警三中队-M4T',
      '1581F9HEC259S00C40C2': '巡特警一中队-M4T（2号机）',
      '1581F9HEC258V00CPP4S': '巡特警四中队-M4T',
      '1581F9HEC257L00CN4GU': '巡特警一中队-M4T（1号机）',
      '1581F9HEC259S00CHR5R': '官洲派出所-M4T',
      '1581F9HEC258V00C1HM1': '巡特警一中队-M4T（3号机）',
      '1581F9HEC259S00C4X0T': '素社派出所-M4T',
      '1581F9HEC258T00CGGFH': '沙园派出所-M4T',
      '1581F9HEC257L00CU2KT': '江海派出所-M4T',
      '1581F9HEC258V00CJ8FG': '龙凤派出所-M4T',
      '1581F9HEC259S00CJ7B2': '人口大队-M4T',
      '1581F9HEC258V00C1B83': '凤阳派出所-M4T',
      '1581F9HEC259S00C1ESG': '海幢派出所-M4T',
      '1581F9HEC258V00C1NPD': '巡特警二中队-M4T（1号机）',
      '1581F9HEC259S00C6YKP': '巡特警二中队—M4T（2号机）',
      '1581F9HEC259S00CLT1Q': '南洲派出所-M4T',
      '1581F9HEC258T00CG2H0': '华洲派出所-M4T',
      '1581F9HEC258V00CVX83': '琶洲派出所-M4T',
      '1581F9HEC259S00CLZ33': '禁毒支队-M4T',
      '9N9CN960016LZZ': '昌岗派出所-M4T-遥控器',
    };
    this.builtinDeviceNames = builtinDeviceNames;
    this.deviceNames = { ...builtinDeviceNames };

    // 从 process.env 动态合并 DEVICE_* 配置（优先级高于硬编码）
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('DEVICE_')) {
        const deviceId = key.slice(7);
        this.deviceNames[deviceId] = process.env[key];
      }
    });

    this.loadDeviceRegistryFromFile();
    this.applyDeviceRegistryOverrides();
    this.repairFlightHistory();
  }

  loadFlightHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (e) {
      console.error('[飞行统计] 加载历史失败:', e.message);
    }
    return [];
  }

  // 合并磁盘与内存中的飞行记录（磁盘优先，内存补充未落盘的新记录）
  mergeFlightHistoryWithDisk() {
    const diskData = this.loadFlightHistory();
    const diskIds = new Set(diskData.map(r => r.id));
    const merged = [...diskData];
    for (const r of this.flightHistory) {
      if (!diskIds.has(r.id)) merged.push(r);
    }
    if (merged.length > 1000) merged.splice(0, merged.length - 1000);
    this.flightHistory = merged;
    return merged;
  }

  // 查询接口调用：从磁盘同步最新记录到内存，避免进程内存落后于 flight-history.json
  syncFlightHistoryFromDisk(force = false) {
    const now = Date.now();
    let mtime = 0;
    try {
      if (fs.existsSync(this.historyFile)) {
        mtime = fs.statSync(this.historyFile).mtimeMs;
      }
    } catch {
      mtime = 0;
    }
    if (
      !force
      && this._flightSyncMtime === mtime
      && now - (this._flightSyncAt || 0) < 5000
    ) {
      return this.flightHistory;
    }
    this._flightSyncMtime = mtime;
    this._flightSyncAt = now;

    const before = this.flightHistory.length;
    const merged = this.mergeFlightHistoryWithDisk();
    if (merged.length !== before) {
      this.logFlight(`[飞行统计] 从磁盘同步: ${before} -> ${merged.length} 条记录`);
    }
    this.repairFlightHistory();
    return this.flightHistory;
  }

  loadDeviceRegistryFromFile() {
    try {
      if (!fs.existsSync(this.registryFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      this.registryFrozen = !!raw?.meta?.frozen;
      this.registryOverrides = raw?.mappings && typeof raw.mappings === 'object'
        ? { ...raw.mappings }
        : {};
      this.registryBindings = raw?.bindings && typeof raw.bindings === 'object'
        ? { ...raw.bindings }
        : {};
      this.registryRemoteBindings = raw?.remoteBindings && typeof raw.remoteBindings === 'object'
        ? { ...raw.remoteBindings }
        : {};
      this.customRemoteBindingKeys = new Set(
        Array.isArray(raw?.remoteBindingsCustom) ? raw.remoteBindingsCustom : []
      );
    } catch (e) {
      console.error('[设备管理] 加载映射文件失败:', e.message);
      this.registryOverrides = {};
      this.registryBindings = {};
      this.registryRemoteBindings = {};
      this.customRemoteBindingKeys = new Set();
    }
  }

  saveDeviceRegistryToFile() {
    try {
      let meta = {};
      if (fs.existsSync(this.registryFile)) {
        try {
          meta = JSON.parse(fs.readFileSync(this.registryFile, 'utf8'))?.meta || {};
        } catch {
          meta = {};
        }
      }
      if (this.registryFrozen) meta.frozen = true;
      fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
      const temp = this.registryFile + '.tmp';
      fs.writeFileSync(
        temp,
        JSON.stringify({
          meta,
          mappings: this.registryOverrides,
          bindings: this.registryBindings,
          remoteBindings: this.registryRemoteBindings,
          remoteBindingsCustom: [...this.customRemoteBindingKeys],
        }, null, 2)
      );
      fs.renameSync(temp, this.registryFile);
    } catch (e) {
      console.error('[设备管理] 保存映射文件失败:', e.message);
      throw e;
    }
  }

  applyDeviceRegistryOverrides() {
    this.deviceNames = this.registryFrozen ? {} : { ...this.builtinDeviceNames };
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('DEVICE_')) {
        this.deviceNames[key.slice(7)] = process.env[key];
      }
    });
    this.deviceCategoryOverrides = {};
    for (const [deviceId, entry] of Object.entries(this.registryOverrides)) {
      if (entry?.name) this.deviceNames[deviceId] = entry.name;
      if (entry?.category) this.deviceCategoryOverrides[deviceId] = entry.category;
    }
  }

  isAirportSn(deviceId) {
    const sn = String(deviceId || '');
    if (sn.startsWith('1581F') || sn.startsWith('9N9') || sn.startsWith('VIRTUAL')) return false;
    if (!this.registryFrozen && BUILTIN_AIRPORT_BINDINGS[sn]) return true;
    return !!this.registryBindings[sn]
      || (!this.registryFrozen && !!this.builtinDeviceNames[sn])
      || !!this.deviceNames[sn];
  }

  /** 合并内置 / 自定义 / 在线学习的机场绑定 */
  resolveAllAirportBindings() {
    const merged = this.registryFrozen ? {} : { ...BUILTIN_AIRPORT_BINDINGS };
    for (const [airportSn, droneSn] of Object.entries(this.registryBindings)) {
      if (droneSn) merged[airportSn] = droneSn;
    }
    for (const [airportSn, state] of this.deviceStates.entries()) {
      if (!this.isAirportSn(airportSn)) continue;
      const learned = state.boundDroneSn || state.metrics?.boundDrone?.sn;
      if (learned) merged[airportSn] = learned;
    }
    const result = {};
    for (const [airportSn, droneSn] of Object.entries(merged)) {
      let source = 'builtin';
      if (this.registryBindings[airportSn]) source = 'custom';
      else if (
        this.deviceStates.get(airportSn)?.boundDroneSn === droneSn
        && (!this.registryFrozen || this.registryBindings[airportSn])
        && BUILTIN_AIRPORT_BINDINGS[airportSn] !== droneSn
      ) {
        source = 'learned';
      }
      result[airportSn] = { droneSn, source };
    }
    return result;
  }

  getAirportBoundDroneSn(droneSn) {
    if (!droneSn) return null;
    for (const [airportSn, binding] of Object.entries(this.resolveAllAirportBindings())) {
      if (binding.droneSn === droneSn) return airportSn;
    }
    return null;
  }

  isAirportBoundDrone(deviceId) {
    return !!this.getAirportBoundDroneSn(deviceId);
  }

  isRemoteSn(deviceId) {
    return String(deviceId || '').startsWith('9N9');
  }

  /** 合并内置 / 自定义 / OSD 学习的遥控器绑定 */
  resolveAllRemoteBindings() {
    const merged = this.registryFrozen ? {} : { ...BUILTIN_REMOTE_BINDINGS };
    for (const [remoteSn, droneSn] of Object.entries(this.registryRemoteBindings)) {
      if (droneSn) merged[remoteSn] = droneSn;
    }
    for (const [remoteSn, droneSn] of this.remoteDroneBindings.entries()) {
      if (droneSn && this.isMappedSingleDrone(droneSn)) {
        merged[remoteSn] = droneSn;
      }
    }
    for (const [droneId, state] of this.deviceStates.entries()) {
      if (!this.isMappedSingleDrone(droneId)) continue;
      const gw = state.gateway;
      if (gw && this.isRemoteSn(gw)) merged[gw] = droneId;
    }
    const result = {};
    for (const [remoteSn, droneSn] of Object.entries(merged)) {
      let source = 'builtin';
      if (this.customRemoteBindingKeys.has(remoteSn)) source = 'custom';
      else if (this.registryRemoteBindings[remoteSn] && BUILTIN_REMOTE_BINDINGS[remoteSn] !== droneSn) {
        source = 'learned';
      } else if (
        this.remoteDroneBindings.get(remoteSn) === droneSn
        && !this.registryRemoteBindings[remoteSn]
        && BUILTIN_REMOTE_BINDINGS[remoteSn] !== droneSn
      ) {
        source = 'learned';
      }
      result[remoteSn] = { droneSn, source };
    }
    return result;
  }

  getRemoteBoundDroneSn(droneSn) {
    if (!droneSn) return null;
    for (const [remoteSn, binding] of Object.entries(this.resolveAllRemoteBindings())) {
      if (binding.droneSn === droneSn) return remoteSn;
    }
    return null;
  }

  /** OSD 学习到单兵-遥控器绑定后写入 device-registry.json */
  autoPersistRemoteBinding(remoteSn, droneSn) {
    if (!this.isRemoteSn(remoteSn) || !String(droneSn).startsWith('1581F')) return;
    if (this.inferDeviceCategory(droneSn) !== 'single') return;
    if (!this.registryFrozen && BUILTIN_REMOTE_BINDINGS[remoteSn] === droneSn) return;
    if (this.customRemoteBindingKeys.has(remoteSn)) return;
    if (this.registryRemoteBindings[remoteSn] === droneSn) return;
    this.registryRemoteBindings[remoteSn] = droneSn;
    try {
      this.saveDeviceRegistryToFile();
      console.log(`[设备管理] OSD 学习单兵绑定: ${remoteSn} -> ${droneSn}`);
    } catch (e) {
      console.warn('[设备管理] 保存单兵绑定失败:', e.message);
    }
  }

  inferDeviceCategory(deviceId) {
    if (this.deviceCategoryOverrides[deviceId]) return this.deviceCategoryOverrides[deviceId];
    if (this.isAirportBoundDrone(deviceId)) return 'airport_drone';
    if (String(deviceId).startsWith('9N9')) return 'remote';
    if (String(deviceId).startsWith('1581F')) {
      return this.deviceNames[deviceId] ? 'single' : 'airport_drone';
    }
    if (this.deviceNames[deviceId]) return 'airport';
    return 'unknown';
  }

  resolveDeviceNameSource(deviceId) {
    if (this.registryOverrides[deviceId]) return 'custom';
    const envKey = `DEVICE_${deviceId}`;
    if (process.env[envKey]) return 'env';
    if (!this.registryFrozen && this.builtinDeviceNames[deviceId]) return 'builtin';
    return 'unmapped';
  }

  /** 是否在 deviceNames 中单兵直映射（非机场机库无人机） */
  isMappedSingleDrone(deviceId) {
    return this.inferDeviceCategory(deviceId) === 'single';
  }

  /** 飞行统计用设备类型：airport 页=机库无人机(drone)，single 页=单兵 */
  resolveFlightDeviceType(deviceId, gateway = null) {
    if (String(deviceId).startsWith('VIRTUAL')) return 'virtual';
    if (this.isMappedSingleDrone(deviceId)) return 'single';
    if (String(deviceId).startsWith('1581F')) return 'drone';
    return 'airport';
  }

  /** 输出前修正历史记录的展示名与分类 */
  enrichFlightRecord(record) {
    if (!record?.deviceId) return record;
    const state = this.deviceStates.get(record.deviceId);
    const gateway = state?.gateway || null;
    const deviceType = this.resolveFlightDeviceType(record.deviceId, gateway);
    const deviceName = this.getFlightDisplayName(record.deviceId, gateway);
    const airportSn = this.getAirportBoundDroneSn(record.deviceId)
      || (gateway && this.isAirportSn(gateway) ? gateway : null);
    return {
      ...record,
      deviceType,
      deviceName,
      airportSn: airportSn || record.airportSn || null,
    };
  }

  /** 启动时修正已落盘记录的单兵误分类与 SN 展示名 */
  repairFlightHistory() {
    let changed = false;
    this.flightHistory = this.flightHistory.map((record) => {
      const next = this.enrichFlightRecord(record);
      if (
        next.deviceType !== record.deviceType ||
        next.deviceName !== record.deviceName
      ) {
        changed = true;
      }
      return next;
    });
    if (changed) {
      this.saveFlightHistory();
      this.logFlight('[飞行统计] 已修正历史记录中的单兵分类/设备名称');
    }
  }

  saveFlightHistory() {
    try {
      // 原子写入：先写临时文件再重命名
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      const tempFile = this.historyFile + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(this.flightHistory, null, 2));
      fs.renameSync(tempFile, this.historyFile);
      this.logFlight(`[飞行统计] 文件保存成功: ${this.flightHistory.length} 条记录`);
    } catch (e) {
      this.logFlight(`[飞行统计] 保存历史失败: ${e.message}`);
      console.error('[飞行统计] 保存历史异常:', e);
    }
  }

  // Haversine 公式计算两点间距离 (米)
  calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
    const R = 6371e3; // 地球半径
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  isFlightMode(modeCode) {
    return FLIGHT_MODES.has(modeCode);
  }

  normalizeFlightDisplayName(name) {
    return name ? name.replace(/-无人机$/, '') : name;
  }

  getTotalFlightDistance(payload) {
    const value = payload.total_flight_distance ?? payload.data?.total_flight_distance;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  getTotalFlightTime(payload) {
    const value = payload.total_flight_time ?? payload.data?.total_flight_time;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  calcFlightDuration(session, endTime = new Date()) {
    const endTft = session.lastTotalFlightTime;
    const startTft = session.startTotalFlightTime;
    if (endTft != null && startTft != null && startTft !== undefined) {
      return Math.max(0, Math.floor(endTft - startTft));
    }
    return Math.max(0, Math.floor((endTime.getTime() - new Date(session.startTime).getTime()) / 1000));
  }

  /** 用累计飞行里程差更新架次里程；异常跳变时重置基准 */
  updateSessionMileage(session, totalFlightDistance) {
    if (totalFlightDistance === null || totalFlightDistance === undefined) return;
    if (session.startTotalFlightDistance === null || session.startTotalFlightDistance === undefined) return;
    const delta = Math.max(0, totalFlightDistance - session.startTotalFlightDistance);
    if (delta > MAX_FLIGHT_MILEAGE_M) {
      session.startTotalFlightDistance = totalFlightDistance;
      session.mileage = 0;
      return;
    }
    session.mileage = delta;
  }

  logFlight(message) {
    console.log(`[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${message}`);
  }

  completeFlightSession(deviceId, session, endTime = new Date(), totalFlightDistance = null, totalFlightTime = null, reason = 'mode') {
    if (totalFlightDistance !== null) session.lastTotalFlightDistance = totalFlightDistance;
    if (totalFlightTime !== null) session.lastTotalFlightTime = totalFlightTime;
    const totalMileage = parseFloat(((session.lastTotalFlightDistance !== null && session.startTotalFlightDistance !== null && session.startTotalFlightDistance !== undefined)
      ? Math.max(0, session.lastTotalFlightDistance - session.startTotalFlightDistance)
      : session.mileage).toFixed(2));
    const finalRecord = {
      ...session,
      endTime: endTime.toISOString(),
      totalMileage,
      totalDuration: this.calcFlightDuration(session, endTime),
      status: 'completed'
    };
    if (isValidCompletedFlight(finalRecord)) {
      this.flightHistory.push(this.enrichFlightRecord(finalRecord));
      if (this.flightHistory.length > 1000) this.flightHistory.shift();
      this.saveFlightHistory();
      this.logFlight(`[飞行统计] 已写入历史记录 ${session.deviceName || deviceId} reason=${reason} mileage=${finalRecord.totalMileage}m duration=${finalRecord.totalDuration}s`);
    } else if (finalRecord.totalDuration > 5 || finalRecord.totalMileage > 2) {
      this.logFlight(`[飞行统计] 丢弃无效记录 ${session.deviceName || deviceId} reason=${reason} mileage=${finalRecord.totalMileage}m duration=${finalRecord.totalDuration}s (上限 ${MAX_FLIGHT_MILEAGE_M / 1000}km)`);
    }
    this.activeSessions.delete(deviceId);
    return finalRecord;
  }

  closeStaleFlightSessions() {
    const now = Date.now();
    for (const [deviceId, session] of this.activeSessions.entries()) {
      const lastUpdate = new Date(session.lastUpdateTime || session.startTime).getTime();
      if (now - lastUpdate <= FLIGHT_STALE_TIMEOUT_MS) continue;
      this.logFlight(`[飞行统计] <<< 设备 ${session.deviceName || deviceId} 超过${FLIGHT_STALE_TIMEOUT_MS / 1000}s无飞行数据，自动结束`);
      this.completeFlightSession(deviceId, session, new Date(lastUpdate), session.lastTotalFlightDistance ?? null, session.lastTotalFlightTime ?? null, 'stale-timeout');
      const state = this.deviceStates.get(deviceId);
      if (state) {
        state.flightSession = null;
        this.deviceStates.set(deviceId, state);
      }
    }
  }

  /**
   * 获取设备友好名称
   * @param {string} deviceId
   * @param {string|null} gateway  机场网关SN（无人机设备传入）
   */
  getDeviceName(deviceId, gateway = null) {
    // 优先直接映射
    if (this.deviceNames[deviceId]) return this.deviceNames[deviceId];
    // 无人机：用 gateway 对应的机场名拼接
    if (gateway && this.deviceNames[gateway]) {
      return `${this.deviceNames[gateway]}-无人机`;
    }
    return deviceId;
  }

  /** 飞行记录/排名展示名：机库无人机显示绑定机场名称 */
  getFlightDisplayName(deviceId, gateway = null) {
    const airportSn = this.getAirportBoundDroneSn(deviceId);
    if (airportSn) {
      return this.normalizeFlightDisplayName(this.getDeviceName(airportSn));
    }
    if (gateway && this.isAirportSn(gateway)) {
      return this.normalizeFlightDisplayName(this.getDeviceName(gateway));
    }
    return this.normalizeFlightDisplayName(this.getDeviceName(deviceId, gateway));
  }

  /** 从 OSD 载荷解析绑定的无人机 SN */
  extractBoundDroneSn(payload) {
    const sn =
      payload?.sub_device?.device_sn ||
      payload?.sub_devices?.[0]?.device_sn ||
      payload?.aircraft_sn ||
      payload?.drone_sn;
    return sn && String(sn).startsWith('1581F') ? String(sn) : null;
  }

  /** 单兵机上报的 gateway 为遥控器 SN 时记录绑定关系 */
  rememberSingleDroneRemoteLink(droneId, gateway) {
    if (!droneId?.startsWith('1581F') || !gateway || !String(gateway).startsWith('9N9')) return;
    const remoteId = String(gateway);
    this.remoteDroneBindings.set(remoteId, droneId);
    this.autoPersistRemoteBinding(remoteId, droneId);
  }

  /**
   * 解析单兵遥控器当前绑定的无人机
   */
  resolveBoundDroneForRemote(remoteId, payload, prevState) {
    const fromPayload = this.extractBoundDroneSn(payload);
    if (fromPayload) {
      this.remoteDroneBindings.set(remoteId, fromPayload);
      this.autoPersistRemoteBinding(remoteId, fromPayload);
      return fromPayload;
    }
    const cached = this.remoteDroneBindings.get(remoteId) || prevState?.boundDroneSn;
    if (cached) return cached;
    for (const [id, state] of this.deviceStates.entries()) {
      if (
        id.startsWith('1581F') &&
        state.gateway === remoteId &&
        ['drone', 'single', 'virtual'].includes(state.deviceType)
      ) {
        this.remoteDroneBindings.set(remoteId, id);
        return id;
      }
    }
    return null;
  }

  /** 绑定无人机的展示名（用于「xx-遥控器」） */
  getBoundDroneDisplayName(droneSn) {
    if (!droneSn) return null;
    if (this.deviceNames[droneSn]) return this.normalizeFlightDisplayName(this.deviceNames[droneSn]);
    const state = this.deviceStates.get(droneSn);
    if (state?.deviceName && state.deviceName !== droneSn) {
      return this.normalizeFlightDisplayName(state.deviceName);
    }
    return null;
  }

  nameRemoteFromBoundDrone(remoteId, droneSn) {
    const base = this.getBoundDroneDisplayName(droneSn);
    if (!base) return null;
    return `${base}-遥控器`;
  }

  regionMeta() {
    return { regionId: this.regionId, regionName: this.regionName };
  }

  /**
   * 处理设备数据
   * @param {string} topic - MQTT主题
   * @param {object} data - JSON数据
   * @returns {object} 处理后的数据
   */
  process(topic, data) {
    const deviceId = this.extractDeviceId(topic, data);
    const prevState = this.deviceStates.get(deviceId);
    const gateway = data.gateway || null;
    const result = {
      deviceId,
      deviceName: this.getDeviceName(deviceId, gateway),
      topic,
      gateway,
      timestamp: data.timestamp || null,
      status: 'unknown',
      statusText: '未知',
      metrics: {},
      location: null,
      alerts: [],
      lastUpdate: new Date().toISOString()
    };

    // 提取实际数据 (支持嵌套data字段和扁平结构)
    const payload = data.data || data;

    // 识别设备类型
    const isDrone = deviceId.startsWith('1581F');
    const isRemoteController = deviceId.startsWith('9N9');
    if (deviceId.startsWith('VIRTUAL')) {
      result.deviceType = 'virtual';
    } else if (isRemoteController) {
      result.deviceType = 'remote';
    } else if (isDrone) {
      result.deviceType = this.resolveFlightDeviceType(deviceId, gateway);
      this.rememberSingleDroneRemoteLink(deviceId, gateway);
    } else {
      result.deviceType = 'airport';
    }

    // ========== 飞行状态机统计逻辑 ==========
    const currentMode = payload.mode_code;
    const totalFlightDistance = this.getTotalFlightDistance(payload);
    const totalFlightTime = this.getTotalFlightTime(payload);
    // prevState 存的是 mergedResult，直接取 raw_mode_code
    const lastMode = prevState?.raw_mode_code;
    const prevFlightSession = prevState?.flightSession;
    let session = this.activeSessions.get(deviceId);
    if (!session && prevFlightSession) {
      session = prevFlightSession;
      this.activeSessions.set(deviceId, session);
    }

    const canTrackFlight = ['drone', 'single', 'virtual'].includes(result.deviceType);
    if (currentMode !== undefined && canTrackFlight) {
      const isCurrentlyFlying = FLIGHT_MODES.has(currentMode);
      const wasFlying = lastMode !== undefined && FLIGHT_MODES.has(lastMode);

      // 1. 架次开始判定：从非飞行态切换到飞行态
      if (isCurrentlyFlying && (!wasFlying || !session)) {
        this.logFlight(`[飞行统计] >>> 设备 ${result.deviceName || deviceId} 开始新架次，mode=${currentMode}`);
        session = {
          id: `${deviceId}_${Date.now()}`,
          deviceId,
          deviceName: this.getFlightDisplayName(deviceId, gateway) || deviceId,
          startTime: new Date().toISOString(),
          startLocation: result.location ? { ...result.location } : null,
          lastLocation: result.location ? { ...result.location } : null,
          startTotalFlightDistance: totalFlightDistance,
          lastTotalFlightDistance: totalFlightDistance,
          startTotalFlightTime: totalFlightTime,
          lastTotalFlightTime: totalFlightTime,
          lastUpdateTime: new Date().toISOString(),
          mileage: 0,
          duration: 0,
          deviceType: this.resolveFlightDeviceType(deviceId, gateway)
        };
        this.activeSessions.set(deviceId, session);
      } 
      // 2. 飞行中：累计里程和时间
      else if (isCurrentlyFlying && session) {
        session.lastUpdateTime = new Date().toISOString();
        if (totalFlightDistance !== null) session.lastTotalFlightDistance = totalFlightDistance;
        if (totalFlightTime !== null) session.lastTotalFlightTime = totalFlightTime;
        
        // 累积里程：使用当前累计飞行里程 - 起飞时累计飞行里程
        if (totalFlightDistance !== null && session.startTotalFlightDistance !== null && session.startTotalFlightDistance !== undefined) {
          this.updateSessionMileage(session, totalFlightDistance);
        }
        session.duration = this.calcFlightDuration(session);
      }
      // 3. 架次结束判定：切换回非飞行态
      else if (NON_FLIGHT_MODES.has(currentMode) && session) {
        this.logFlight(`[飞行统计] <<< 设备 ${result.deviceName || deviceId} 降落结束，保存记录，mode=${currentMode}`);
        this.completeFlightSession(deviceId, session, new Date(), totalFlightDistance, totalFlightTime, 'mode-non-flight');
        session = null;
      }
    }
    
    // 把当前的活跃 session 也放进 result 返回给前端实时显示
    result.activeSession = session;

    // 单兵遥控器：绑定无人机后命名为「xx派出所-M4T-遥控器」
    if (isRemoteController) {
      const linkedDroneSn = this.resolveBoundDroneForRemote(deviceId, payload, prevState);
      if (linkedDroneSn) {
        result.boundDroneSn = linkedDroneSn;
        const remoteName = this.nameRemoteFromBoundDrone(deviceId, linkedDroneSn);
        if (remoteName) result.deviceName = remoteName;
        result.metrics.boundDrone = {
          sn: linkedDroneSn,
          name: this.getBoundDroneDisplayName(linkedDroneSn) || linkedDroneSn,
          status: 'normal',
          statusText: '已绑定',
        };
      }
    }

    // 已配置映射名优先，避免 OSD 分片上报时展示名来回跳变
    if (this.deviceNames[deviceId]) {
      result.deviceName = this.deviceNames[deviceId];
    }

    // ========== 机场代理子设备飞行状态机 ==========
    // 机场OSD数据(deviceType=airport)中嵌套了无人机sub_device字段
    // canTrackFlight=false导致上方状态机跳过 -> 飞行记录永远不写入
    // 修复：sub_device含mode_code时，以子设备SN补跑一次状态机
    if (!canTrackFlight && payload.sub_device && payload.sub_device.device_sn && payload.sub_device.mode_code !== undefined) {
      const droneSn = payload.sub_device.device_sn;
      const droneMode = payload.sub_device.mode_code;
      const rawTfd = payload.sub_device.total_flight_distance;
      const droneTfd = rawTfd != null ? Number(rawTfd) : null;
      const rawTft = payload.sub_device.total_flight_time;
      const droneTft = rawTft != null ? Number(rawTft) : null;
      const droneName = this.getFlightDisplayName(droneSn, deviceId);
      const dronePrev = this.deviceStates.get(droneSn);
      const droneLastMode = dronePrev ? dronePrev.raw_mode_code : undefined;
      let droneSession = this.activeSessions.get(droneSn);
      if (!droneSession && dronePrev && dronePrev.flightSession) {
        droneSession = dronePrev.flightSession;
        this.activeSessions.set(droneSn, droneSession);
      }
      const droneIsFlying = FLIGHT_MODES.has(droneMode);
      const droneWasFlying = droneLastMode !== undefined && FLIGHT_MODES.has(droneLastMode);
      if (droneIsFlying && (!droneWasFlying || !droneSession)) {
        this.logFlight(`[飞行统计(子设备)] >>> ${droneName} 开始新架次 mode=${droneMode}`);
        droneSession = {
          id: `${droneSn}_${Date.now()}`,
          deviceId: droneSn,
          deviceName: droneName,
          startTime: new Date().toISOString(),
          startTotalFlightDistance: droneTfd,
          lastTotalFlightDistance: droneTfd,
          startTotalFlightTime: droneTft,
          lastTotalFlightTime: droneTft,
          lastUpdateTime: new Date().toISOString(),
          mileage: 0,
          duration: 0,
          deviceType: 'drone'
        };
        this.activeSessions.set(droneSn, droneSession);
      } else if (droneIsFlying && droneSession) {
        droneSession.lastUpdateTime = new Date().toISOString();
        if (droneTfd !== null) {
          droneSession.lastTotalFlightDistance = droneTfd;
          if (droneSession.startTotalFlightDistance !== null && droneSession.startTotalFlightDistance !== undefined) {
            this.updateSessionMileage(droneSession, droneTfd);
          }
        }
        if (droneTft !== null) droneSession.lastTotalFlightTime = droneTft;
        droneSession.duration = this.calcFlightDuration(droneSession);
      } else if (NON_FLIGHT_MODES.has(droneMode) && droneSession) {
        this.logFlight(`[飞行统计(子设备)] <<< ${droneName} 降落结束 mode=${droneMode}`);
        this.completeFlightSession(droneSn, droneSession, new Date(), droneTfd, droneTft, 'sub-mode-non-flight');
        droneSession = null;
      }
      const droneCache = dronePrev || {};
      this.deviceStates.set(droneSn, Object.assign({}, droneCache, {
        deviceId: droneSn,
        deviceName: droneName,
        deviceType: 'drone',
        raw_mode_code: droneMode,
        flightSession: droneSession || null,
        lastSeen: new Date()
      }));
    }

    // ========== 风速 (重点指标) ==========
    if (payload.wind_speed !== undefined) {
      // 无人机风速单位是0.1m/s，需要除以10；机场风速单位是1m/s
      let windSpeedValue = payload.wind_speed;
      if (isDrone) {
        windSpeedValue = windSpeedValue / 10;
      }
      // 保留一位小数
      windSpeedValue = Math.round(windSpeedValue * 10) / 10;
      result.metrics.windSpeed = this.evaluateMetric('windSpeed', windSpeedValue);
    }

    // ========== 环境温度 ==========
    if (payload.environment_temperature !== undefined) {
      result.metrics.environmentTemp = this.evaluateMetric('temperature', payload.environment_temperature);
    }

    // ========== 机库内部温湿度 ==========
    if (payload.temperature !== undefined) {
      result.metrics.temperature = this.evaluateMetric('temperature', payload.temperature);
    }
    if (payload.humidity !== undefined) {
      result.metrics.humidity = this.evaluateMetric('humidity', payload.humidity);
    }

    // ========== 无人机电量 ==========
    if (payload.drone_charge_state?.capacity_percent !== undefined) {
      result.metrics.droneBattery = this.evaluateMetric('battery', payload.drone_charge_state.capacity_percent);
    }

    // ========== 网络状态 ==========
    if (payload.network_state) {
      result.metrics.networkQuality = {
        value: payload.network_state.quality,
        status: payload.network_state.quality >= 3 ? 'normal' : 
                payload.network_state.quality >= 1 ? 'warning' : 'critical',
        statusText: payload.network_state.quality >= 3 ? '良好' : 
                    payload.network_state.quality >= 1 ? '一般' : '差',
        type: payload.network_state.type,
        rate: payload.network_state.rate
      };
    }

    // ========== 降雨量 ==========
    if (payload.rainfall !== undefined) {
      result.metrics.rainfall = {
        value: payload.rainfall,
        status: payload.rainfall === 0 ? 'normal' : 
                payload.rainfall <= 2 ? 'warning' : 'critical',
        statusText: payload.rainfall === 0 ? '无雨' : 
                    payload.rainfall <= 2 ? '小雨' : '大雨',
        unit: 'mm'
      };
    }

    // ========== 位置信息 ==========
    if (payload.latitude && payload.longitude) {
      result.location = {
        latitude: payload.latitude,
        longitude: payload.longitude,
        height: payload.height || 0,
        heading: payload.heading || 0
      };
    }

    // ========== 无人机在库状态 ==========
    if (payload.drone_in_dock !== undefined) {
      result.metrics.droneInDock = {
        value: payload.drone_in_dock,
        status: 'normal',
        statusText: payload.drone_in_dock === 1 ? '在库' : '出库'
      };
    }

    // ========== 子设备（无人机）在线状态 ==========
    if (payload.sub_device) {
      result.metrics.subDeviceOnline = {
        value: payload.sub_device.device_online_status,
        sn: payload.sub_device.device_sn,
        statusText: payload.sub_device.device_online_status === 1 ? '在线' : '离线'
      };
    }

    // ========== 电池槽检测 ==========
    if (payload.dock_batteries && Array.isArray(payload.dock_batteries)) {
      const batteries = payload.dock_batteries;
      const totalSlots = batteries.length;
      
      // 如果没有电池槽，跳过检测
      if (totalSlots === 0) {
        result.metrics.batterySlots = {
          value: '0/0',
          totalSlots: 0,
          filledSlots: 0,
          status: 'normal',
          statusText: '无电池槽'
        };
      } else {
        const filledSlots = batteries.filter(b => b.sn && b.sn.length > 0).length;
        
        // 判断是否正常：电池数量必须超过一半但不能全部填满
        // 正常：filledSlots > totalSlots/2 且 filledSlots < totalSlots
        // 不正常：filledSlots <= totalSlots/2 或 filledSlots === totalSlots
        const hasEnoughBatteries = filledSlots > totalSlots / 2;
        const notFull = filledSlots < totalSlots;
        const isNormal = hasEnoughBatteries && notFull;
        
        result.metrics.batterySlots = {
          value: `${filledSlots}/${totalSlots}`,
          totalSlots,
          filledSlots,
          status: isNormal ? 'normal' : 'warning',
          statusText: isNormal ? '机身有电池' : '机身无电池'
        };
        
        // 如果不正常，生成告警
        if (!isNormal) {
          if (filledSlots === totalSlots) {
            result.alerts.push({
              type: 'warning',
              level: 'warning',
              message: '机场机身无电池，请检查电池槽位',
              metric: 'batterySlots'
            });
          } else {
            result.alerts.push({
              type: 'warning',
              level: 'warning',
              message: '机场电池数量不足，请检查电池槽位',
              metric: 'batterySlots'
            });
          }
        }
      }
    }

    // ========== 模式代码 ==========
    if (payload.mode_code !== undefined) {
      result.metrics.modeCode = {
        value: payload.mode_code,
        status: 'normal',
        statusText: this.getModeText(payload.mode_code)
      };
    }

    // 单兵/绑定机：链路状态（按 mode_code 枚举）
    if (['drone', 'single', 'virtual'].includes(result.deviceType)) {
      const mode = currentMode !== undefined ? currentMode : prevState?.raw_mode_code;
      const operational = resolveOperationalLink(mode, session);
      if (operational) result.metrics.operational = operational;
    }

    // ========== 告警状态 ==========
    if (payload.alarm_state !== undefined && payload.alarm_state !== 0) {
      result.alerts.push({
        level: 'warning',
        code: 'ALARM_STATE',
        message: `设备告警状态码: ${payload.alarm_state}`
      });
    }

    // 处理顶层错误信息
    if (data.error || data.errorCode) {
      result.alerts.push({
        level: 'error',
        code: data.errorCode || 'UNKNOWN',
        message: data.error || data.errorMessage || '设备报告错误'
      });
    }

    // 如果当前消息没有电池槽数据，使用之前的数据（避免状态跳变）
    if (!result.metrics.batterySlots && prevState?.metrics?.batterySlots) {
      result.metrics.batterySlots = prevState.metrics.batterySlots;
    }

    // 计算整体状态
    result.status = this.calculateOverallStatus(result.metrics, prevState, {
      deviceType: result.deviceType,
      rawModeCode: currentMode !== undefined ? currentMode : prevState?.raw_mode_code,
      activeSession: session,
      boundDroneSn: result.boundDroneSn || prevState?.boundDroneSn,
    });
    result.statusText = this.getStatusText(result.status);

    if (['drone', 'single', 'virtual'].includes(result.deviceType)) {
      const op = result.metrics.operational;
      if (op) {
        result.status = op.status === 'warning' ? 'warning' : 'normal';
        result.statusText = op.statusText;
      }
    }

    // 生成告警 - 优先显示电池告警，然后是风速告警
    // 如果电池槽状态为警告，生成告警（即使当前消息没有电池槽数据）
    let batteryAlert = result.alerts.find(a => a.metric === 'batterySlots');
    if (!batteryAlert && result.metrics.batterySlots?.status === 'warning') {
      const filledSlots = result.metrics.batterySlots.filledSlots;
      const totalSlots = result.metrics.batterySlots.totalSlots;
      if (filledSlots === totalSlots) {
        batteryAlert = {
          type: 'warning',
          level: 'warning',
          message: '机场机身无电池，请检查电池槽位',
          metric: 'batterySlots'
        };
      } else {
        batteryAlert = {
          type: 'warning',
          level: 'warning',
          message: '机场电池数量不足，请检查电池槽位',
          metric: 'batterySlots'
        };
      }
    }
    const windAlert = this.generateWindAlert(deviceId, result.metrics);
    
    if (batteryAlert) {
      result.alerts = [batteryAlert];
    } else if (windAlert) {
      result.alerts = [windAlert];
    } else {
      result.alerts = [];
    }

    // 合并状态
    let osdSnapshot = prevState?.osdSnapshot || {};
    let supplementLightState = prevState?.supplementLightState ?? null;
    let liveCameraPosition = prevState?.liveCameraPosition ?? null;

    if (result.deviceType === 'airport') {
      osdSnapshot = mergeOsdSnapshot(osdSnapshot, payload);
      const telemetry = buildDockTelemetry(osdSnapshot, deviceId, {
        supplementLightState,
        liveCameraPosition,
      });
      supplementLightState = telemetry.supplementLightState;
      liveCameraPosition = telemetry.liveCameraPosition;
      if (liveCameraPosition === null) {
        const stored = getLiveCameraPosition(deviceId);
        if (stored !== null) liveCameraPosition = stored;
      }
    }

    const mergedResult = {
      ...result,
      // 合并指标：保留之前存在的指标，更新新收到的指标
      metrics: prevState ? { ...prevState.metrics, ...result.metrics } : result.metrics,
      // 保留之前的位置信息（如果新消息没有）
      location: result.location || (prevState?.location) || null,
      // 每个设备只保留一条告警
      alerts: result.alerts,
      lastSeen: new Date(),
      // 保存最新 mode_code 供下次状态机读取
      raw_mode_code: currentMode !== undefined ? currentMode : prevState?.raw_mode_code,
      raw_total_flight_distance: totalFlightDistance !== null ? totalFlightDistance : prevState?.raw_total_flight_distance,
      raw_total_flight_time: totalFlightTime !== null ? totalFlightTime : prevState?.raw_total_flight_time,
      flightSession: session || null,
      boundDroneSn: result.boundDroneSn || prevState?.boundDroneSn || null,
      osdSnapshot: result.deviceType === 'airport' ? osdSnapshot : prevState?.osdSnapshot || null,
      supplementLightState,
      liveCameraPosition,
      ...this.regionMeta(),
    };

    // 更新设备状态缓存
    this.deviceStates.set(deviceId, mergedResult);

    return mergedResult;
  }

  /**
   * 获取模式文本
   */
  getModeText(modeCode) {
    const n = Number(modeCode);
    if (MODE_CODE_TEXT[n] != null) return MODE_CODE_TEXT[n];
    return `模式${modeCode}`;
  }

  /**
   * 从主题或数据中提取设备ID
   * 主题格式: thing/product/{device_sn}/osd
   */
  extractDeviceId(topic, data) {
    // 从主题中提取 device_sn (thing/product/{device_sn}/osd)
    const topicMatch = topic.match(/thing\/product\/([^/]+)/);
    if (topicMatch) {
      return topicMatch[1];
    }
    // 优先使用数据中的gateway或设备ID
    if (data.gateway) {
      return data.gateway;
    }
    if (data.deviceId || data.device_id || data.id) {
      return data.deviceId || data.device_id || data.id;
    }
    // 从主题末尾提取
    const parts = topic.split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  /**
   * 评估单个指标
   */
  evaluateMetric(type, value) {
    const threshold = this.thresholds[type];
    if (!threshold) {
      return { value, status: 'unknown', statusText: '未知' };
    }

    let status = 'critical';
    let statusText = '严重';

    // 检查值是否在某个区间内
    const checkInRange = (val, ranges) => {
      // 单区间格式
      if (!Array.isArray(ranges)) {
        return val >= ranges.min && val <= ranges.max;
      }
      // 多区间格式
      return ranges.some(range => val >= range.min && val <= range.max);
    };

    if (checkInRange(value, threshold.normal)) {
      status = 'normal';
      statusText = '正常';
    } else if (checkInRange(value, threshold.warning)) {
      status = 'warning';
      statusText = '警告';
    } else if (checkInRange(value, threshold.critical)) {
      status = 'critical';
      statusText = '严重';
    }

    return {
      value,
      status,
      statusText,
      unit: this.getUnit(type)
    };
  }

  /**
   * 获取指标单位
   */
  getUnit(type) {
    const units = {
      temperature: '°C',
      humidity: '%',
      battery: '%',
      signal: 'dBm',
      windSpeed: 'm/s',
      environmentTemp: '°C',
      droneBattery: '%',
      rainfall: 'mm'
    };
    return units[type] || '';
  }

  /**
   * 计算整体状态 - 根据风速和电池槽状态判断
   */
  calculateOverallStatus(metrics, prevState = null, ctx = {}) {
    const { deviceType, rawModeCode, activeSession, boundDroneSn } = ctx;

    if (deviceType === 'remote') {
      if (boundDroneSn || metrics.boundDrone?.sn) {
        if (metrics.subDeviceOnline?.value === 1) return 'normal';
        const droneState = this.deviceStates.get(boundDroneSn || metrics.boundDrone?.sn);
        if (droneState?.activeSession || droneState?.flightSession) return 'normal';
        if (droneState?.lastSeen && Date.now() - new Date(droneState.lastSeen).getTime() < FLIGHT_STALE_TIMEOUT_MS) {
          return 'normal';
        }
        return 'normal';
      }
      if (prevState?.lastSeen && Date.now() - new Date(prevState.lastSeen).getTime() < FLIGHT_STALE_TIMEOUT_MS) {
        return 'normal';
      }
      return 'unknown';
    }

    if (['drone', 'single', 'virtual'].includes(deviceType)) {
      const mode = rawModeCode ?? metrics.modeCode?.value;
      if (activeSession || (mode !== undefined && FLIGHT_MODES.has(mode))) {
        return 'normal';
      }
      if (mode === 14) {
        return 'warning';
      }
      if (mode !== undefined) {
        return 'normal';
      }
      if (metrics.windSpeed) {
        return metrics.windSpeed.status;
      }
      if (metrics.droneBattery) {
        return 'normal';
      }
      if (prevState?.lastSeen && Date.now() - new Date(prevState.lastSeen).getTime() < FLIGHT_STALE_TIMEOUT_MS) {
        return 'normal';
      }
      return 'unknown';
    }

    // 机场：风速 / 电池槽
    if (metrics.batterySlots && metrics.batterySlots.status === 'warning') {
      return 'warning';
    }
    // 如果当前电池槽状态正常，但之前是警告，保留之前的警告状态（避免跳变）
    if (metrics.batterySlots && metrics.batterySlots.status === 'normal' && 
        prevState?.status === 'warning' && 
        prevState?.metrics?.batterySlots?.status === 'warning') {
      return 'warning';
    }
    
    // 如果当前有风速数据，使用当前状态
    if (metrics.windSpeed) {
      return metrics.windSpeed.status;
    }
    // 如果当前没有风速数据，但有之前的状态，保留之前的状态
    if (prevState?.metrics?.windSpeed) {
      return prevState.metrics.windSpeed.status;
    }
    return 'unknown';
  }

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    const texts = {
      normal: '正常',
      warning: '警告',
      critical: '严重',
      unknown: '未知',
      online: '在线',
      offline: '离线',
      running: '运行中',
      stopped: '已停止'
    };
    return texts[status] || status;
  }

  /**
   * 生成风速告警 - 每个设备只生成一条告警
   */
  generateWindAlert(deviceId, metrics) {
    if (!metrics.windSpeed) return null;
    
    const metric = metrics.windSpeed;
    if (metric.status === 'critical') {
      return {
        level: 'critical',
        type: 'windSpeed',
        message: `风速严重异常: ${metric.value}${metric.unit || ''}`,
        value: metric.value,
        timestamp: new Date().toISOString()
      };
    } else if (metric.status === 'warning') {
      return {
        level: 'warning',
        type: 'windSpeed',
        message: `风速警告: ${metric.value}${metric.unit || ''}`,
        value: metric.value,
        timestamp: new Date().toISOString()
      };
    }
    return null;
  }

  /**
   * 获取指标名称
   */
  getMetricName(type) {
    const names = {
      temperature: '机库温度',
      humidity: '机库湿度',
      battery: '电量',
      signal: '信号强度',
      windSpeed: '风速',
      environmentTemp: '环境温度',
      droneBattery: '无人机电量',
      networkQuality: '网络质量',
      rainfall: '降雨量',
      droneInDock: '无人机状态',
      modeCode: '工作模式'
    };
    return names[type] || type;
  }

  /**
   * 获取所有设备状态
   */
  getAllDeviceStates() {
    return Array.from(this.deviceStates.entries()).map(([id, state]) => ({
      deviceId: id,
      ...state,
      ...this.regionMeta(),
    }));
  }

  /**
   * 获取单个设备状态
   */
  getDeviceState(deviceId) {
    return this.deviceStates.get(deviceId);
  }

  /** 无归属设备：记录实际 MQTT 连接池来源（smartcity-prod / haizhu-local 等） */
  patchDeviceMqttSource(deviceId, mqttConnectionRegionId) {
    const state = this.deviceStates.get(deviceId);
    if (!state || !mqttConnectionRegionId) return;
    state.mqttConnectionRegionId = mqttConnectionRegionId;
  }

  /** 控制指令成功后写入 Dock 状态（OSD 延迟时 UI 仍可识别） */
  patchDockControlState(deviceId, patch = {}) {
    const state = this.deviceStates.get(deviceId);
    if (!state || state.deviceType !== 'airport') return null;

    const osdSnapshot = { ...(state.osdSnapshot || {}) };
    let liveCameraPosition = state.liveCameraPosition ?? null;
    let supplementLightState = state.supplementLightState ?? null;

    if (patch.liveCameraPosition === 0 || patch.liveCameraPosition === 1) {
      osdSnapshot.camera_position = patch.liveCameraPosition;
      liveCameraPosition = patch.liveCameraPosition;
      setLiveCameraPosition(deviceId, patch.liveCameraPosition, patch.source || 'control');
    }
    if (patch.supplementLightState === 0 || patch.supplementLightState === 1) {
      osdSnapshot.supplement_light_state = patch.supplementLightState;
      supplementLightState = patch.supplementLightState;
    }

    const next = {
      ...state,
      osdSnapshot,
      supplementLightState,
      liveCameraPosition,
    };
    this.deviceStates.set(deviceId, next);
    return next;
  }

  /**
   * 更新阈值配置
   */
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }

  buildRegistryRow(deviceId) {
    const state = this.deviceStates.get(deviceId);
    const category = this.inferDeviceCategory(deviceId);
    const name = this.deviceNames[deviceId] || deviceId;
    return {
      deviceId,
      name,
      category,
      categoryLabel: DEVICE_CATEGORY_LABELS[category] || category,
      source: this.resolveDeviceNameSource(deviceId),
      online: !!state,
      lastSeen: state?.lastSeen || state?.lastUpdate || null,
      gateway: state?.gateway || null,
      statusText: state?.statusText || null,
      boundAirportSn: category === 'airport_drone' ? this.getAirportBoundDroneSn(deviceId) : null,
      boundRemoteSn: category === 'single' ? this.getRemoteBoundDroneSn(deviceId) : null,
      ...this.regionMeta(),
    };
  }

  getDeviceRegistryList() {
    const ids = new Set([
      ...Object.keys(this.deviceNames),
      ...Object.keys(this.registryOverrides),
      ...this.deviceStates.keys(),
    ]);
    const categoryOrder = ['airport', 'airport_drone', 'single', 'remote', 'unknown'];
    return Array.from(ids)
      .map((deviceId) => this.buildRegistryRow(deviceId))
      .sort((a, b) => {
        const ca = categoryOrder.indexOf(a.category);
        const cb = categoryOrder.indexOf(b.category);
        if (ca !== cb) return ca - cb;
        return (a.name || a.deviceId).localeCompare(b.name || b.deviceId, 'zh-CN');
      });
  }

  getDeviceRegistryGrouped() {
    const bindings = this.resolveAllAirportBindings();
    const boundDroneSns = new Set();
    const airportSns = new Set();

    const pairs = Object.entries(bindings).map(([airportSn, binding]) => {
      airportSns.add(airportSn);
      if (binding.droneSn) boundDroneSns.add(binding.droneSn);
      const airport = this.buildRegistryRow(airportSn);
      const drone = binding.droneSn ? this.buildRegistryRow(binding.droneSn) : null;
      return {
        airportSn,
        droneSn: binding.droneSn || null,
        bindingSource: binding.source,
        dockModel: inferDockModel(airportSn, airport.name),
        droneModel: drone ? inferDroneModel(drone.name, binding.droneSn) : null,
        airport,
        drone,
      };
    }).sort((a, b) => (a.airport.name || a.airportSn).localeCompare(b.airport.name || b.airportSn, 'zh-CN'));

    const remoteBindings = this.resolveAllRemoteBindings();
    const boundSingleSns = new Set();
    const remoteSns = new Set();

    const singlePairs = Object.entries(remoteBindings).map(([remoteSn, binding]) => {
      remoteSns.add(remoteSn);
      if (binding.droneSn) boundSingleSns.add(binding.droneSn);
      const remote = this.buildRegistryRow(remoteSn);
      const drone = binding.droneSn ? this.buildRegistryRow(binding.droneSn) : null;
      return {
        remoteSn,
        droneSn: binding.droneSn || null,
        bindingSource: binding.source,
        remoteModel: 'DJI 遥控器',
        droneModel: drone ? inferDroneModel(drone.name, binding.droneSn) : null,
        remote,
        drone,
      };
    }).sort((a, b) => (a.remote.name || a.remoteSn).localeCompare(b.remote.name || b.remoteSn, 'zh-CN'));

    const all = this.getDeviceRegistryList();
    const unboundSingles = all.filter(
      (d) => d.category === 'single' && !boundSingleSns.has(d.deviceId)
    );
    const unboundRemotes = all.filter(
      (d) => d.category === 'remote' && !remoteSns.has(d.deviceId)
    );
    const unboundDrones = all.filter(
      (d) => d.category === 'airport_drone' && !boundDroneSns.has(d.deviceId)
    );
    const orphanAirports = all.filter(
      (d) => d.category === 'airport' && !airportSns.has(d.deviceId)
    );

    return { pairs, singlePairs, unboundSingles, unboundRemotes, unboundDrones, orphanAirports };
  }

  upsertRemoteBinding(remoteSn, droneSn, { droneName } = {}) {
    const remote = String(remoteSn || '').trim();
    const drone = String(droneSn || '').trim();
    if (!remote) throw new Error('遥控器 SN 不能为空');
    if (!this.isRemoteSn(remote) && !this.deviceNames[remote]) {
      throw new Error('请先为遥控器配置名称映射');
    }
    if (drone) {
      this.registryRemoteBindings[remote] = drone;
      this.customRemoteBindingKeys.add(remote);
      this.remoteDroneBindings.set(remote, drone);
      if (droneName) {
        this.registryOverrides[drone] = {
          ...(this.registryOverrides[drone] || {}),
          name: String(droneName).trim(),
          category: 'single',
        };
      } else if (!this.registryOverrides[drone]) {
        this.registryOverrides[drone] = { category: 'single' };
      } else {
        this.registryOverrides[drone].category = 'single';
      }
    } else {
      delete this.registryRemoteBindings[remote];
      this.customRemoteBindingKeys.delete(remote);
      this.remoteDroneBindings.delete(remote);
    }
    this.applyDeviceRegistryOverrides();
    this.saveDeviceRegistryToFile();
    this.repairFlightHistory();
    return this.getDeviceRegistryGrouped().singlePairs.find((p) => p.remoteSn === remote);
  }

  upsertAirportBinding(airportSn, droneSn, { droneName } = {}) {
    const airport = String(airportSn || '').trim();
    const drone = String(droneSn || '').trim();
    if (!airport) throw new Error('机场 SN 不能为空');
    if (!this.isAirportSn(airport) && !this.deviceNames[airport]) {
      throw new Error('请先为机场配置名称映射');
    }
    if (drone) {
      this.registryBindings[airport] = drone;
      if (droneName) {
        this.registryOverrides[drone] = {
          ...(this.registryOverrides[drone] || {}),
          name: String(droneName).trim(),
          category: 'airport_drone',
        };
      } else if (!this.registryOverrides[drone]) {
        this.registryOverrides[drone] = { category: 'airport_drone' };
      } else {
        this.registryOverrides[drone].category = 'airport_drone';
      }
    } else {
      delete this.registryBindings[airport];
    }
    this.applyDeviceRegistryOverrides();
    this.saveDeviceRegistryToFile();
    this.repairFlightHistory();
    return this.getDeviceRegistryGrouped().pairs.find((p) => p.airportSn === airport);
  }

  upsertDeviceRegistry(deviceId, { name, category }) {
    const sn = String(deviceId || '').trim();
    const displayName = String(name || '').trim();
    if (!sn) throw new Error('设备 SN 不能为空');
    if (!displayName) throw new Error('显示名称不能为空');
    const allowed = ['airport', 'single', 'airport_drone', 'remote'];
    if (!allowed.includes(category)) throw new Error('无效的设备类型');
    this.registryOverrides[sn] = { name: displayName, category };
    this.applyDeviceRegistryOverrides();
    this.saveDeviceRegistryToFile();
    this.repairFlightHistory();
    return this.getDeviceRegistryList().find((r) => r.deviceId === sn);
  }

  collectKnownDeviceIds() {
    const ids = new Set([
      ...Object.keys(this.deviceNames),
      ...Object.keys(this.registryOverrides),
      ...Object.keys(this.registryBindings),
      ...Object.keys(this.registryRemoteBindings),
      ...this.deviceStates.keys(),
    ]);
    return ids;
  }

  /** 是否已映射到本区域（不含仅 MQTT 在线、未写入 registry 的设备） */
  isDeviceInRegion(deviceId) {
    const id = String(deviceId || '');
    if (!id) return false;
    if (this.registryOverrides[id]) return true;
    if (this.registryBindings[id]) return true;
    if (Object.values(this.registryBindings).includes(id)) return true;
    if (this.registryRemoteBindings[id]) return true;
    if (Object.values(this.registryRemoteBindings).includes(id)) return true;
    if (this.deviceNames[id]) return true;
    return false;
  }

  freezeOnlineSnapshot() {
    const mappings = {};
    for (const deviceId of this.collectKnownDeviceIds()) {
      const name = this.deviceNames[deviceId];
      if (!name || name === deviceId) continue;
      mappings[deviceId] = {
        name,
        category: this.inferDeviceCategory(deviceId),
      };
    }
    const bindings = {};
    for (const [airportSn, binding] of Object.entries(this.resolveAllAirportBindings())) {
      if (binding?.droneSn) bindings[airportSn] = binding.droneSn;
    }
    const remoteBindings = {};
    for (const [remoteSn, binding] of Object.entries(this.resolveAllRemoteBindings())) {
      if (binding?.droneSn) remoteBindings[remoteSn] = binding.droneSn;
    }
    const payload = {
      meta: {
        frozen: true,
        frozenAt: new Date().toISOString(),
        regionId: this.regionId,
        source: 'online-snapshot',
      },
      mappings,
      bindings,
      remoteBindings,
      remoteBindingsCustom: [...this.customRemoteBindingKeys],
    };
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    const temp = this.registryFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temp, this.registryFile);
    this.registryFrozen = true;
    this.registryOverrides = { ...mappings };
    this.registryBindings = { ...bindings };
    this.registryRemoteBindings = { ...remoteBindings };
    this.applyDeviceRegistryOverrides();
    return payload;
  }

  removeDeviceRegistryOverride(deviceId) {
    const sn = String(deviceId || '').trim();
    if (!sn || !this.registryOverrides[sn]) {
      throw new Error('该设备没有可删除的自定义映射');
    }
    delete this.registryOverrides[sn];
    this.applyDeviceRegistryOverrides();
    this.saveDeviceRegistryToFile();
    this.repairFlightHistory();
  }
}

DeviceProcessor.DEVICE_CATEGORY_LABELS = DEVICE_CATEGORY_LABELS;

module.exports = DeviceProcessor;
module.exports.MODE_CODE_TEXT = MODE_CODE_TEXT;
module.exports.FLIGHT_MODES = FLIGHT_MODES;
module.exports.NON_FLIGHT_MODES = NON_FLIGHT_MODES;
module.exports.BUILTIN_AIRPORT_BINDINGS = BUILTIN_AIRPORT_BINDINGS;
module.exports.BUILTIN_REMOTE_BINDINGS = BUILTIN_REMOTE_BINDINGS;
