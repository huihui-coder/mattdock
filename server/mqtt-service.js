const mqtt = require('mqtt');
const { newMqttIds } = require('./lib/live-camera-service');
const { setLiveCameraPosition } = require('./lib/dock-live-state-store');
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
  constructor(config, wsService, alertService, processor) {
    this.config = config;
    this.wsService = wsService;
    this.alertService = alertService;
    this.client = null;
    this.processor = processor;
    if (!this.processor) {
      throw new Error('MQTTService 需要注入共享 DeviceProcessor 实例');
    }
    this.connected = false;
    this.reconnectAttempts = 0;
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pendingServices = new Map();
  }

  connect() {
    const options = {
      clientId: this.config.clientId,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
      keepalive: 60,
      reschedulePings: true,
      protocolVersion: 5,
    };

    if (this.config.username) {
      options.username = this.config.username;
    }
    if (this.config.password) {
      options.password = this.config.password;
    }

    console.log(`[MQTT] 正在连接到 ${this.config.brokerUrl}...`);
    this.client = mqtt.connect(this.config.brokerUrl, options);

    this.client.on('connect', () => {
      console.log('[MQTT] 连接成功');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.subscribeTopics();
      
      // 通知WebSocket客户端连接状态
      if (this.wsService) {
        this.wsService.broadcast({
          type: 'connection',
          status: 'connected',
          timestamp: new Date().toISOString()
        });
      }
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });

    this.client.on('error', (error) => {
      console.error('[MQTT] 连接错误:', error.message);
      this.connected = false;
      
      if (this.wsService) {
        this.wsService.broadcast({
          type: 'connection',
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    this.client.on('disconnect', (packet) => {
      console.warn('[MQTT] 收到 DISCONNECT 包，原因码:', packet && packet.reasonCode, packet && packet.properties && packet.properties.reasonString);
    });

    this.client.on('close', () => {
      console.log('[MQTT] 连接关闭', new Date().toISOString());
      this.connected = false;
      
      if (this.wsService) {
        this.wsService.broadcast({
          type: 'connection',
          status: 'disconnected',
          timestamp: new Date().toISOString()
        });
      }
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`[MQTT] 正在重连... (第 ${this.reconnectAttempts} 次)`);
    });
  }

  subscribeTopics() {
    const topics = [
      ...this.config.topics.split(',').map((t) => t.trim()),
      'thing/product/+/services_reply',
    ].filter(Boolean);
    const unique = [...new Set(topics)];
    unique.forEach((topic) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] 订阅失败: ${topic}`, err.message);
        } else {
          console.log(`[MQTT] 已订阅主题: ${topic}`);
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

      // 判断消息类型：osd / state / events
      const isEvents = topic.includes('/events');
      const isOsd = topic.includes('/osd');
      const isState = topic.endsWith('/state') || topic.includes('/state');

      if (isEvents) {
        // 处理健康告警事件
        this.handleEvents(topic, data);
      } else if (isOsd || isState) {
        // 处理 OSD / state（Dock 分片属性需合并，如 supplement_light_state、live_status）
        const processedData = this.processor.process(topic, data);

        // 广播到WebSocket客户端
        if (this.wsService) {
          this.wsService.broadcast({
            type: 'device_data',
            topic: topic,
            raw: data,
            processed: processedData,
            timestamp: new Date().toISOString()
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
          this.alertService.onDeviceUpdate(processedData.deviceId, processedData.deviceName, droneInDock, subDeviceOnline);
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
    const parts = topic.split('/');
    const gatewaySn = parts[2];
    const method = data?.method;

    // 任意来源的 live_camera_change 应答（含司空）——记录当前推流相机
    if (method === 'live_camera_change') {
      const pos =
        data?.data?.output?.camera_position ??
        data?.data?.camera_position ??
        (tid && this.pendingServices.has(tid) ? this.pendingServices.get(tid).requestData?.camera_position : undefined);
      const normalized = pos === 0 || pos === 1 ? pos : null;
      if (normalized !== null && gatewaySn) {
        setLiveCameraPosition(gatewaySn, normalized, 'services_reply');
        const updated = this.processor.patchDockControlState(gatewaySn, {
          liveCameraPosition: normalized,
        });
        if (updated && this.wsService) {
          this.wsService.broadcast({
            type: 'device_data',
            topic: `thing/product/${gatewaySn}/osd`,
            raw: { data: updated.osdSnapshot || {} },
            processed: updated,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

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

    if (this.wsService && method === 'live_camera_change') {
      this.wsService.broadcast({
        type: 'live_camera_change_reply',
        deviceId: gatewaySn,
        method,
        result,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 仅下发 services，不等待 services_reply（告警截图等长流程用，避免阻塞）
   */
  publishService(gatewaySn, method, data) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('MQTT 未连接'));
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

  /**
   * 下发 DJI services（如 live_camera_change）
   */
  invokeService(gatewaySn, method, data, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('MQTT 未连接'));
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
   * 处理健康告警事件
   */
  handleEvents(topic, data) {
    // 从主题提取设备ID: thing/product/{gateway_sn}/events
    const topicParts = topic.split('/');
    const deviceId = topicParts[2];

    const deviceName = this.processor.getDeviceName(deviceId);

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
      this.wsService.broadcast({
        type: 'health_alert',
        topic: topic,
        deviceId: deviceId,
        deviceName: deviceName,
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
    processedData.alerts.forEach(alert => {
      if (this.wsService) {
        this.wsService.broadcast({
          type: 'alert',
          topic: topic,
          deviceId: processedData.deviceId,
          deviceName: processedData.deviceName,
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
