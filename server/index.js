require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

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
app.use(express.json({ limit: '25mb' }));

const TOKEN_USAGE_FILE = path.join(__dirname, '../haizhuDB/ai-token-usage.json');
const DEFAULT_MODEL_TOTAL = 1000000;

function readTokenUsage() {
  try {
    if (!fs.existsSync(TOKEN_USAGE_FILE)) return {};
    return JSON.parse(fs.readFileSync(TOKEN_USAGE_FILE, 'utf8'));
  } catch (error) {
    console.error('[AI额度] 读取额度文件失败:', error.message);
    return {};
  }
}

function writeTokenUsage(usageData) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_USAGE_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_USAGE_FILE, JSON.stringify(usageData, null, 2), 'utf8');
  } catch (error) {
    console.error('[AI额度] 写入额度文件失败:', error.message);
  }
}

function updateTokenUsage(model, usage) {
  const usedTokens = usage?.total_tokens || 0;
  const usageData = readTokenUsage();
  const current = usageData[model] || {
    total: DEFAULT_MODEL_TOTAL,
    used: 0,
    remaining: DEFAULT_MODEL_TOTAL,
    calls: 0
  };

  const nextUsed = current.used + usedTokens;
  const nextRemaining = Math.max(0, current.total - nextUsed);

  usageData[model] = {
    total: current.total,
    used: nextUsed,
    remaining: nextRemaining,
    calls: (current.calls || 0) + 1,
    lastUsage: usage || null,
    updatedAt: new Date().toISOString()
  };

  writeTokenUsage(usageData);
  console.log(`[AI额度] ${model} 本次:${usedTokens}, 累计:${nextUsed}, 剩余:${nextRemaining}`);
  return usageData[model];
}

// 视频代理（绕过CORS）
app.get('/api/proxy-video', (req, res) => {
  const videoUrl = 'https://videotourl.com/videos/1779380971189-9604078b-43c4-4d71-b28d-e7fe149dbf05.mp4';
  const client = videoUrl.startsWith('https') ? https : http;
  const range = req.headers.range;
  const options = { headers: range ? { Range: range } : {} };
  client.get(videoUrl, options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    delete headers['access-control-allow-origin'];
    delete headers['access-control-allow-credentials'];
    delete headers['x-frame-options'];
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  }).on('error', (err) => {
    res.status(500).send('代理视频失败');
  });
});

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

// Python Pillow 绘制边界框接口
app.post('/api/draw-boxes', (req, res) => {
  const { image, boxes, videoWidth, videoHeight } = req.body;
  if (!image || !boxes) {
    return res.status(400).json({ error: '缺少 image 或 boxes 参数' });
  }
  const input = JSON.stringify({ image, boxes, videoWidth: videoWidth || 1920, videoHeight: videoHeight || 1080 });
  const scriptPath = path.join(__dirname, 'draw_boxes.py');
  const py = spawn('python', [scriptPath], { timeout: 30000 });
  let stdout = '';
  let stderr = '';
  py.stdin.write(input);
  py.stdin.end();
  py.stdout.on('data', d => { stdout += d.toString(); });
  py.stderr.on('data', d => { stderr += d.toString(); });
  py.on('close', code => {
    if (code !== 0) {
      console.error('[draw-boxes] Python 错误:', stderr);
      return res.status(500).json({ error: stderr || 'Python 脚本执行失败' });
    }
    try {
      const result = JSON.parse(stdout);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: '解析 Python 输出失败: ' + stdout });
    }
  });
  py.on('error', err => {
    console.error('[draw-boxes] 启动 Python 失败:', err.message);
    res.status(500).json({ error: '无法启动 Python，请确保已安装 Python 和 Pillow: ' + err.message });
  });
});

// DashScope API 代理 - 用于获取真实额度信息
app.get('/api/ai/token-usage', (req, res) => {
  res.json(readTokenUsage());
});

app.post('/api/ai/analyze', async (req, res) => {
  const { model, messages } = req.body;
  const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'sk-3adf46c180c44ed99d69adb0b3a46234';
  
  try {
    console.log(`[AI代理] 转发请求 - 模型: ${model}`);
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, input: { messages } })
    });
    
    // 获取额度信息
    const quotaRemaining = response.headers.get('X-DashScope-Quota-Remaining');
    const quotaTotal = response.headers.get('X-DashScope-Quota-Total');
    
    if (quotaRemaining) {
      console.log(`[AI代理] 获取到额度 - 模型: ${model}, 剩余: ${quotaRemaining}`);
    }
    
    const data = await response.json();
    const usageSummary = updateTokenUsage(model, data.usage);
    
    // 返回数据和额度信息
    res.json({
      ...data,
      _quota: {
        remaining: quotaRemaining ? parseInt(quotaRemaining, 10) : null,
        total: quotaTotal ? parseInt(quotaTotal, 10) : null,
        model: model
      },
      _usageSummary: usageSummary
    });
  } catch (error) {
    console.error('[AI代理] 请求失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 获取飞行统计历史
app.get('/api/flight-history', (req, res) => {
  const { type, startTime, endTime } = req.query;

  let history = [...processor.flightHistory];

  // 1. 类型筛选：airport TAB 只统计机场绑定无人机（drone），不统计机场本体（airport）
  if (type && type !== 'all') {
    if (type === 'airport') {
      history = history.filter(h => h.deviceType === 'drone');
    } else {
      history = history.filter(h => h.deviceType === type);
    }
  }

  // 2. 时间筛选
  if (startTime || endTime) {
    const start = startTime ? new Date(startTime).getTime() : 0;
    const end = endTime ? new Date(endTime).getTime() : Infinity;
    history = history.filter(h => {
      const time = new Date(h.startTime).getTime();
      return time >= start && time <= end;
    });
  }

  res.json(history);
});

// 获取进行中的飞行会话
app.get('/api/flight-active', (req, res) => {
  const { type } = req.query;
  const now = Date.now();
  const allSessions = Array.from(processor.activeSessions.values());
  console.log(`[飞行记录接口] /api/flight-active type=${type || 'all'} activeSessions=${allSessions.length}`);
  let sessions = allSessions.map(s => ({
    ...s,
    deviceName: processor.normalizeFlightDisplayName(s.deviceName || s.deviceId),
    totalDuration: Math.floor((now - new Date(s.startTime).getTime()) / 1000),
    totalMileage: parseFloat((s.mileage || 0).toFixed(2)),
    status: 'active'
  }));

  for (const [deviceId, state] of processor.deviceStates.entries()) {
    if (sessions.find(s => s.deviceId === deviceId)) continue;
    if (!['drone', 'single', 'virtual'].includes(state.deviceType)) continue;
    if (!processor.isFlightMode(state.raw_mode_code)) continue;
    sessions.push({
      id: `${deviceId}_${new Date(state.lastSeen || Date.now()).getTime()}`,
      deviceId,
      deviceName: processor.normalizeFlightDisplayName(state.deviceName || deviceId),
      deviceType: state.deviceType,
      startTime: new Date(state.lastSeen || Date.now()).toISOString(),
      totalDuration: 0,
      totalMileage: 0,
      status: 'active'
    });
  }

  if (type && type !== 'all') {
    if (type === 'airport') {
      sessions = sessions.filter(s => s.deviceType === 'drone');
    } else {
      sessions = sessions.filter(s => s.deviceType === type);
    }
  }
  console.log(`[飞行记录接口] 返回进行中=${sessions.length}: ${sessions.map(s => `${s.deviceName || s.deviceId}(${s.deviceType})`).join(', ') || '无'}`);
  res.json(sessions);
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
