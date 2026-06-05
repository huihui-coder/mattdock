const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  getRegionAlertConfigPath,
  readRegions,
  DEFAULT_REGION_ID,
} = require('./lib/region-store');
const {
  collectAlertConfigDeviceIds,
  resolveRegionIdInScope,
  getLeafProcessorsInScope,
} = require('./lib/region-runtime');
const { captureStreamSnapshot } = require('./lib/stream-snapshot');
const { isDockSeriesAirport } = require('./lib/dock-service');
const { launchLostAlertJob } = require('./lib/lost-alert-job-launcher');
const { computeLocationDistanceContext } = require('./lib/geo-utils');

class AlertService {
  constructor(options = {}) {
    /** @type {Map<string, { globalWebhookUrl: string, deviceConfigs: Object }>} */
    this.regionStores = new Map();
    // deviceId -> 当前是否在舱 (true=在舱)
    this.droneInDockState = {};
    // deviceId -> 机场是否在线 (true=在线)
    this.airportOnlineState = {};
    // deviceId(机场) -> { latitude, longitude, height }
    this._droneLocationCache = {};

    this.aiAnalyzer = options.aiAnalyzer || null;
    this.getDeviceState = options.getDeviceState || (() => null);
    this.mqttService = options.mqttService || null;
    this.processor = options.processor || null;
    this.resolveRegionId = options.resolveRegionId || (() => null);
    this.aiAnalysisEnabled = options.aiAnalysisEnabled !== false;

    this._loadAllRegionConfigs();
  }

  _regionIdFor(deviceId, sourceRegionId) {
    if (sourceRegionId) return sourceRegionId;
    return this.resolveRegionId(deviceId) || DEFAULT_REGION_ID;
  }

  _loadRegionConfig(regionId) {
    const file = getRegionAlertConfigPath(regionId);
    let data = { globalWebhookUrl: '', deviceConfigs: {} };
    try {
      if (fs.existsSync(file)) {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (e) {
      console.warn(`[AlertService] 区域 ${regionId} 配置读取失败:`, e.message);
    }
    this.regionStores.set(regionId, {
      globalWebhookUrl: data.globalWebhookUrl || '',
      deviceConfigs: data.deviceConfigs || {},
    });
  }

  _loadAllRegionConfigs() {
    const regions = readRegions();
    if (regions.length) {
      for (const region of regions) this._loadRegionConfig(region.id);
    } else {
      this._loadRegionConfig(DEFAULT_REGION_ID);
    }
  }

  _store(regionId) {
    if (!this.regionStores.has(regionId)) this._loadRegionConfig(regionId);
    return this.regionStores.get(regionId);
  }

  _saveRegionConfig(regionId) {
    const store = this.regionStores.get(regionId);
    if (!store) return;
    try {
      const file = getRegionAlertConfigPath(regionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        globalWebhookUrl: store.globalWebhookUrl,
        deviceConfigs: store.deviceConfigs,
      }, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[AlertService] 区域 ${regionId} 配置保存失败:`, e.message);
    }
  }

  _deviceEntry(deviceId, sourceRegionId) {
    const regionId = this._regionIdFor(deviceId, sourceRegionId);
    const store = this._store(regionId);
    if (!store.deviceConfigs[deviceId]) store.deviceConfigs[deviceId] = {};
    return { regionId, store, cfg: store.deviceConfigs[deviceId] };
  }

  _webhookFor(deviceId, sourceRegionId) {
    const { store, cfg } = this._deviceEntry(deviceId, sourceRegionId);
    return cfg.webhookUrl || store.globalWebhookUrl;
  }

  _saveForDevice(deviceId) {
    this._saveRegionConfig(this._regionIdFor(deviceId));
  }

  _eachDeviceConfig(fn) {
    for (const store of this.regionStores.values()) {
      for (const [deviceId, cfg] of Object.entries(store.deviceConfigs)) {
        fn(deviceId, cfg, store);
      }
    }
  }

  getScopedConfig(scope = {}) {
    const { visibleRegionIds = [], regionId: primaryRegionId, processors = [] } = scope;
    const regions = readRegions();
    const leaves = getLeafProcessorsInScope(processors, regions);
    const deviceConfigs = {};
    const regionWebhooks = {};
    const leafRegions = [];

    for (const { regionId: rid, regionName } of leaves) {
      const store = this._store(rid);
      regionWebhooks[rid] = store.globalWebhookUrl || '';
      leafRegions.push({ id: rid, name: regionName || rid });
      for (const [deviceId, cfg] of Object.entries(store.deviceConfigs)) {
        const owner = resolveRegionIdInScope(deviceId, processors, regions) || rid;
        if (owner === rid) deviceConfigs[deviceId] = cfg;
      }
    }

    const singleLeafId = leaves.length === 1 ? leaves[0].regionId : null;
    return {
      globalWebhookUrl: singleLeafId ? (regionWebhooks[singleLeafId] || '') : '',
      regionWebhooks,
      leafRegions,
      deviceConfigs,
      regionId: primaryRegionId,
      visibleRegionIds,
    };
  }

  // 获取所有配置（兼容旧调用）
  getConfig() {
    const regions = readRegions();
    return this.getScopedConfig({
      visibleRegionIds: regions.map((r) => r.id),
      regionId: DEFAULT_REGION_ID,
      processors: [],
    });
  }

  // 更新全局 Webhook
  setGlobalWebhook(url, regionId = DEFAULT_REGION_ID) {
    const store = this._store(regionId);
    store.globalWebhookUrl = url;
    this._saveRegionConfig(regionId);
  }

  // 更新单个设备配置
  setDeviceConfig(deviceId, config) {
    const { cfg, regionId } = this._deviceEntry(deviceId);
    Object.assign(cfg, config);
    this._saveRegionConfig(regionId);
  }

  updateScopedConfigs(scope, { globalWebhookUrl, regionWebhooks, deviceConfigs }) {
    const visibleRegionIds = scope?.visibleRegionIds || [];
    const regions = readRegions();
    const leaves = getLeafProcessorsInScope(scope?.processors || [], regions);
    const leafIds = new Set(leaves.map((p) => p.regionId));
    const { ids: allowedIds } = collectAlertConfigDeviceIds(scope?.processors || [], regions);

    if (regionWebhooks && typeof regionWebhooks === 'object') {
      for (const [rid, url] of Object.entries(regionWebhooks)) {
        if (!leafIds.has(rid)) continue;
        if (visibleRegionIds.length && !visibleRegionIds.includes(rid)) continue;
        const store = this._store(rid);
        store.globalWebhookUrl = url || '';
        this._saveRegionConfig(rid);
      }
    } else if (globalWebhookUrl !== undefined && leaves.length === 1) {
      const rid = leaves[0].regionId;
      const store = this._store(rid);
      store.globalWebhookUrl = globalWebhookUrl;
      this._saveRegionConfig(rid);
    }

    if (deviceConfigs) {
      const grouped = {};
      for (const [deviceId, cfg] of Object.entries(deviceConfigs)) {
        if (allowedIds.size && !allowedIds.has(deviceId)) continue;
        const regionId = resolveRegionIdInScope(deviceId, scope?.processors || [], regions)
          || this._regionIdFor(deviceId);
        if (visibleRegionIds.length && !visibleRegionIds.includes(regionId)) continue;
        if (!grouped[regionId]) grouped[regionId] = {};
        const store = this._store(regionId);
        grouped[regionId][deviceId] = { ...store.deviceConfigs[deviceId], ...cfg };
      }
      for (const [regionId, configs] of Object.entries(grouped)) {
        const store = this._store(regionId);
        Object.assign(store.deviceConfigs, configs);
        this._saveRegionConfig(regionId);
      }
    }
  }

  // 批量更新设备配置（无区域校验，仅供内部/迁移）
  updateConfigs(payload) {
    const { globalWebhookUrl, deviceConfigs } = payload || {};
    if (globalWebhookUrl !== undefined) {
      this.setGlobalWebhook(globalWebhookUrl);
    }
    if (deviceConfigs) {
      for (const [deviceId, cfg] of Object.entries(deviceConfigs)) {
        this.setDeviceConfig(deviceId, cfg);
      }
    }
  }

  /**
   * 机场在线心跳：每次收到该机场的 OSD 消息时调用，说明机场在线
   * @param {string} deviceId
   * @param {string} deviceName
   */
  onAirportOnline(deviceId, deviceName, sourceRegionId) {
    const wasOnline = this.airportOnlineState[deviceId];
    this.airportOnlineState[deviceId] = Date.now(); // 记录最后在线时间

    const { cfg } = this._deviceEntry(deviceId, sourceRegionId);
    if (!cfg || !cfg.offlineAlertEnabled) return;

    // 机场恢复在线，重置离线告警计时
    if (wasOnline === 0) {
      console.log(`[AlertService] ${deviceName} 机场恢复在线`);
      const webhookUrl = this._webhookFor(deviceId);
      if (webhookUrl) {
        this._sendWecomWebhook(webhookUrl, deviceName, deviceId, 0, 'online');
      }
    }
    cfg.lastOfflineTime = null;
    cfg.lastOfflineAlertTime = null;
  }

  /**
   * 定时检查机场是否离线（每分钟调用一次）
   * 若超过 2 分钟没收到该机场 OSD 消息，认定为离线
   */
  checkAirportOffline() {
    const offlineThresholdMs = 2 * 60 * 1000;
    const now = Date.now();

    Object.entries(this.airportOnlineState).forEach(([deviceId, lastSeen]) => {
      if (lastSeen === 0) return; // 已标记为离线，跳过
      const { cfg } = this._deviceEntry(deviceId);
      if (!cfg || !cfg.offlineAlertEnabled) return;

      if (now - lastSeen > offlineThresholdMs) {
        const wasOnline = lastSeen !== 0;
        if (wasOnline) {
          // 刚离线
          this.airportOnlineState[deviceId] = 0;
          cfg.lastOfflineTime = now;
          cfg.lastOfflineAlertTime = null;
          const deviceName = this._getDeviceName(deviceId);
          console.log(`[AlertService] ${deviceName} 机场离线`);

          // 立即推送一次（如果配置了）
          if (cfg.offlineAlertImmediate !== false) {
            const webhookUrl = this._webhookFor(deviceId);
            if (webhookUrl) {
              this._sendWecomWebhook(webhookUrl, deviceName, deviceId, 0, 'offline_first');
              cfg.lastOfflineAlertTime = now;
              this._saveForDevice(deviceId);
              this._runAiAnalysis({
                alertKind: 'offline_first',
                webhookUrl,
                deviceId,
                deviceName,
                elapsedMin: 0,
              });
            }
          }
        }
      }
    });

    // 循环提醒已离线的机场
    this._eachDeviceConfig((deviceId, cfg) => {
      if (!cfg.offlineAlertEnabled) return;
      if (this.airportOnlineState[deviceId] !== 0) return; // 不是离线状态

      const repeatMs = (cfg.offlineRepeatMinutes || 0) * 60 * 1000;
      if (!repeatMs) return; // 0 = 不循环

      const lastAlert = cfg.lastOfflineAlertTime;
      if (!lastAlert) return;
      if (now - lastAlert < repeatMs) return;

      const deviceName = this._getDeviceName(deviceId);
      const offlineMin = Math.round((now - cfg.lastOfflineTime) / 60000);
      const webhookUrl = this._webhookFor(deviceId);
      if (webhookUrl) {
        this._sendWecomWebhook(webhookUrl, deviceName, deviceId, offlineMin, 'offline_repeat');
        cfg.lastOfflineAlertTime = now;
        this._saveForDevice(deviceId);
        this._runAiAnalysis({
          alertKind: 'offline_repeat',
          webhookUrl,
          deviceId,
          deviceName,
          elapsedMin: offlineMin,
        });
      }
    });
  }

  updateDroneLocation(airportId, location) {
    this._droneLocationCache[airportId] = location;
  }

  _getDeviceName(deviceId) {
    // 从缓存中查找设备名（由外部调用时传入并缓存）
    return this._deviceNameCache?.[deviceId] || deviceId;
  }

  /**
   * 外部每次收到 OSD 数据时调用
   * @param {string} deviceId
   * @param {string} deviceName
   * @param {number|undefined} droneInDock      1=在舱, 0=出舱
   * @param {number|undefined} subDeviceOnline  1=无人机在线(飞行中), 0=无人机离线
   */
  onDeviceUpdate(deviceId, deviceName, droneInDock, subDeviceOnline, sourceRegionId) {
    // 缓存设备名
    if (!this._deviceNameCache) this._deviceNameCache = {};
    this._deviceNameCache[deviceId] = deviceName;
    // 缓存无人机在线状态
    if (subDeviceOnline !== undefined) {
      const { cfg } = this._deviceEntry(deviceId, sourceRegionId);
      cfg._subDeviceOnline = subDeviceOnline;
    }
    // 记录机场在线
    this.onAirportOnline(deviceId, deviceName, sourceRegionId);
    if (droneInDock === undefined) return;

    const { cfg } = this._deviceEntry(deviceId, sourceRegionId);
    if (!cfg || !cfg.enabled) return;

    const inDock = droneInDock === 1;
    const isFlying = subDeviceOnline === 1;

    // 回到机巢，重置所有计时
    if (inDock) {
      const wasOut = this.droneInDockState[deviceId] === false;
      const hadAlert = !!cfg.lastAlertTime;
      this.droneInDockState[deviceId] = true;
      cfg.lastOutTime = null;
      cfg.lastAlertTime = null;
      if (wasOut && hadAlert) {
        // 曾经触发过飞丢告警，回仓时发通知
        console.log(`[AlertService] ${deviceName} 无人机已回仓（曾告警）`);
        const webhookUrl = this._webhookFor(deviceId);
        if (webhookUrl) {
          const time = new Date().toLocaleString('zh-CN');
          const content = `✅ **无人机已回仓**\n> 设备：${deviceName}\n> SN：${deviceId}\n> 无人机已安全返回机巢\n> 时间：${time}`;
          this._postWebhook(webhookUrl, JSON.stringify({ msgtype: 'markdown', markdown: { content } }));
          const sendSnapshot = cfg.sendSnapshot !== false;
          if (sendSnapshot) {
            this._sendStreamSnapshot(webhookUrl, deviceId, '_out');
            const airportState = this.getDeviceState(deviceId);
            const dock = isDockSeriesAirport({
              deviceId,
              deviceType: airportState?.deviceType || 'airport',
            });
            if (!dock) {
              this._sendStreamSnapshot(webhookUrl, deviceId, '_in');
            }
          }
        }
      }
      return;
    }

    // 不在舱（无论飞行中还是离线）→ 开始或继续计时
    if (!inDock) {
      // 刚离巢：记录离巢时间
      if (this.droneInDockState[deviceId] !== false) {
        this.droneInDockState[deviceId] = false;
        cfg.lastOutTime = Date.now();
        cfg.lastAlertTime = null;
        const state = isFlying ? '执行任务中' : '离线';
        console.log(`[AlertService] ${deviceName} 无人机离开机巢（${state}），开始计时`);
        return;
      }

      const thresholdMs = (cfg.thresholdMinutes || 30) * 60 * 1000;
      const outTime = cfg.lastOutTime;
      if (!outTime) {
        cfg.lastOutTime = Date.now();
        return;
      }

      const elapsed = Date.now() - outTime;
      if (elapsed < thresholdMs) return;

      // 避免重复告警：上次告警后再等一个阈值时间才再次推送
      const lastAlert = cfg.lastAlertTime;
      if (lastAlert && Date.now() - lastAlert < thresholdMs) return;

      // 超过阈值仍未返回 → 推送飞丢告警
      const elapsedMin = Math.round(elapsed / 60000);
      const webhookUrl = this._webhookFor(deviceId);
      if (webhookUrl) {
        cfg.lastAlertTime = Date.now();
        this._saveForDevice(deviceId);
        const sendSnapshot = cfg.sendSnapshot !== false;
        const aiEnabled = this.aiAnalysisEnabled && cfg.aiAnalysisEnabled !== false;
        if (sendSnapshot || aiEnabled) {
          this._handleLostAlertSnapshotsAndAi({
            webhookUrl,
            deviceId,
            deviceName,
            elapsedMin,
            sendSnapshot,
            aiEnabled,
          });
        } else {
          this._sendWecomWebhook(webhookUrl, deviceName, deviceId, elapsedMin, 'lost');
        }
      }
    }
  }

  _sendWecomWebhook(webhookUrl, deviceName, deviceId, elapsedMin, type = 'lost') {
    let content;
    const time = new Date().toLocaleString('zh-CN');
    if (type === 'offline_first') {
      content = `🔴 **机场离线告警**\n> 设备：${deviceName}\n> SN：${deviceId}\n> 机场已离线，请检查设备网络状态\n> 时间：${time}`;
    } else if (type === 'offline_repeat') {
      content = `🔴 **机场持续离线提醒**\n> 设备：${deviceName}\n> SN：${deviceId}\n> 机场已离线 **${elapsedMin} 分钟**，请尽快处理\n> 时间：${time}`;
    } else if (type === 'online') {
      content = `✅ **机场恢复在线**\n> 设备：${deviceName}\n> SN：${deviceId}\n> 机场已恢复正常连接\n> 时间：${time}`;
    } else if (type === 'test') {
      content = `🔔 **告警测试**\n> Webhook 连接正常\n> 时间：${time}`;
    } else {
      const loc = this._droneLocationCache[deviceId];
      const airportState = this.getDeviceState(deviceId);
      const distCtx = computeLocationDistanceContext(loc, airportState?.location);
      const locStr = loc
        ? `\n> 最后位置：${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}（高度 ${loc.height || 0}m）${distCtx.webhookLine || ''}`
        : '';
      const cfg = this._deviceEntry(deviceId).cfg;
      const subOnlineVal = cfg._subDeviceOnline;
      const subOnline = subOnlineVal === 1 ? '（无人机在线）' : '（无人机离线）';
      content = `⚠️ **无人机离巢告警**\n> 设备：${deviceName} ${subOnline}\n> SN：${deviceId}\n> 无人机已离开机巢 **${elapsedMin} 分钟**，飞机疑似飞丢请检查飞行状态${locStr}\n> 时间：${time}`;
    }
    const body = JSON.stringify({ msgtype: 'markdown', markdown: { content } });
    this._postWebhook(webhookUrl, body);
  }

  setMqttService(mqttService) {
    this.mqttService = mqttService;
  }

  setProcessor(processor) {
    this.processor = processor;
  }

  _postWebhookAsync(webhookUrl, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const isHttps = url.protocol === 'https:';
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = (isHttps ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log('[AlertService] 企业微信推送结果:', data);
          resolve(data);
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _serializeDeviceStateForAi(deviceState) {
    if (!deviceState) return null;
    return {
      deviceName: deviceState.deviceName,
      deviceType: deviceState.deviceType,
      status: deviceState.status,
      statusText: deviceState.statusText,
      location: deviceState.location,
      metrics: deviceState.metrics,
      lastUpdate: deviceState.lastUpdate,
      raw_mode_code: deviceState.raw_mode_code,
      osdSnapshot: deviceState.osdSnapshot
        ? {
            sub_device: deviceState.osdSnapshot.sub_device,
            drone_in_dock: deviceState.osdSnapshot.drone_in_dock,
          }
        : null,
      flightSession: deviceState.flightSession ? { active: true } : null,
    };
  }

  async _sendSnapshotShot(webhookUrl, shot) {
    if (!shot?.base64) return;
    const md5 = crypto.createHash('md5').update(shot.buffer).digest('hex');
    await this._postWebhookAsync(
      webhookUrl,
      JSON.stringify({ msgtype: 'image', image: { base64: shot.base64, md5 } }),
    );
    console.log(`[AlertService] 截图已发送 ${shot.label || shot.suffix}`);
  }

  /**
   * 手动触发飞丢告警（测试用，不更新 lastAlertTime）
   * @returns {{ ok: boolean, pid?: number, error?: string }}
   */
  triggerLostAlertTest(deviceId, deviceName, sourceRegionId) {
    const { cfg } = this._deviceEntry(deviceId, sourceRegionId);
    const webhookUrl = this._webhookFor(deviceId, sourceRegionId);
    if (!webhookUrl) {
      return { ok: false, error: '请先配置全局或设备专属 Webhook' };
    }

    const sendSnapshot = cfg.sendSnapshot !== false;
    const aiEnabled = this.aiAnalysisEnabled && cfg.aiAnalysisEnabled !== false;
    const elapsedMin = cfg.thresholdMinutes || 30;
    const deviceState = this.getDeviceState(deviceId);
    const resolvedName = deviceName || deviceState?.deviceName || deviceId;

    console.log(`[AlertService] 手动触发飞丢告警测试 ${resolvedName} (${deviceId})`);
    const regionId = sourceRegionId || this.resolveRegionId(deviceId);
    const pid = launchLostAlertJob({
      deviceId,
      deviceName: resolvedName,
      regionId,
      elapsedMin,
      thresholdMinutes: cfg.thresholdMinutes || 30,
      webhookUrl,
      sendSnapshot,
      aiEnabled,
      location: this._droneLocationCache[deviceId] || null,
      subDeviceOnline: cfg._subDeviceOnline,
      deviceState: this._serializeDeviceStateForAi(deviceState),
    });

    if (!pid) {
      return { ok: false, error: '该设备飞丢截图任务正在执行中' };
    }
    return { ok: true, pid };
  }

  /**
   * 飞丢告警：独立子进程执行截图+AI（不受 nodemon 重启影响）
   */
  _handleLostAlertSnapshotsAndAi({
    webhookUrl,
    deviceId,
    deviceName,
    elapsedMin,
    sendSnapshot,
    aiEnabled,
  }) {
    const { cfg } = this._deviceEntry(deviceId);
    const deviceState = this.getDeviceState(deviceId);
    const regionId = this.resolveRegionId(deviceId);
    console.log(`[AlertService] 启动飞丢截图子进程 ${deviceName} (${deviceId}) region=${regionId}`);
    launchLostAlertJob({
      deviceId,
      deviceName,
      regionId,
      elapsedMin,
      thresholdMinutes: cfg.thresholdMinutes || 30,
      webhookUrl,
      sendSnapshot: sendSnapshot !== false,
      aiEnabled: !!aiEnabled,
      location: this._droneLocationCache[deviceId] || null,
      subDeviceOnline: cfg._subDeviceOnline,
      deviceState: this._serializeDeviceStateForAi(deviceState),
    });
  }

  _postWebhook(webhookUrl, body) {
    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => console.log('[AlertService] 企业微信推送结果:', data));
    });
    req.on('error', (e) => console.error('[AlertService] 企业微信推送失败:', e.message));
    req.write(body);
    req.end();
  }

  _sendStreamSnapshot(webhookUrl, deviceId, suffix = '_out') {
    const regionId = this.resolveRegionId(deviceId);
    captureStreamSnapshot(deviceId, suffix, 15000, regionId).then((shot) => {
      if (!shot) {
        console.warn(`[AlertService] 截图失败 ${deviceId}${suffix}`);
        return;
      }
      try {
        const md5 = crypto.createHash('md5').update(shot.buffer).digest('hex');
        this._postWebhook(
          webhookUrl,
          JSON.stringify({ msgtype: 'image', image: { base64: shot.base64, md5 } }),
        );
        console.log(`[AlertService] 截图已发送 ${deviceId}${suffix}`);
      } catch (e) {
        console.warn('[AlertService] 截图发送失败:', e.message);
      }
    });
  }

  _sendAiAnalysisWebhook(webhookUrl, deviceName, deviceId, analysis) {
    if (!analysis) return;
    const trimmed = String(analysis).slice(0, 3200);
    const time = new Date().toLocaleString('zh-CN');
    const content = `🤖 **AI 告警分析**\n> 设备：${deviceName}\n> SN：${deviceId}\n> 时间：${time}\n\n${trimmed}`;
    this._postWebhook(webhookUrl, JSON.stringify({ msgtype: 'markdown', markdown: { content } }));
  }

  _runAiAnalysis({ alertKind, webhookUrl, deviceId, deviceName, elapsedMin, preCapturedShots }) {
    if (!this.aiAnalysisEnabled || !this.aiAnalyzer || !webhookUrl) return;

    const { cfg } = this._deviceEntry(deviceId);
    if (cfg.aiAnalysisEnabled === false) return;

    const deviceState = this.getDeviceState(deviceId);
    const location = this._droneLocationCache[deviceId];
    const subDeviceOnline = cfg._subDeviceOnline;

    this.aiAnalyzer
      .analyzeAlert({
        alertKind,
        deviceId,
        deviceName,
        elapsedMin,
        offlineType: alertKind,
        location,
        subDeviceOnline,
        deviceState,
        preCapturedShots,
      })
      .then((result) => {
        if (!result?.analysis) return;
        console.log(`[AlertService] AI 分析完成 ${deviceName} (${alertKind})`);
        this._sendAiAnalysisWebhook(webhookUrl, deviceName, deviceId, result.analysis);
      })
      .catch((e) => {
        console.error(`[AlertService] AI 分析失败 ${deviceName}:`, e.message);
      });
  }

  _sendFlightSnapshot(webhookUrl, deviceId, deviceName) {
    const regionId = this.resolveRegionId(deviceId);
    captureStreamSnapshot(deviceId, '_flight', 15000, regionId).then((shot) => {
      if (!shot) {
        console.warn(`[AlertService] ${deviceName} 无人机截图失败`);
        return;
      }
      try {
        const md5 = crypto.createHash('md5').update(shot.buffer).digest('hex');
        this._postWebhook(
          webhookUrl,
          JSON.stringify({ msgtype: 'image', image: { base64: shot.base64, md5 } }),
        );
        console.log(`[AlertService] ${deviceName} 无人机截图已发送`);
      } catch (e) {
        console.warn(`[AlertService] ${deviceName} 截图发送失败:`, e.message);
      }
    });
  }
}

module.exports = AlertService;
