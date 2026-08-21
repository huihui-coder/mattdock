const mqtt = require('mqtt');
const { newMqttIds } = require('./lib/live-camera-service');
const { toWsDevicePayload } = require('./lib/ws-device-payload');
const { setAiInfo } = require('./lib/drc-ai-store');
const { setDrcStatus } = require('./lib/drc-status-store');
const fs = require('fs');
const path = require('path');

// 加载HMS告警码映射文件
let hmsMessages = {};
try {
  const hmsPath = path.join(__dirname, '../hms.json');
  const hmsData = fs.readFileSync(hmsPath, 'utf8');
  hmsMessages = JSON.parse(hmsData);
  console.log('[HMS] 已加载告警码映射:', Object.keys(hmsMessages).length, '条');
} catch (err) {
  console.warn('[HMS] 加载告警码映射文件失败:', err.message);
}

class MQTTService {
  constructor(config, wsService, alertService, regionRuntime) {
    this.config = config;
    this.regionId = config.regionId || 'default';
    this.wsService = wsService;
    this.alertService = alertService;
    this.client = null;
    this.regionRuntime = regionRuntime;
    this.onStatusChange = null;
    if (!this.regionRuntime) {
      throw new Error('MQTTService 需要注入 RegionRuntime 实例');
    }
    this.connected = false;
    this.reconnectAttempts = 0;
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pendingServices = new Map();
    /** DRC 下行 seq：gatewaySn -> 下一个 seq */
    this.drcSeqByGateway = new Map();
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout, method: string }>} */
    this.pendingDrc = new Map();
  }

  connect() {
    const protocolVersion = Number(this.config.protocolVersion || process.env.MQTT_PROTOCOL_VERSION || 5);
    const options = {
      clientId: this.config.clientId,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
      keepalive: 60,
      reschedulePings: true,
      protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : 5,
    };

    if (this.config.username) {
      options.username = this.config.username;
    }
    if (this.config.password) {
      options.password = this.config.password;
    }

    console.log(`[MQTT:${this.regionId}] 正在连接到 ${this.config.brokerUrl}...`);
    this.client = mqtt.connect(this.config.brokerUrl, options);

    this.client.on('connect', () => {
      console.log(`[MQTT:${this.regionId}] 连接成功`);
      this.connected = true;
      this.reconnectAttempts = 0;
      this.subscribeTopics();
      this._emitStatus('connected');
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });

    this.client.on('error', (error) => {
      console.error(`[MQTT:${this.regionId}] 连接错误:`, error.message);
      this.connected = false;
      this._emitStatus('error', error.message);
    });

    this.client.on('disconnect', (packet) => {
      console.warn('[MQTT] 收到 DISCONNECT 包，原因码:', packet && packet.reasonCode, packet && packet.properties && packet.properties.reasonString);
    });

    this.client.on('close', () => {
      console.log(`[MQTT:${this.regionId}] 连接关闭`, new Date().toISOString());
      this.connected = false;
      this._emitStatus('disconnected');
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`[MQTT:${this.regionId}] 正在重连... (第 ${this.reconnectAttempts} 次)`);
    });
  }

  _emitStatus(status, error) {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange({ regionId: this.regionId, status, error });
    }
  }

  subscribeTopics() {
    const topics = [
      ...this.config.topics.split(',').map((t) => t.trim()),
      'thing/product/+/services_reply',
      'thing/product/+/drc/up',
      'thing/product/+/events',
    ].filter(Boolean);
    const unique = [...new Set(topics)];
    unique.forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT:${this.regionId}] 订阅失败: ${topic}`, err.message);
        } else {
          console.log(`[MQTT:${this.regionId}] 已订阅主题: ${topic}`);
        }
      });
    });
  }

  handleMessage(topic, message) {
    try {
      const rawMessage = message.toString();
      // console.log(`[MQTT] 收到消息 [${topic}]:`, rawMessage);

      let data;
      try {
        data = JSON.parse(rawMessage);
      } catch (e) {
        console.warn('[MQTT] 消息不是有效JSON，跳过处理');
        return;
      }

      if (topic.includes('/services_reply')) {
        this.handleServicesReply(topic, data);
        return;
      }

      if (topic.includes('/drc/up')) {
        this.handleDrcUp(topic, data);
        return;
      }

      // 判断消息类型：osd / state / events
      const isEvents = topic.includes('/events');
      const isOsd = topic.includes('/osd');
      const isState = topic.endsWith('/state') || topic.includes('/state');

      if (isEvents) {
        // 处理健康告警事件
        this.handleEvents(topic, data);
      } else if (isOsd || isState) {
        const deviceId = this.regionRuntime.extractDeviceId(topic, data);
        if (deviceId && !this.regionRuntime.shouldProcessOnRegionConnection(deviceId, this.regionId)) {
          return;
        }
        // 处理 OSD / state（Dock 分片属性需合并）
        const processedData = this.regionRuntime.processMqttMessage(topic, data, this.regionId);
        if (!processedData) return;

        // 广播到WebSocket客户端
        if (this.wsService) {
          const { regionId, regionName } = this.regionRuntime.resolveDeviceRegionForBroadcast(
            processedData.deviceId,
            this.regionId,
          );
          const unmappedMeta = regionId == null
            ? this.regionRuntime._flightUnmappedMeta(this.regionId)
            : {};
          this.wsService.broadcast({
            type: 'device_data',
            processed: toWsDevicePayload({
              ...processedData,
              regionId,
              regionName: regionId ? (processedData.regionName || regionName) : null,
              ...unmappedMeta,
            }),
            timestamp: new Date().toISOString(),
          });
        }

        // 检查告警
        if (processedData.alerts && processedData.alerts.length > 0) {
          this.handleAlerts(topic, processedData);
        }

        // 离巢告警检测
        if (this.alertService) {
          const droneInDock = processedData.metrics.droneInDock?.value;
          const subDeviceOnline = processedData.metrics.subDeviceOnline?.value;
          this.alertService.onDeviceUpdate(
            processedData.deviceId,
            processedData.deviceName,
            droneInDock,
            subDeviceOnline,
            this.regionId,
          );
          // 缓存无人机位置（无人机设备有 location 且 gateway 指向机场）
          if (processedData.deviceType === 'drone' && processedData.location && processedData.gateway) {
            this.alertService.updateDroneLocation(processedData.gateway, processedData.location);
          }
        }
      }

    } catch (error) {
      console.error('[MQTT] 处理消息错误:', error);
    }
  }

  handleServicesReply(topic, data) {
    const tid = data?.tid;

    if (!tid || !this.pendingServices.has(tid)) return;

    const pending = this.pendingServices.get(tid);
    clearTimeout(pending.timer);
    this.pendingServices.delete(tid);

    const result = data?.data?.result;
    if (result !== undefined && result !== 0) {
      pending.reject(new Error(`设备返回错误码: ${result}`));
      return;
    }
    pending.resolve(data);
  }

  nextDrcSeq(gatewaySn) {
    const id = String(gatewaySn || '');
    const next = (this.drcSeqByGateway.get(id) || 0) + 1;
    this.drcSeqByGateway.set(id, next);
    return next;
  }

  pendingDrcKey(gatewaySn, method, seq) {
    return `${gatewaySn}|${method}|${Number(seq)}`;
  }

  /**
   * 处理 DRC 上行：指令应答 + AI 信息推送
   * 官方：thing/product/{gateway_sn}/drc/up
   */
  handleDrcUp(topic, data) {
    const parts = String(topic || '').split('/');
    const gatewaySn = parts[2];
    const method = data?.method;
    const seqRaw = data?.seq ?? data?.data?.seq ?? data?.data?.output?.seq;
    const seq = seqRaw === undefined || seqRaw === null ? null : Number(seqRaw);
    const result = data?.data?.result;

    if (method === 'drc_ai_info_push' && gatewaySn) {
      const info = setAiInfo(gatewaySn, data?.data || {});
      const names = (info?.models || [])
        .map((m) => `${m.index}:${m.name}`)
        .join(', ');
      console.log(
        `[DRC] ${gatewaySn} ai_info_push models=${info?.models?.length || 0} selected=${info?.selectedIndex} [${names}]`,
        JSON.stringify(data?.data || {}),
      );
      if (this.wsService && info) {
        this.wsService.broadcast({
          type: 'drc_ai_info',
          deviceId: gatewaySn,
          gatewaySn,
          info,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // 指令应答：优先 method+seq；兼容设备不回 seq 时按 method 匹配最早 pending
    if (method && gatewaySn && this.pendingDrc.size > 0) {
      let key = seq != null && Number.isFinite(seq)
        ? this.pendingDrcKey(gatewaySn, method, seq)
        : null;
      let pending = key ? this.pendingDrc.get(key) : null;

      if (!pending) {
        for (const [k, p] of this.pendingDrc.entries()) {
          if (k.startsWith(`${gatewaySn}|${method}|`)) {
            key = k;
            pending = p;
            break;
          }
        }
      }

      if (pending) {
        clearTimeout(pending.timer);
        this.pendingDrc.delete(key);
        if (result !== undefined && result !== 0) {
          console.warn(`[DRC] ${gatewaySn} ${method} seq=${seq} result=${result}`);
          pending.reject(new Error(`DRC ${method} 设备返回错误码: ${result}`));
        } else {
          console.log(`[DRC] ${gatewaySn} ${method} seq=${seq} 应答成功`);
          pending.resolve(data);
        }
        return;
      }

      console.log(`[DRC] ${gatewaySn} 未匹配 pending: method=${method} seq=${seq}`, data?.data);
    }

    if (this.wsService && method && gatewaySn) {
      this.wsService.broadcast({
        type: 'drc_up',
        deviceId: gatewaySn,
        gatewaySn,
        method,
        seq,
        result,
        data: data?.data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 下发 DRC（不等待应答）
   * Topic: thing/product/{gateway_sn}/drc/down
   */
  publishDrc(gatewaySn, method, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error(`MQTT 未连接（${this.regionId}）`));
        return;
      }
      const sn = String(gatewaySn || '').trim();
      if (!sn) {
        reject(new Error('缺少 gateway_sn'));
        return;
      }
      const seq = this.nextDrcSeq(sn);
      const payload = {
        seq,
        method,
        data: data == null ? {} : data,
      };
      const topic = `thing/product/${sn}/drc/down`;
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`[DRC] 已下发 ${method} -> ${sn} seq=${seq}`, data);
          resolve({ method, gatewaySn: sn, seq });
        }
      });
    });
  }

  /**
   * 下发 DRC 并等待同 method(+seq) 的 drc/up 应答。
   * 若 MQTT 已发出但应答超时，默认仍视为下发成功（设备侧有时不回 seq）。
   */
  invokeDrc(gatewaySn, method, data = {}, timeoutMs = 10000, options = {}) {
    const resolveOnTimeout = options.resolveOnTimeout !== false;
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error(`MQTT 未连接（${this.regionId}）`));
        return;
      }
      const sn = String(gatewaySn || '').trim();
      if (!sn) {
        reject(new Error('缺少 gateway_sn'));
        return;
      }
      const seq = this.nextDrcSeq(sn);
      const key = this.pendingDrcKey(sn, method, seq);
      const payload = {
        seq,
        method,
        data: data == null ? {} : data,
      };
      const topic = `thing/product/${sn}/drc/down`;

      const timer = setTimeout(() => {
        this.pendingDrc.delete(key);
        if (resolveOnTimeout) {
          console.warn(`[DRC] ${sn} ${method} seq=${seq} 应答超时，按已下发处理`);
          resolve({
            method,
            gatewaySn: sn,
            seq,
            timedOut: true,
            data: { result: 0, note: 'timeout_after_publish' },
          });
          return;
        }
        reject(new Error(`等待 DRC 应答超时: ${method}`));
      }, timeoutMs);

      this.pendingDrc.set(key, {
        resolve: (reply) => {
          resolve({ ...reply, method, gatewaySn: sn, seq, timedOut: false });
        },
        reject,
        timer,
        method,
      });

      this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingDrc.delete(key);
          reject(err);
          return;
        }
        console.log(`[DRC] 已下发(等待应答) ${method} -> ${sn} seq=${seq}`, data);
      });
    });
  }

  /**
   * 仅下发 services，不等待 services_reply（告警截图等长流程用，避免阻塞）
   */
  publishService(gatewaySn, method, data) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error(`MQTT 未连接（${this.regionId}）`));
        return;
      }

      const { bid, tid } = newMqttIds();
      const payload = {
        bid,
        tid,
        timestamp: Date.now(),
        method,
        data,
      };
      const topic = `thing/product/${gatewaySn}/services`;

      this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`[MQTT] 已下发 ${method} -> ${gatewaySn}`, data);
          resolve({ method, gatewaySn, tid });
        }
      });
    });
  }

  /** 下发 DJI services 并等待 services_reply */
  invokeService(gatewaySn, method, data, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error(`MQTT 未连接（${this.regionId}）`));
        return;
      }

      const { bid, tid } = newMqttIds();
      const payload = {
        bid,
        tid,
        timestamp: Date.now(),
        method,
        data,
      };
      const topic = `thing/product/${gatewaySn}/services`;

      const timer = setTimeout(() => {
        this.pendingServices.delete(tid);
        reject(new Error('等待设备应答超时'));
      }, timeoutMs);

      this.pendingServices.set(tid, { resolve, reject, timer, requestData: data });

      this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingServices.delete(tid);
          reject(err);
        } else {
          console.log(`[MQTT] 已下发 ${method} -> ${gatewaySn}`, data);
        }
      });
    });
  }

  /**
   * 从当前 MQTT 连接配置构造 drc_mode_enter.mqtt_broker
   * 默认复用业务 broker；可用 DRC_MQTT_* 环境变量覆盖
   */
  buildDrcBrokerInfo(gatewaySn) {
    const sn = String(gatewaySn || '').trim();
    const envAddr = (process.env.DRC_MQTT_ADDRESS || '').trim();
    const envUser = process.env.DRC_MQTT_USERNAME;
    const envPass = process.env.DRC_MQTT_PASSWORD;
    const envTls = process.env.DRC_MQTT_ENABLE_TLS;

    let address = envAddr;
    let enableTls = envTls === '1' || String(envTls).toLowerCase() === 'true';

    if (!address) {
      const url = String(this.config.brokerUrl || '');
      try {
        const u = new URL(url);
        const host = u.hostname;
        const port = u.port || (u.protocol === 'mqtts:' || u.protocol === 'ssl:' || u.protocol === 'tls:' ? '8883' : '1883');
        address = `${host}:${port}`;
        if (envTls === undefined || envTls === '') {
          enableTls = u.protocol === 'mqtts:' || u.protocol === 'ssl:' || u.protocol === 'tls:';
        }
      } catch {
        address = url.replace(/^mqtts?:\/\//i, '').replace(/\/$/, '');
        if (envTls === undefined || envTls === '') {
          enableTls = /^mqtts:/i.test(url);
        }
      }
    }

    const expireSec = Number(process.env.DRC_MQTT_EXPIRE_SEC || 24 * 3600);
    const expireTime = Math.floor(Date.now() / 1000) + (Number.isFinite(expireSec) ? expireSec : 86400);

    return {
      address,
      client_id: (process.env.DRC_MQTT_CLIENT_ID_PREFIX || 'drc-') + sn,
      username: envUser != null && envUser !== '' ? envUser : (this.config.username || ''),
      password: envPass != null && envPass !== '' ? envPass : (this.config.password || ''),
      expire_time: expireTime,
      enable_tls: !!enableTls,
    };
  }

  /**
   * 进入指令飞行 / DRC 模式
   * Topic: thing/product/{gateway_sn}/services · method=drc_mode_enter
   */
  _broadcastDrcStatus(sn, status) {
    if (!this.wsService || !status) return;
    this.wsService.broadcast({
      type: 'drc_status',
      deviceId: sn,
      gatewaySn: sn,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  /** DRC 心跳：进入成功后约 1Hz，超时未收到会退链路 */
  startDrcHeartbeat(gatewaySn) {
    const sn = String(gatewaySn || '').trim();
    if (!sn) return;
    this.stopDrcHeartbeat(sn);
    if (!this._drcHeartbeatTimers) this._drcHeartbeatTimers = new Map();
    const tick = () => {
      this.publishDrc(sn, 'heart_beat', { timestamp: Date.now() }).catch((err) => {
        console.warn(`[DRC] ${sn} heart_beat 失败:`, err.message);
      });
    };
    tick();
    this._drcHeartbeatTimers.set(sn, setInterval(tick, 1000));
    console.log(`[DRC] ${sn} 已启动 heart_beat (1Hz)`);
  }

  stopDrcHeartbeat(gatewaySn) {
    const sn = String(gatewaySn || '').trim();
    if (!sn || !this._drcHeartbeatTimers) return;
    const t = this._drcHeartbeatTimers.get(sn);
    if (t) {
      clearInterval(t);
      this._drcHeartbeatTimers.delete(sn);
      console.log(`[DRC] ${sn} 已停止 heart_beat`);
    }
  }

  /**
   * DRC 初始状态订阅（链路已连接后）
   * Topic: thing/product/{gateway_sn}/drc/down · method=drc_initial_state_subscribe
   */
  async subscribeDrcInitialState(gatewaySn, timeoutMs = 10000) {
    const sn = String(gatewaySn || '').trim();
    if (!sn) throw new Error('缺少 gateway_sn');
    const reply = await this.invokeDrc(sn, 'drc_initial_state_subscribe', {}, timeoutMs);
    console.log(`[DRC] ${sn} initial_state_subscribe 完成`, reply?.data ?? reply);
    return reply;
  }

  /** 状态变为已连接(2)时：心跳 + 初始状态订阅（幂等） */
  onDrcConnected(gatewaySn) {
    const sn = String(gatewaySn || '').trim();
    if (!sn) return;
    this.startDrcHeartbeat(sn);
    if (!this._drcInitialSubscribed) this._drcInitialSubscribed = new Set();
    if (this._drcInitialSubscribed.has(sn)) return;
    this._drcInitialSubscribed.add(sn);
    this.subscribeDrcInitialState(sn).catch((err) => {
      this._drcInitialSubscribed.delete(sn);
      console.warn(`[DRC] ${sn} initial_state_subscribe 失败:`, err.message);
    });
  }

  onDrcDisconnected(gatewaySn) {
    const sn = String(gatewaySn || '').trim();
    if (!sn) return;
    this.stopDrcHeartbeat(sn);
    this._drcInitialSubscribed?.delete(sn);
  }

  async enterDrcMode(gatewaySn, options = {}) {
    const sn = String(gatewaySn || '').trim();
    if (!sn) throw new Error('缺少 gateway_sn');
    const mqttBroker = this.buildDrcBrokerInfo(sn);
    if (!mqttBroker.address) {
      throw new Error('无法构造 mqtt_broker.address，请检查 MQTT 配置或 DRC_MQTT_ADDRESS');
    }
    const data = {
      mqtt_broker: mqttBroker,
      osd_frequency: Number(options.osdFrequency || process.env.DRC_OSD_FREQUENCY || 10),
      hsi_frequency: Number(options.hsiFrequency || process.env.DRC_HSI_FREQUENCY || 1),
    };
    this._broadcastDrcStatus(sn, setDrcStatus(sn, { drc_state: 1, result: 0 }));
    try {
      const reply = await this.invokeService(sn, 'drc_mode_enter', data, options.timeoutMs || 20000);
      // 真正「已连接」以 events/drc_status_notify=2 为准；此处先起心跳，避免等待期间掉链
      this.startDrcHeartbeat(sn);
      return {
        reply,
        mqttBroker: { ...mqttBroker, password: mqttBroker.password ? '***' : '' },
      };
    } catch (err) {
      this.onDrcDisconnected(sn);
      this._broadcastDrcStatus(sn, setDrcStatus(sn, { drc_state: 0, result: null }));
      const msg = String(err?.message || err || '');
      if (/514304/.test(msg)) {
        throw new Error(
          `${msg}（机场连不上 mqtt_broker ${mqttBroker.address}：检查机场网络、EMQX 账号 ACL、是否需独立 DRC 账号）`,
        );
      }
      throw err;
    }
  }

  /** 退出 DRC 模式 */
  async exitDrcMode(gatewaySn, timeoutMs = 15000) {
    const sn = String(gatewaySn || '').trim();
    if (!sn) throw new Error('缺少 gateway_sn');
    this.onDrcDisconnected(sn);
    const reply = await this.invokeService(sn, 'drc_mode_exit', {}, timeoutMs);
    this._broadcastDrcStatus(sn, setDrcStatus(sn, { drc_state: 0, result: 0 }));
    return { reply };
  }

  /**
   * 处理 events：DRC 状态 + HMS 健康告警
   */
  handleEvents(topic, data) {
    // 从主题提取设备ID: thing/product/{gateway_sn}/events
    const topicParts = topic.split('/');
    const deviceId = topicParts[2];
    if (deviceId && !this.regionRuntime.shouldProcessOnRegionConnection(deviceId, this.regionId)) {
      return;
    }

    // DRC 链路状态
    if (data?.method === 'drc_status_notify') {
      const status = setDrcStatus(deviceId, data.data || {});
      console.log(
        `[DRC] ${deviceId} status_notify state=${status?.drcState} (${status?.drcStateText})`,
      );
      if (status?.drcState === 2) {
        this.onDrcConnected(deviceId);
      } else if (status?.drcState === 0) {
        this.onDrcDisconnected(deviceId);
      }
      this._broadcastDrcStatus(deviceId, status);
      return;
    }

    const proc = this.regionRuntime.getProcessorForDevice(deviceId);
    const deviceName = proc?.getDeviceName(deviceId) || deviceId;

    // 解析健康告警 - 格式: method: "hms", data.list
    const healthAlerts = [];
    
    // 检查是否为hms健康告警
    if (data.method === 'hms' && data.data?.list) {
      const list = data.data.list;
      
      list.forEach(item => {
        const levelMap = { 0: 'info', 1: 'notice', 2: 'warning' };
        const levelTextMap = { 0: '通知', 1: '提醒', 2: '警告' };
        const moduleMap = { 0: '飞行任务', 1: '设备管理', 2: '媒体', 3: 'hms' };
        
        healthAlerts.push({
          code: item.code || 'UNKNOWN',
          level: levelMap[item.level] || 'warning',
          levelText: levelTextMap[item.level] || '警告',
          module: moduleMap[item.module] || '未知',
          inTheSky: item.in_the_sky === 1,
          deviceType: item.device_type || '',
          imminent: item.imminent === 1,
          args: item.args || {},
          message: this.formatHmsMessage(item.code, item.args),
          timestamp: data.timestamp || new Date().toISOString()
        });
      });
    }

    // 广播健康告警
    if (healthAlerts.length > 0 && this.wsService) {
      const { regionId } = this.regionRuntime.resolveDeviceRegionForBroadcast(deviceId, this.regionId);
      this.wsService.broadcast({
        type: 'health_alert',
        topic: topic,
        deviceId: deviceId,
        deviceName: deviceName,
        regionId,
        healthAlerts: healthAlerts,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 格式化HMS告警消息
   */
  formatHmsMessage(code, args) {
    // 尝试多种格式匹配
    // 1. 直接匹配
    if (hmsMessages[code] && hmsMessages[code].zh) {
      return hmsMessages[code].zh;
    }
    
    // 2. 十六进制格式转换
    if (code.startsWith('0x') || code.startsWith('0X')) {
      // 尝试 dock_tip_ 前缀
      const dockTipCode = `dock_tip_${code}`;
      if (hmsMessages[dockTipCode] && hmsMessages[dockTipCode].zh) {
        return hmsMessages[dockTipCode].zh;
      }
      // 尝试 fpv_tip_ 前缀
      const fpvTipCode = `fpv_tip_${code}`;
      if (hmsMessages[fpvTipCode] && hmsMessages[fpvTipCode].zh) {
        return hmsMessages[fpvTipCode].zh;
      }
    }
    
    // 3. 添加前缀尝试匹配
    const dockTipCode = `dock_tip_${code}`;
    if (hmsMessages[dockTipCode] && hmsMessages[dockTipCode].zh) {
      return hmsMessages[dockTipCode].zh;
    }
    const fpvTipCode = `fpv_tip_${code}`;
    if (hmsMessages[fpvTipCode] && hmsMessages[fpvTipCode].zh) {
      return hmsMessages[fpvTipCode].zh;
    }
    
    // 默认格式：显示告警代码
    return `设备告警 (${code})`;
  }

  handleAlerts(topic, processedData) {
    const { regionId } = this.regionRuntime.resolveDeviceRegionForBroadcast(
      processedData.deviceId,
      this.regionId,
    );
    processedData.alerts.forEach(alert => {
      if (this.wsService) {
        this.wsService.broadcast({
          type: 'alert',
          topic: topic,
          deviceId: processedData.deviceId,
          deviceName: processedData.deviceName,
          regionId,
          alert: alert,
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      console.log('[MQTT] 已断开连接');
    }
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = MQTTService;
