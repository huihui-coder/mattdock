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
const { registerImageRoutes } = require('./routes/image-api');
const { registerAssistantRoutes } = require('./routes/assistant-api');
const { getFlightRecordsForAssistant, getFlightStatsSnapshot } = require('./lib/flight-records-for-assistant');
const {
  isDockSharedOutAirport,
  resolveVideoId,
  METHOD_LIVE_CAMERA_CHANGE,
} = require('./lib/live-camera-service');
const {
  isDockSeriesAirport,
  SUPPLEMENT_LIGHT_ACTIONS,
  METHOD_SUPPLEMENT_LIGHT_OPEN,
  METHOD_SUPPLEMENT_LIGHT_CLOSE,
} = require('./lib/dock-service');
const { getJobSecret } = require('./lib/lost-alert-mqtt-bridge');
const { getLiveCameraPosition } = require('./lib/dock-live-state-store');

const app = express();
const PORT = process.env.PORT || 3001;
const WS_PORT = process.env.WS_PORT || 3002;
const IS_PROD = process.env.NODE_ENV === 'production';

// 简单 token 鉴权（无需 jwt 库）
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || 'admin123';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const USER_FILE = path.join(__dirname, '../haizhuDB/users.json');
const SESSION_FILE = path.join(__dirname, '../haizhuDB/sessions.json');
const AVATAR_DIR = path.join(__dirname, '../haizhuDB/avatars');
const ALL_PERMISSIONS = ['monitor', 'alert-config', 'flight-records', 'image-studio', 'ai-assistant'];
const sessions = new Map();

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    let n = 0;
    for (const [token, session] of Object.entries(raw || {})) {
      if (session?.expireAt > now) {
        sessions.set(token, session);
        n += 1;
      }
    }
    if (n) console.log(`[Auth] 已恢复 ${n} 个登录会话`);
  } catch (e) {
    console.warn('[Auth] 读取会话文件失败:', e.message);
  }
}

function persistSessions() {
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions)), 'utf8');
  } catch (e) {
    console.warn('[Auth] 保存会话失败:', e.message);
  }
}

loadSessions();

function sanitizeUser(user, { includePassword = false } = {}) {
  if (!user) return null;
  const { passwordHash, plainPassword, ...safe } = user;
  if (includePassword) safe.plainPassword = plainPassword || '';
  return safe;
}

function updateSessionUser(token, user) {
  const session = sessions.get(token);
  if (session) session.user = sanitizeUser(user);
}

function countAdmins(users) {
  return users.filter(u => u.role === 'admin').length;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === stored;
}

function readUsers() {
  try {
    if (!fs.existsSync(USER_FILE)) {
      const users = [{
        username: AUTH_USER,
        passwordHash: hashPassword(AUTH_PASS),
        plainPassword: AUTH_PASS,
        role: 'admin',
        permissions: ALL_PERMISSIONS,
        createdAt: new Date().toISOString()
      }];
      fs.mkdirSync(path.dirname(USER_FILE), { recursive: true });
      fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2), 'utf8');
      return users;
    }
    return JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
  } catch (error) {
    console.error('[用户] 读取用户文件失败:', error.message);
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(USER_FILE), { recursive: true });
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function setUserPassword(user, password) {
  user.passwordHash = hashPassword(password);
  user.plainPassword = password;
}

function signToken(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    expireAt: Date.now() + TOKEN_TTL_MS,
    user: sanitizeUser(user),
    lastActiveAt: Date.now(),
  });
  persistSessions();
  return token;
}

function getSession(req) {
  const token = req.headers['x-auth-token'] || req.query.token;
  const session = sessions.get(token);
  if (!token || !session || Date.now() > session.expireAt) {
    if (token) {
      sessions.delete(token);
      persistSessions();
    }
    return null;
  }
  session.lastActiveAt = Date.now();
  return { token, ...session };
}

function getOnlineUserStats() {
  const now = Date.now();
  const stats = new Map();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expireAt) {
      sessions.delete(token);
      continue;
    }
    const username = session.user?.username;
    if (!username) continue;
    const prev = stats.get(username) || { sessionCount: 0, lastActiveAt: 0 };
    prev.sessionCount += 1;
    prev.lastActiveAt = Math.max(prev.lastActiveAt, session.lastActiveAt || 0);
    stats.set(username, prev);
  }
  return stats;
}

function requireLogin(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  req.user = session.user;
  req.token = session.token;
  next();
}

function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
    next();
  });
}

function hasPermission(user, permission) {
  return user?.role === 'admin' || (user?.permissions || []).includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    requireLogin(req, res, () => {
      if (!hasPermission(req.user, permission)) {
        return res.status(403).json({ error: '无权限访问该功能' });
      }
      next();
    });
  };
}

// 中间件
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const TOKEN_USAGE_FILE = path.join(__dirname, '../haizhuDB/ai-token-usage.json');
/** 本地进度条上限（非厂商账单；火山 LAS 模型用量以控制台为准） */
const DEFAULT_MODEL_TOTAL = Number(process.env.AI_TOKEN_DISPLAY_TOTAL) || 1000000;

function readTokenUsage() {
  try {
    if (!fs.existsSync(TOKEN_USAGE_FILE)) return {};
    return JSON.parse(fs.readFileSync(TOKEN_USAGE_FILE, 'utf8'));
  } catch (error) {
    console.error('[AI用量] 读取统计文件失败:', error.message);
    return {};
  }
}

function writeTokenUsage(usageData) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_USAGE_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_USAGE_FILE, JSON.stringify(usageData, null, 2), 'utf8');
  } catch (error) {
    console.error('[AI用量] 写入统计文件失败:', error.message);
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
  if (process.env.AI_USAGE_LOG !== '0') {
    console.log(
      `[AI用量] ${model} 本次 token:${usedTokens}, 累计:${nextUsed}（本地统计，非厂商账单；剩余按 ${current.total} 上限估算:${nextRemaining}）`,
    );
  }
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

// 静态文件服务（仅生产构建后）
if (IS_PROD) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

// 登录接口
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = readUsers().find((u) => u.username === username);
    if (user && verifyPassword(password, user.passwordHash)) {
      const token = signToken(user);
      return res.json({ token, user: sanitizeUser(user), expiresIn: TOKEN_TTL_MS });
    }
    return res.status(401).json({ error: '用户名或密码错误' });
  } catch (e) {
    console.error('[Auth] 登录失败:', e.message);
    return res.status(500).json({ error: '登录服务异常，请稍后重试' });
  }
});

app.post('/api/logout', requireLogin, (req, res) => {
  sessions.delete(req.token);
  persistSessions();
  res.json({ success: true });
});

app.get('/api/me', requireLogin, (req, res) => {
  const user = readUsers().find(u => u.username === req.user.username);
  if (user) updateSessionUser(req.token, user);
  res.json({ user: sanitizeUser(user || req.user) });
});

app.get('/api/users', requireAdmin, (req, res) => {
  const onlineStats = getOnlineUserStats();
  res.json({
    users: readUsers().map(u => {
      const stat = onlineStats.get(u.username);
      return {
        ...sanitizeUser(u, { includePassword: true }),
        online: !!stat,
        sessionCount: stat?.sessionCount || 0,
        lastActiveAt: stat?.lastActiveAt ? new Date(stat.lastActiveAt).toISOString() : null
      };
    }),
    permissions: ALL_PERMISSIONS
  });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, permissions = [] } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const users = readUsers();
  if (users.find(u => u.username === username)) return res.status(409).json({ error: '用户名已存在' });
  const safePermissions = permissions.filter(p => ALL_PERMISSIONS.includes(p));
  const user = {
    username,
    role: 'user',
    permissions: safePermissions,
    createdAt: new Date().toISOString()
  };
  setUserPassword(user, password);
  users.push(user);
  writeUsers(users);
  res.json({ user: sanitizeUser(user, { includePassword: true }) });
});

app.put('/api/users/:username', requireAdmin, (req, res) => {
  const target = req.params.username;
  const { permissions, password } = req.body || {};
  const users = readUsers();
  const idx = users.findIndex(u => u.username === target);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });

  const user = users[idx];
  if (user.role !== 'admin' && Array.isArray(permissions)) {
    user.permissions = permissions.filter(p => ALL_PERMISSIONS.includes(p));
  }
  if (password) {
    if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });
    setUserPassword(user, password);
  }
  user.updatedAt = new Date().toISOString();
  users[idx] = user;
  writeUsers(users);

  for (const [token, session] of sessions.entries()) {
    if (session.user?.username === user.username) {
      updateSessionUser(token, user);
    }
  }

  res.json({ user: sanitizeUser(user, { includePassword: true }) });
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const target = req.params.username;
  if (target === req.user.username) return res.status(400).json({ error: '不能删除当前登录账号' });

  const users = readUsers();
  const idx = users.findIndex(u => u.username === target);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });

  const user = users[idx];
  if (user.role === 'admin' && countAdmins(users) <= 1) {
    return res.status(400).json({ error: '不能删除最后一个管理员' });
  }

  users.splice(idx, 1);
  writeUsers(users);

  for (const [token, session] of sessions.entries()) {
    if (session.user?.username === target) sessions.delete(token);
  }
  persistSessions();

  try {
    const avatarFiles = fs.readdirSync(AVATAR_DIR).filter(f => f.startsWith(`${target}.`));
    avatarFiles.forEach(f => fs.unlinkSync(path.join(AVATAR_DIR, f)));
  } catch {}

  res.json({ success: true });
});

app.put('/api/me/password', requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写原密码和新密码' });
  if (newPassword.length < 4) return res.status(400).json({ error: '新密码至少4位' });

  const users = readUsers();
  const idx = users.findIndex(u => u.username === req.user.username);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });

  const user = users[idx];
  if (!verifyPassword(oldPassword, user.passwordHash)) {
    return res.status(400).json({ error: '原密码错误' });
  }

  setUserPassword(user, newPassword);
  user.updatedAt = new Date().toISOString();
  users[idx] = user;
  writeUsers(users);
  updateSessionUser(req.token, user);
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/me/avatar', requireLogin, (req, res) => {
  const { avatar } = req.body || {};
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(avatar || '');
  if (!match) return res.status(400).json({ error: '请上传 PNG/JPG/GIF/WebP 图片' });

  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: '图片不能超过 2MB' });

  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  try {
    fs.readdirSync(AVATAR_DIR)
      .filter(f => f.startsWith(`${req.user.username}.`))
      .forEach(f => fs.unlinkSync(path.join(AVATAR_DIR, f)));
  } catch {}

  const filename = `${req.user.username}.${ext}`;
  fs.writeFileSync(path.join(AVATAR_DIR, filename), buf);

  const users = readUsers();
  const idx = users.findIndex(u => u.username === req.user.username);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });

  const avatarUrl = `/api/avatars/${filename}?v=${Date.now()}`;
  users[idx].avatar = avatarUrl;
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  updateSessionUser(req.token, users[idx]);
  res.json({ user: sanitizeUser(users[idx]) });
});

app.get('/api/avatars/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(AVATAR_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 初始化服务（开发与生产均挂载到 HTTP /ws，供 Vite 代理与线上同源访问）
const wsService = new WebSocketService(WS_PORT);

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
const { createAlertAiAnalyzer } = require('./lib/alert-ai-analyzer');
let mqttService;
const alertAiAnalyzer = createAlertAiAnalyzer({
  updateTokenUsage,
  getDeviceState: (deviceId) => processor.getDeviceState(deviceId),
  processor,
  getMqttService: () => mqttService,
});
const alertService = new AlertService({
  aiAnalyzer: alertAiAnalyzer,
  getDeviceState: (deviceId) => processor.getDeviceState(deviceId),
  processor,
  aiAnalysisEnabled: process.env.ALERT_AI_ENABLED !== '0',
});

mqttService = new MQTTService({
  brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
  username: process.env.MQTT_USERNAME || '',
  password: process.env.MQTT_PASSWORD || '',
  clientId: process.env.MQTT_CLIENT_ID || 'airport_monitor_',
  topics: process.env.MQTT_TOPICS || 'airport/devices/#'
}, wsService, alertService, processor);

alertService.setMqttService(mqttService);

mqttService.connect();

function requireLostAlertJobSecret(req, res, next) {
  if (req.headers['x-job-secret'] === getJobSecret()) return next();
  return res.status(403).json({ error: 'job secret invalid' });
}

// 飞丢告警子进程复用主进程 MQTT（避免第二连接被 broker 拒绝）
app.get('/api/internal/lost-alert/status', requireLostAlertJobSecret, (req, res) => {
  res.json({ mqttConnected: mqttService.isConnected() });
});

app.post('/api/internal/lost-alert/service', requireLostAlertJobSecret, async (req, res) => {
  try {
    const { deviceId, method, data } = req.body || {};
    if (!deviceId || !method) {
      return res.status(400).json({ error: 'deviceId and method required' });
    }
    if (!mqttService.isConnected()) {
      return res.status(503).json({ error: 'MQTT 未连接' });
    }
    await mqttService.publishService(deviceId, method, data ?? null);
    if (method === METHOD_LIVE_CAMERA_CHANGE && data?.camera_position !== undefined) {
      processor.patchDockControlState(deviceId, {
        liveCameraPosition: data.camera_position,
        source: 'lost_alert',
      });
    }
    if (method === METHOD_SUPPLEMENT_LIGHT_OPEN) {
      processor.patchDockControlState(deviceId, { supplementLightState: 1, source: 'lost_alert' });
    }
    if (method === METHOD_SUPPLEMENT_LIGHT_CLOSE) {
      processor.patchDockControlState(deviceId, { supplementLightState: 0, source: 'lost_alert' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 每分钟检查一次机场是否离线
setInterval(() => alertService.checkAirportOffline(), 60 * 1000);

// API路由
registerImageRoutes(app, { requireImageStudio: requirePermission('image-studio') });
registerAssistantRoutes(app, {
  requireAssistant: requirePermission('ai-assistant'),
  updateTokenUsage,
  enrichAssistantContext: (ctx) => {
    const flightView = ctx?.flightView;
    const flightStats = getFlightStatsSnapshot(processor, flightView);
    const opts = { flightView, selectedDevice: ctx?.selectedDevice };
    return {
      ...ctx,
      flightStats,
      flightRecords: getFlightRecordsForAssistant(processor, () => buildActiveFlightSessions(), opts),
      flightRanking: flightStats.ranking,
    };
  },
});

const arkKey = (process.env.ARK_API_KEY || '').trim();
const arkModel = (process.env.ARK_MODEL || 'doubao-seed-2-0-mini-260428').trim();
const alertAiOn = process.env.ALERT_AI_ENABLED !== '0' && !!arkKey;
console.log(`[Assistant] Ark: key=${arkKey ? '已配置' : '未配置'}, model=${arkModel || '(空)'}`);
console.log(`[AlertAI] 告警多模态分析: ${alertAiOn ? '已启用' : '未启用'}`);
console.log(`[Ark] 联网搜索: ${process.env.ARK_WEB_SEARCH || 'auto'}（有外网时自动开启）`);

// 获取离巢告警配置
app.get('/api/alert-config', (req, res) => {
  res.json(alertService.getConfig());
});

// 更新离巢告警配置
app.post('/api/alert-config', (req, res) => {
  alertService.updateConfigs(req.body);
  res.json({ message: '告警配置已保存', config: alertService.getConfig() });
});

// 手动触发飞丢告警（测试截图 + AI + 企业微信推送）
app.post('/api/alert-config/trigger-lost', (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });
  const state = processor.getDeviceState?.(deviceId);
  const deviceName = state?.deviceName || deviceId;
  const result = alertService.triggerLostAlertTest(deviceId, deviceName);
  if (!result.ok) {
    return res.status(result.error?.includes('执行中') ? 409 : 400).json({ error: result.error });
  }
  res.json({ message: '飞丢告警测试已触发', pid: result.pid });
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
function noCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
}

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

// Dock 系列直播相机切换（舱内/舱外共用 _out 流）
app.post('/api/live/camera-change', requirePermission('monitor'), async (req, res) => {
  const { deviceId, cameraPosition, videoId } = req.body || {};
  const gatewaySn = String(deviceId || '').trim();
  const pos = Number(cameraPosition);

  if (!gatewaySn) {
    return res.status(400).json({ error: '缺少 deviceId（机场 gateway_sn）' });
  }
  if (pos !== 0 && pos !== 1) {
    return res.status(400).json({ error: 'camera_position 须为 0（舱内）或 1（舱外）' });
  }

  const state = processor.getDeviceState(gatewaySn);
  const checkDevice = {
    deviceId: gatewaySn,
    deviceType: state?.deviceType || 'airport',
    deviceName: state?.deviceName || processor.getDeviceName(gatewaySn),
  };
  if (!isDockSharedOutAirport(checkDevice)) {
    return res.status(400).json({
      error: '该设备非 Dock 系列机场，不支持舱内/舱外 MQTT 切换',
    });
  }

  const resolvedVideoId = resolveVideoId(gatewaySn, videoId);
  try {
    const reply = await mqttService.invokeService(gatewaySn, METHOD_LIVE_CAMERA_CHANGE, {
      camera_position: pos,
      video_id: resolvedVideoId,
    });
    const updated = processor.patchDockControlState(gatewaySn, {
      liveCameraPosition: pos,
      source: 'api',
    });
    if (updated && mqttService.wsService) {
      mqttService.wsService.broadcast({
        type: 'device_data',
        topic: `thing/product/${gatewaySn}/osd`,
        raw: { data: updated.osdSnapshot || {} },
        processed: updated,
        timestamp: new Date().toISOString(),
      });
    }
    res.json({
      ok: true,
      deviceId: gatewaySn,
      camera_position: pos,
      camera_label: pos === 0 ? '舱内' : '舱外',
      video_id: resolvedVideoId,
      reply: reply?.data,
    });
  } catch (e) {
    console.error('[Live] camera-change 失败:', e.message);
    res.status(502).json({ error: e.message || '直播相机切换失败' });
  }
});

app.get('/api/live/dock3-config/:deviceId', (req, res) => {
  const gatewaySn = req.params.deviceId;
  const state = processor.getDeviceState(gatewaySn);
  const dockSharedOut = isDockSharedOutAirport(state || { deviceId: gatewaySn, deviceType: 'airport' });
  const liveCameraPosition =
    state?.liveCameraPosition ?? getLiveCameraPosition(gatewaySn) ?? null;
  res.json({
    deviceId: gatewaySn,
    dockSharedOut,
    dock3SharedOut: dockSharedOut,
    videoId: dockSharedOut ? resolveVideoId(gatewaySn) : null,
    liveCameraPosition,
    liveCameraLabel:
      liveCameraPosition === 0 ? '舱内推流' : liveCameraPosition === 1 ? '舱外推流' : null,
  });
});

// Dock 系列机场补光灯开关
app.post('/api/dock/supplement-light', requirePermission('monitor'), async (req, res) => {
  const { deviceId, action } = req.body || {};
  const gatewaySn = String(deviceId || '').trim();
  const act = String(action || '').toLowerCase();

  if (!gatewaySn) {
    return res.status(400).json({ error: '缺少 deviceId（机场 gateway_sn）' });
  }
  const method = SUPPLEMENT_LIGHT_ACTIONS[act];
  if (!method) {
    return res.status(400).json({ error: 'action 须为 open 或 close' });
  }

  const state = processor.getDeviceState(gatewaySn);
  const checkDevice = {
    deviceId: gatewaySn,
    deviceType: state?.deviceType || 'airport',
    deviceName: state?.deviceName || processor.getDeviceName(gatewaySn),
  };
  if (!isDockSeriesAirport(checkDevice)) {
    return res.status(400).json({ error: '该设备非 Dock 系列机场，不支持补光灯控制' });
  }

  try {
    const reply = await mqttService.invokeService(gatewaySn, method, null);
    const status = reply?.data?.output?.status;
    const lightState = act === 'open' ? 1 : 0;
    const updated = processor.patchDockControlState(gatewaySn, { supplementLightState: lightState });
    if (updated && mqttService.wsService) {
      mqttService.wsService.broadcast({
        type: 'device_data',
        topic: `thing/product/${gatewaySn}/osd`,
        raw: { data: updated.osdSnapshot || {} },
        processed: updated,
        timestamp: new Date().toISOString(),
      });
    }
    res.json({
      ok: true,
      deviceId: gatewaySn,
      action: act,
      method,
      status,
      reply: reply?.data,
    });
  } catch (e) {
    console.error('[Dock] supplement-light 失败:', e.message);
    res.status(502).json({ error: e.message || '补光灯控制失败' });
  }
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

function buildActiveFlightSessions(type) {
  let sessions = Array.from(processor.activeSessions.values()).map(s => ({
    ...s,
    deviceName: processor.normalizeFlightDisplayName(s.deviceName || s.deviceId),
    totalDuration: processor.calcFlightDuration(s),
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
      currentTotalFlightDistance: state.raw_total_flight_distance ?? null,
      status: 'active'
    });
  }

  if (type && type !== 'all') {
    sessions = sessions.filter(s => type === 'airport' ? s.deviceType === 'drone' : s.deviceType === type);
  }
  return sessions;
}

// 获取飞行统计历史
app.get('/api/flight-history', (req, res) => {
  noCache(res)
  const { type, startTime, endTime } = req.query;

  processor.syncFlightHistoryFromDisk();
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

// 获取飞行记录列表（已完成 + 进行中）
app.get('/api/flight-records', (req, res) => {
  noCache(res)
  const { type, startTime, endTime } = req.query;
  processor.syncFlightHistoryFromDisk();
  const start = startTime ? new Date(startTime).getTime() : 0;
  const end = endTime ? new Date(endTime).getTime() : Infinity;
  let history = [...processor.flightHistory].filter(h => {
    const matchType = !type || type === 'all' || (type === 'airport' ? h.deviceType === 'drone' : h.deviceType === type);
    const time = new Date(h.startTime).getTime();
    return matchType && time >= start && time <= end;
  });
  const active = buildActiveFlightSessions(type);
  // 进行中的架次还没写入 history，二者不会重复；
  // 之前用 deviceId 去重会把“正在飞行设备”的所有历史完成记录全部抹掉，导致列表条数变少/看似不刷新，已移除
  const records = [
    ...active,
    ...history
  ].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  console.log(`[飞行记录接口] /api/flight-records type=${type || 'all'} completed=${history.length} active=${active.length} total=${records.length}: ${active.map(s => `${s.deviceName || s.deviceId}(${s.deviceType})`).join(', ') || '无进行中'}`);
  res.json({ records, history, active });
});

// 获取进行中的飞行会话
app.get('/api/flight-active', (req, res) => {
  noCache(res)
  const { type } = req.query;
  const allSessions = Array.from(processor.activeSessions.values());
  console.log(`[飞行记录接口] /api/flight-active type=${type || 'all'} activeSessions=${allSessions.length}`);
  const sessions = buildActiveFlightSessions(type);
  console.log(`[飞行记录接口] 返回进行中=${sessions.length}: ${sessions.map(s => `${s.deviceName || s.deviceId}(${s.deviceType})`).join(', ') || '无'}`);
  res.json(sessions);
});

// 模拟飞行测试接口（仅供调试，触发后立刻生成一条已完成的虚拟飞行记录）
app.post('/api/simulate-flight', (req, res) => {
  const deviceId = 'VIRTUAL_TEST_DOCK';
  const deviceName = '测试虚拟机场-模拟无人机';
  const durationSec = Math.floor(60 + Math.random() * 300); // 60~360s
  const mileage = Math.floor(500 + Math.random() * 4500);   // 500~5000m
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - durationSec * 1000);
  const record = {
    id: `${deviceId}_${startTime.getTime()}`,
    deviceId,
    deviceName,
    deviceType: 'drone',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    totalMileage: mileage,
    totalDuration: durationSec,
    startTotalFlightDistance: 1000,
    lastTotalFlightDistance: 1000 + mileage,
    mileage,
    status: 'completed'
  };
  processor.flightHistory.push(record);
  if (processor.flightHistory.length > 1000) processor.flightHistory.shift();
  processor.saveFlightHistory();
  processor.logFlight(`[模拟飞行] 写入虚拟记录 ${deviceName} duration=${durationSec}s mileage=${mileage}m`);
  res.json({ ok: true, record });
});

// SPA 回退（仅生产）
if (IS_PROD) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// 启动服务器
const server = app.listen(PORT, () => {
  console.log(`[Express] HTTP服务已启动: http://localhost:${PORT}`);
  const xoKey = (process.env.XOMODEL_API_KEY || '').trim();
  const xoModel = (process.env.XOMODEL_IMAGE_MODEL || 'gpt-image-2').trim();
  console.log(`[ImageAPI] XOMODEL: key=${xoKey ? '已配置' : '未配置'}, model=${xoModel || '(空)'}`);
  wsService.attachToServer(server);
  console.log(`[Express] WebSocket 已挂载: /ws（${IS_PROD ? '生产' : '开发'}）`);
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
