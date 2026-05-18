const mqtt = require('mqtt');
const DeviceProcessor = require('./device-processor');
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
  constructor(config, wsService, alertService) {
    this.config = config;
    this.wsService = wsService;
    this.alertService = alertService;
    this.client = null;
    this.processor = new DeviceProcessor();
    this.connected = false;
    this.reconnectAttempts = 0;
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
    const topics = this.config.topics.split(',').map(t => t.trim());
    topics.forEach(topic => {
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

      // 判断消息类型：osd 或 events
      const isEvents = topic.includes('/events');
      const isOsd = topic.includes('/osd');

      if (isEvents) {
        // 处理健康告警事件
        this.handleEvents(topic, data);
      } else if (isOsd) {
        // 处理OSD数据
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
        }
      }

    } catch (error) {
      console.error('[MQTT] 处理消息错误:', error);
    }
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
      console.log(`[健康告警] 设备 ${deviceName}: ${healthAlerts.length} 条告警`);
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
      console.warn(`[告警] ${alert.level.toUpperCase()}: ${alert.message}`);
      
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
