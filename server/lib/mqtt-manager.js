const MQTTService = require('../mqtt-service');
const { readRegions } = require('./region-store');
const {
  resolveConnectivity,
  shouldConnectRegion,
  getMqttConnectionKey,
} = require('./region-connectivity');

class MQTTManager {
  constructor(wsService, alertService, regionRuntime) {
    this.wsService = wsService;
    this.alertService = alertService;
    this.regionRuntime = regionRuntime;
    /** @type {Map<string, MQTTService>} regionId -> 连接（同配置池复用同一实例） */
    this.connections = new Map();
    this.onConnectionChange = null;
  }

  connectAll() {
    this.disconnectAll(false);
    const regions = readRegions();
    /** @type {Map<string, MQTTService>} connectionKey -> 共享连接 */
    const pool = new Map();

    for (const region of regions) {
      if (!shouldConnectRegion(region.id)) continue;
      const resolved = resolveConnectivity(region.id);
      const cfg = resolved.mqtt;
      if (!cfg.brokerUrl) continue;
      if (!cfg.username || !cfg.password) {
        console.warn(
          `[MQTT] 区域 ${region.id} 跳过连接：缺少账号或密码（请在「数据连接」填写或检查 .env）`,
        );
        continue;
      }

      const connectionKey = getMqttConnectionKey(region.id);
      let service = pool.get(connectionKey);
      if (!service) {
        service = new MQTTService({
          regionId: connectionKey,
          brokerUrl: cfg.brokerUrl,
          username: cfg.username,
          password: cfg.password,
          clientId: cfg.clientId,
          topics: cfg.topics,
          protocolVersion: cfg.protocolVersion,
        }, this.wsService, this.alertService, this.regionRuntime);
        service.onStatusChange = () => this._notifyStatusChange();
        service.connect();
        pool.set(connectionKey, service);
        console.log(
          `[MQTT] 连接池 ${connectionKey} → ${cfg.brokerUrl} clientId=${cfg.clientId} user=${cfg.username} mqttv=${cfg.protocolVersion || 5}`,
        );
      } else {
        console.log(`[MQTT] 区域 ${region.id} 复用连接池 ${connectionKey}`);
      }
      this.connections.set(region.id, service);
    }
    this._notifyStatusChange();
  }

  reload() {
    this.connectAll();
  }

  disconnectAll(notify = true) {
    const seen = new Set();
    for (const service of this.connections.values()) {
      if (seen.has(service)) continue;
      seen.add(service);
      service.disconnect();
    }
    this.connections.clear();
    if (notify) this._notifyStatusChange();
  }

  disconnect() {
    this.disconnectAll(true);
  }

  reconnect() {
    this.connectAll();
  }

  getForRegion(regionId) {
    return this.connections.get(regionId) || null;
  }

  getForDevice(deviceId) {
    const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
    if (regionId) {
      const service = this.getForRegion(regionId);
      if (service) return service;
    }
    const sinkId = this.regionRuntime.getUnmappedSinkRegionId();
    return this.getForRegion(sinkId) || this.connections.values().next().value || null;
  }

  isConnected() {
    const seen = new Set();
    for (const service of this.connections.values()) {
      if (seen.has(service)) continue;
      seen.add(service);
      if (service.isConnected()) return true;
    }
    return false;
  }

  isRegionConnected(regionId) {
    return !!this.getForRegion(regionId)?.isConnected();
  }

  getStatus() {
    const regions = [];
    const seen = new Set();
    for (const [regionId, service] of this.connections.entries()) {
      const resolved = resolveConnectivity(regionId);
      const connectionKey = getMqttConnectionKey(regionId);
      const pooled = seen.has(service);
      if (!pooled) seen.add(service);
      regions.push({
        regionId,
        connectionKey,
        mqttProfileId: resolved.mqttProfileId || null,
        connected: service.isConnected(),
        broker: resolved.mqtt.brokerUrl,
        pooled: pooled,
      });
    }
    return {
      connected: regions.some((r) => r.connected),
      regions,
    };
  }

  invokeService(deviceId, method, data, timeoutMs) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.invokeService(deviceId, method, data, timeoutMs);
  }

  publishService(deviceId, method, data) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.publishService(deviceId, method, data);
  }

  invokeDrc(deviceId, method, data, timeoutMs) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.invokeDrc(deviceId, method, data, timeoutMs);
  }

  publishDrc(deviceId, method, data) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.publishDrc(deviceId, method, data);
  }

  enterDrcMode(deviceId, options) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.enterDrcMode(deviceId, options);
  }

  exitDrcMode(deviceId, timeoutMs) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.exitDrcMode(deviceId, timeoutMs);
  }

  subscribeDrcInitialState(deviceId, timeoutMs) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    if (!service.isConnected()) {
      const regionId = this.regionRuntime.resolveRegionIdForDevice(deviceId);
      const key = regionId ? getMqttConnectionKey(regionId) : 'default';
      throw new Error(`MQTT 未连接（${key}）`);
    }
    return service.subscribeDrcInitialState(deviceId, timeoutMs);
  }

  _notifyStatusChange() {
    if (!this.wsService) return;
    const status = this.getStatus();
    this.wsService.broadcast({
      type: 'connection',
      status: status.connected ? 'connected' : 'disconnected',
      mqtt: status,
      timestamp: new Date().toISOString(),
    });
    if (typeof this.onConnectionChange === 'function') {
      this.onConnectionChange(status);
    }
  }
}

module.exports = { MQTTManager };
