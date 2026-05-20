require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const MQTTService = require('./mqtt-service');
const WebSocketService = require('./ws-service');
const DeviceProcessor = require('./device-processor');
const AlertService = require('./alert-service');

const app = express();
const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;
const IS_PROD = process.env.NODE_ENV === 'production';

// 简单 token 鉴权（无需 jwt 库）
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || 'admin123';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const sessions = new Map(); // token -> expireAt

function signToken() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + 12 * 60 * 60 * 1000); // 12h
  return token;
}

function authMiddleware(req, res, next) {
  // 只有生产模式下 POST /api/alert-config（保存配置）才需要验证
  if (!IS_PROD) return next();
  if (!(req.method === 'POST' && req.path === '/alert-config')) return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  const expire = sessions.get(token);
  if (!token || !expire || Date.now() > expire) {
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  sessions.set(token, Date.now() + 12 * 60 * 60 * 1000); // 续期
  next();
}

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务（生产环境）
app.use(express.static(path.join(__dirname, '../client/dist')));

// 登录接口
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USER && password === AUTH_PASS) {
    return res.json({ token: signToken() });
  }
  res.status(401).json({ error: '用户名或密码错误' });
});


// 初始化服务
const wsService = new WebSocketService(WS_PORT);
if (!IS_PROD) {
  wsService.start();
}

// 从.env读取阈值配置
// 支持多区间格式，用分号分隔，如: 0,20;30,70
const parseThreshold = (envValue, defaultVal) => {
  if (!envValue) return defaultVal;
  
  // 支持多区间格式: "min1,max1;min2,max2"
  const ranges = envValue.split(';').map(range => {
    const [min, max] = range.trim().split(',').map(v => parseFloat(v.trim()));
    if (isNaN(min) || isNaN(max)) return null;
    return { min, max };
  }).filter(r => r !== null);
  
  if (ranges.length === 0) return defaultVal;
  
  // 返回数组格式（多区间）或单个对象（单区间）
  return ranges.length === 1 ? ranges[0] : ranges;
};

const thresholdConfig = {
  windSpeed: {
    normal: parseThreshold(process.env.WIND_SPEED_NORMAL, [{ min: 0, max: 6.6 }]),
    warning: parseThreshold(process.env.WIND_SPEED_WARNING, [{ min: 6.6, max: 12 }]),
    critical: parseThreshold(process.env.WIND_SPEED_CRITICAL, [{ min: 12, max: 999 }])
  },
  humidity: {
    normal: parseThreshold(process.env.HUMIDITY_NORMAL, [{ min: 0, max: 20 }, { min: 30, max: 70 }]),
    warning: parseThreshold(process.env.HUMIDITY_WARNING, [{ min: 20, max: 30 }, { min: 70, max: 80 }]),
    critical: parseThreshold(process.env.HUMIDITY_CRITICAL, [{ min: 80, max: 100 }])
  }
};

const processor = new DeviceProcessor(thresholdConfig);
const alertService = new AlertService();

const mqttService = new MQTTService({
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: process.env.MQTT_USERNAME || '',
  password: process.env.MQTT_PASSWORD || '',
  clientId: process.env.MQTT_CLIENT_ID || 'airport_monitor_',
  topics: process.env.MQTT_TOPICS || 'airport/devices/#'
}, wsService, alertService);

mqttService.connect();

// 每分钟检查一次机场是否离线
setInterval(() => alertService.checkAirportOffline(), 60 * 1000);

// API路由

// 获取离巢告警配置
app.get('/api/alert-config', (req, res) => {
  res.json(alertService.getConfig());
});

// 更新离巢告警配置
app.post('/api/alert-config', (req, res) => {
  alertService.updateConfigs(req.body);
  res.json({ message: '告警配置已保存', config: alertService.getConfig() });
});

// 测试推送
app.post('/api/alert-config/test', (req, res) => {
  const { webhookUrl, snapshotDeviceId, snapshotStream } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: '缺少 webhookUrl' });
  const testDeviceId = snapshotDeviceId || 'NEST44202512U014';
  alertService._sendWecomWebhook(webhookUrl, '测试设备', testDeviceId, 99, 'lost');
  alertService._sendStreamSnapshot(webhookUrl, testDeviceId, '_out');
  alertService._sendStreamSnapshot(webhookUrl, testDeviceId, '_in');
  alertService._sendStreamSnapshot(webhookUrl, testDeviceId, '_flight');
  res.json({ message: '测试消息已发送' });
});

// 获取连接状态
app.get('/api/status', (req, res) => {
  res.json({
    mqtt: {
      connected: mqttService.isConnected(),
      broker: process.env.MQTT_BROKER_URL
    },
    websocket: {
      port: WS_PORT,
      clients: wsService.getClientCount()
    },
    timestamp: new Date().toISOString()
  });
});

// 获取所有设备状态
app.get('/api/devices', (req, res) => {
  const devices = processor.getAllDeviceStates();
  res.json({
    count: devices.length,
    devices
  });
});

// 获取单个设备状态
app.get('/api/devices/:deviceId', (req, res) => {
  const device = processor.getDeviceState(req.params.deviceId);
  if (device) {
    res.json(device);
  } else {
    res.status(404).json({ error: '设备未找到' });
  }
});

// 更新阈值配置
app.post('/api/thresholds', (req, res) => {
  const { thresholds } = req.body;
  processor.updateThresholds(thresholds);
  res.json({ 
    message: '阈值配置已更新',
    thresholds: processor.thresholds 
  });
});

// 获取当前阈值配置
app.get('/api/thresholds', (req, res) => {
  res.json(processor.thresholds);
});

// 手动重连MQTT
app.post('/api/mqtt/reconnect', (req, res) => {
  if (mqttService.isConnected()) {
    mqttService.disconnect();
  }
  mqttService.connect();
  res.json({ message: '正在重新连接MQTT...' });
});

// SPA回退路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// 启动服务器
const server = app.listen(PORT, () => {
  console.log(`[Express] HTTP服务已启动: http://localhost:${PORT}`);
  if (IS_PROD) {
    wsService.attachToServer(server);
    console.log(`[Express] WebSocket已合并到同一端口 /ws`);
  } else {
    console.log(`[Express] WebSocket端口: ${WS_PORT}`);
  }
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('正在关闭服务...');
  mqttService.disconnect();
  wsService.close();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  process.emit('SIGTERM');
});
