const MQTTService = require('../mqtt-service');
const { readRegions } = require('./region-store');
const { resolveConnectivity, shouldConnectRegion } = require('./region-connectivity');

class MQTTManager {
  constructor(wsService, alertService, regionRuntime) {
    this.wsService = wsService;
    this.alertService = alertService;
    this.regionRuntime = regionRuntime;
    /** @type {Map<string, MQTTService>} */
    this.connections = new Map();
    this.onConnectionChange = null;
  }

  connectAll() {
    this.disconnectAll(false);
    const regions = readRegions();
    for (const region of regions) {
      if (!shouldConnectRegion(region.id)) continue;
      const cfg = resolveConnectivity(region.id).mqtt;
      if (!cfg.brokerUrl) continue;
      if (!cfg.username || !cfg.password) {
        console.warn(
          `[MQTT] 区域 ${region.id} 跳过连接：缺少账号或密码（请在「数据连接」填写或检查 .env）`,
        );
        continue;
      }
      const service = new MQTTService({
        regionId: region.id,
        brokerUrl: cfg.brokerUrl,
        username: cfg.username,
        password: cfg.password,
        clientId: cfg.clientId,
        topics: cfg.topics,
        protocolVersion: cfg.protocolVersion,
      }, this.wsService, this.alertService, this.regionRuntime);
      service.onStatusChange = () => this._notifyStatusChange();
      service.connect();
      this.connections.set(region.id, service);
      console.log(
        `[MQTT] 区域 ${region.id} → ${cfg.brokerUrl} clientId=${cfg.clientId} user=${cfg.username} mqttv=${cfg.protocolVersion || 5}`,
      );
    }
    this._notifyStatusChange();
  }

  reload() {
    this.connectAll();
  }

  disconnectAll(notify = true) {
    for (const service of this.connections.values()) {
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
    return this.getForRegion(regionId) || this.connections.values().next().value || null;
  }

  isConnected() {
    for (const service of this.connections.values()) {
      if (service.isConnected()) return true;
    }
    return false;
  }

  isRegionConnected(regionId) {
    return !!this.getForRegion(regionId)?.isConnected();
  }

  getStatus() {
    const regions = [];
    for (const [regionId, service] of this.connections.entries()) {
      const cfg = resolveConnectivity(regionId).mqtt;
      regions.push({
        regionId,
        connected: service.isConnected(),
        broker: cfg.brokerUrl,
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
    return service.invokeService(deviceId, method, data, timeoutMs);
  }

  publishService(deviceId, method, data) {
    const service = this.getForDevice(deviceId);
    if (!service) throw new Error('该区域 MQTT 未配置或未连接');
    return service.publishService(deviceId, method, data);
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
