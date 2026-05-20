const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const os = require('os');

const CONFIG_FILE = path.join(__dirname, '../haizhuDB/alert-config.json');

class AlertService {
  constructor() {
    // deviceId -> { enabled, thresholdMinutes, webhookUrl, lastOutTime, lastAlertTime,
    //              offlineAlertEnabled, offlineAlertImmediate, offlineRepeatMinutes,
    //              lastOfflineTime, lastOfflineAlertTime }
    this.deviceConfigs = {};
    // deviceId -> 当前是否在舱 (true=在舱)
    this.droneInDockState = {};
    // deviceId -> 机场是否在线 (true=在线)
    this.airportOnlineState = {};
    // 全局 Webhook（可被设备级覆盖）
    this.globalWebhookUrl = '';

    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const data = JSON.parse(raw);
        this.deviceConfigs = data.deviceConfigs || {};
        this.globalWebhookUrl = data.globalWebhookUrl || '';
      }
    } catch (e) {
      console.warn('[AlertService] 配置文件读取失败:', e.message);
    }
  }

  _saveConfig() {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({
        globalWebhookUrl: this.globalWebhookUrl,
        deviceConfigs: this.deviceConfigs
      }, null, 2), 'utf8');
    } catch (e) {
      console.warn('[AlertService] 配置文件保存失败:', e.message);
    }
  }

  // 获取所有配置（供前端展示）
  getConfig() {
    return {
      globalWebhookUrl: this.globalWebhookUrl,
      deviceConfigs: this.deviceConfigs
    };
  }

  // 更新全局 Webhook
  setGlobalWebhook(url) {
    this.globalWebhookUrl = url;
    this._saveConfig();
  }

  // 更新单个设备配置
  setDeviceConfig(deviceId, config) {
    if (!this.deviceConfigs[deviceId]) {
      this.deviceConfigs[deviceId] = {};
    }
    Object.assign(this.deviceConfigs[deviceId], config);
    this._saveConfig();
  }

  // 批量更新设备配置
  updateConfigs({ globalWebhookUrl, deviceConfigs }) {
    if (globalWebhookUrl !== undefined) this.globalWebhookUrl = globalWebhookUrl;
    if (deviceConfigs) {
      Object.entries(deviceConfigs).forEach(([id, cfg]) => {
        this.deviceConfigs[id] = { ...this.deviceConfigs[id], ...cfg };
      });
    }
    this._saveConfig();
  }

  /**
   * 机场在线心跳：每次收到该机场的 OSD 消息时调用，说明机场在线
   * @param {string} deviceId
   * @param {string} deviceName
   */
  onAirportOnline(deviceId, deviceName) {
    const wasOnline = this.airportOnlineState[deviceId];
    this.airportOnlineState[deviceId] = Date.now(); // 记录最后在线时间

    const cfg = this.deviceConfigs[deviceId];
    if (!cfg || !cfg.offlineAlertEnabled) return;

    // 机场恢复在线，重置离线告警计时
    if (wasOnline === 0) {
      console.log(`[AlertService] ${deviceName} 机场恢复在线`);
      const webhookUrl = cfg.webhookUrl || this.globalWebhookUrl;
      if (webhookUrl) {
        this._sendWecomWebhook(webhookUrl, deviceName, deviceId, 0, 'online');
      }
    }
    if (this.deviceConfigs[deviceId]) {
      this.deviceConfigs[deviceId].lastOfflineTime = null;
      this.deviceConfigs[deviceId].lastOfflineAlertTime = null;
    }
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
      const cfg = this.deviceConfigs[deviceId];
      if (!cfg || !cfg.offlineAlertEnabled) return;

      if (now - lastSeen > offlineThresholdMs) {
        const wasOnline = lastSeen !== 0;
        if (wasOnline) {
          // 刚离线
          this.airportOnlineState[deviceId] = 0;
          this.deviceConfigs[deviceId].lastOfflineTime = now;
          this.deviceConfigs[deviceId].lastOfflineAlertTime = null;
          const deviceName = this._getDeviceName(deviceId);
          console.log(`[AlertService] ${deviceName} 机场离线`);

          // 立即推送一次（如果配置了）
          if (cfg.offlineAlertImmediate !== false) {
            const webhookUrl = cfg.webhookUrl || this.globalWebhookUrl;
            if (webhookUrl) {
              this._sendWecomWebhook(webhookUrl, deviceName, deviceId, 0, 'offline_first');
              this.deviceConfigs[deviceId].lastOfflineAlertTime = now;
            }
          }
        }
      }
    });

    // 循环提醒已离线的机场
    Object.entries(this.deviceConfigs).forEach(([deviceId, cfg]) => {
      if (!cfg.offlineAlertEnabled) return;
      if (this.airportOnlineState[deviceId] !== 0) return; // 不是离线状态

      const repeatMs = (cfg.offlineRepeatMinutes || 0) * 60 * 1000;
      if (!repeatMs) return; // 0 = 不循环

      const lastAlert = cfg.lastOfflineAlertTime;
      if (!lastAlert) return;
      if (now - lastAlert < repeatMs) return;

      const deviceName = this._getDeviceName(deviceId);
      const offlineMin = Math.round((now - cfg.lastOfflineTime) / 60000);
      const webhookUrl = cfg.webhookUrl || this.globalWebhookUrl;
      if (webhookUrl) {
        this._sendWecomWebhook(webhookUrl, deviceName, deviceId, offlineMin, 'offline_repeat');
        this.deviceConfigs[deviceId].lastOfflineAlertTime = now;
      }
    });
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
  onDeviceUpdate(deviceId, deviceName, droneInDock, subDeviceOnline) {
    // 缓存设备名
    if (!this._deviceNameCache) this._deviceNameCache = {};
    this._deviceNameCache[deviceId] = deviceName;
    // 记录机场在线
    this.onAirportOnline(deviceId, deviceName);
    if (droneInDock === undefined) return;

    const cfg = this.deviceConfigs[deviceId];
    if (!cfg || !cfg.enabled) return;

    const inDock = droneInDock === 1;
    const isFlying = subDeviceOnline === 1;

    // 回到机巢，重置所有计时
    if (inDock) {
      if (this.droneInDockState[deviceId] === false) {
        console.log(`[AlertService] ${deviceName} 无人机返回机巢`);
      }
      this.droneInDockState[deviceId] = true;
      this.deviceConfigs[deviceId].lastOutTime = null;
      this.deviceConfigs[deviceId].lastAlertTime = null;
      return;
    }

    // 不在舱（无论飞行中还是离线）→ 开始或继续计时
    if (!inDock) {
      // 刚离巢：记录离巢时间
      if (this.droneInDockState[deviceId] !== false) {
        this.droneInDockState[deviceId] = false;
        this.deviceConfigs[deviceId].lastOutTime = Date.now();
        this.deviceConfigs[deviceId].lastAlertTime = null;
        const state = isFlying ? '执行任务中' : '离线';
        console.log(`[AlertService] ${deviceName} 无人机离开机巢（${state}），开始计时`);
        return;
      }

      const thresholdMs = (cfg.thresholdMinutes || 30) * 60 * 1000;
      const outTime = cfg.lastOutTime;
      if (!outTime) {
        this.deviceConfigs[deviceId].lastOutTime = Date.now();
        return;
      }

      const elapsed = Date.now() - outTime;
      if (elapsed < thresholdMs) return;

      // 避免重复告警：上次告警后再等一个阈值时间才再次推送
      const lastAlert = cfg.lastAlertTime;
      if (lastAlert && Date.now() - lastAlert < thresholdMs) return;

      // 超过阈值仍未返回 → 推送飞丢告警
      const elapsedMin = Math.round(elapsed / 60000);
      const webhookUrl = cfg.webhookUrl || this.globalWebhookUrl;
      if (webhookUrl) {
        this._sendWecomWebhook(webhookUrl, deviceName, deviceId, elapsedMin, 'lost');
        this.deviceConfigs[deviceId].lastAlertTime = Date.now();
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
    } else {
      content = `⚠️ **无人机离巢告警**\n> 设备：${deviceName}\n> SN：${deviceId}\n> 无人机已离开机巢 **${elapsedMin} 分钟**，飞机疑似飞丢请检查飞行状态\n> 时间：${time}`;
    }
    const body = JSON.stringify({ msgtype: 'markdown', markdown: { content } });
    this._postWebhook(webhookUrl, body);

    // 飞丢告警同步发送无人机画面截图
    if (type === 'lost') {
      this._sendFlightSnapshot(webhookUrl, deviceId, deviceName);
    }
  }

  _postWebhook(webhookUrl, body) {
    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log(`[AlertService] 企业微信推送结果:`, data));
    });
    req.on('error', e => console.error('[AlertService] 企业微信推送失败:', e.message));
    req.write(body);
    req.end();
  }

  _sendFlightSnapshot(webhookUrl, deviceId, deviceName) {
    const streamUrl = `https://www.hzdkjw.com:1443/live/${deviceId}_flight.live.flv`;
    const tmpFile = path.join(os.tmpdir(), `snapshot_${crypto.randomBytes(6).toString('hex')}.jpg`);
    const args = ['-y', '-i', streamUrl, '-frames:v', '1', '-q:v', '2', '-t', '10', tmpFile];

    execFile('ffmpeg', args, { timeout: 15000 }, (err) => {
      if (err || !fs.existsSync(tmpFile)) {
        console.warn(`[AlertService] ${deviceName} 无人机截图失败:`, err?.message);
        return;
      }
      try {
        const imgBuf = fs.readFileSync(tmpFile);
        const base64 = imgBuf.toString('base64');
        const md5 = crypto.createHash('md5').update(imgBuf).digest('hex');
        fs.unlinkSync(tmpFile);
        const body = JSON.stringify({ msgtype: 'image', image: { base64, md5 } });
        this._postWebhook(webhookUrl, body);
        console.log(`[AlertService] ${deviceName} 无人机截图已发送`);
      } catch (e) {
        console.warn(`[AlertService] ${deviceName} 截图发送失败:`, e.message);
      }
    });
  }
}

module.exports = AlertService;
