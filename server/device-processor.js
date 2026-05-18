/**
 * 设备数据处理模块
 * 解析JSON数据并判断设备状态
 */

class DeviceProcessor {
  constructor(customThresholds = {}) {
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
    // 设备名称映射 - 海珠机场设备
    this.deviceNames = {
      '8UUXP3B00A10VD': '南洲-Dock3-M4TD',
      '7CTDM1200B453R': '华洲-Dock2-M3TD',
      'NEST20202412U002': '沙园-充电-M3T',
      'NEST44202512U014': '区府-换电-M4T',
      'AHRXNAH00A01C6': '凤阳-Dock3-M4TD',
      'AHRXNAH00A01DF': '华洲-Dock3-M4TD',
      'AHRXNAH00A0192': '江南中-Dock3-M4TD',
      'AHRXNAH00A01CE': '金碧二中-Dock3-M4TD',
      'NEST15202602U001-1': '会展-双机换电1号-M4T',
      'NEST15202602U001-2': '会展-双机换电2号-M4T',
      'AHRXNAH00A019F': '官洲-Dock3-M4TD',
      'AHRXNAH00A01DM': '新看守-Dock3-M4TD',
      'AHRXNAH00A019D': '三中-Dock3-M4TD',
      'NEST44202602U002': '艺术博物馆-换电-M4T',
      'AHRXNAH00A018Z': '分局-Dock3-M4TD',
    };

    // 从 process.env 动态合并 DEVICE_* 配置（优先级高于硬编码）
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('DEVICE_')) {
        const deviceId = key.slice(7);
        this.deviceNames[deviceId] = process.env[key];
      }
    });
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

  /**
   * 处理设备数据
   * @param {string} topic - MQTT主题
   * @param {object} data - JSON数据
   * @returns {object} 处理后的数据
   */
  process(topic, data) {
    const deviceId = this.extractDeviceId(topic, data);
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

    // 判断设备类型：无人机设备ID以1581F开头，机场设备以NEST或8UUXN开头
    const isDrone = deviceId.startsWith('1581F');
    result.deviceType = isDrone ? 'drone' : 'airport';

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

    // 获取之前的状态
    const prevState = this.deviceStates.get(deviceId);

    // 如果当前消息没有电池槽数据，使用之前的数据（避免状态跳变）
    if (!result.metrics.batterySlots && prevState?.metrics?.batterySlots) {
      result.metrics.batterySlots = prevState.metrics.batterySlots;
    }

    // 计算整体状态 - 根据风速和电池槽状态判断
    result.status = this.calculateOverallStatus(result.metrics, prevState);
    result.statusText = this.getStatusText(result.status);

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
    const mergedResult = {
      ...result,
      // 合并指标：保留之前存在的指标，更新新收到的指标
      metrics: prevState ? { ...prevState.metrics, ...result.metrics } : result.metrics,
      // 保留之前的位置信息（如果新消息没有）
      location: result.location || (prevState?.location) || null,
      // 每个设备只保留一条告警
      alerts: result.alerts,
      lastSeen: new Date()
    };

    // 更新设备状态缓存
    this.deviceStates.set(deviceId, mergedResult);

    return mergedResult;
  }

  /**
   * 获取模式文本
   */
  getModeText(modeCode) {
    const modes = {
      0: '待机',
      1: '准备起飞',
      2: '任务中',
      3: '返航',
      4: '降落',
      5: '紧急停止'
    };
    return modes[modeCode] || `模式${modeCode}`;
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
  calculateOverallStatus(metrics, prevState = null) {
    // 优先检查电池槽状态（如果有）
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
      ...state
    }));
  }

  /**
   * 获取单个设备状态
   */
  getDeviceState(deviceId) {
    return this.deviceStates.get(deviceId);
  }

  /**
   * 更新阈值配置
   */
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }
}

module.exports = DeviceProcessor;
