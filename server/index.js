require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const WebSocketService = require('./ws-service');
const DeviceProcessor = require('./device-processor');
const AlertService = require('./alert-service');
const { registerImageRoutes } = require('./routes/image-api');
const { registerAssistantRoutes } = require('./routes/assistant-api');
const { enrichAssistantContextWithScope } = require('./lib/assistant-scope-context');
const {
  buildFlightStats,
  buildFlightRanking,
  buildDailyDistribution,
  mergeFlightRecords,
  paginateRecords,
} = require('./lib/flight-query');
const { getJobSecret } = require('./lib/lost-alert-mqtt-bridge');
const { appendAuditEntry, loadAuditLogsQuery, getAuditStats, getActionCategory } = require('./lib/audit-log-store');
const {
  RegionRuntime,
  collectAlertConfigDeviceIds,
  resolveRegionIdInScope,
  getLeafProcessorsInScope,
} = require('./lib/region-runtime');
const { DEFAULT_REGION_ID, getRegionById, getRegionDeviceRegistryPath } = require('./lib/region-store');
const { buildRegionTree, countUsersByRegion } = require('./lib/region-tree');
const { MQTTManager } = require('./lib/mqtt-manager');
const {
  buildStreamUrl,
  resolveStreamConnectivityKey,
  sanitizeConnectivityForApi,
  writeRegionConnectivity,
} = require('./lib/region-connectivity');
const {
  listProfilesForApi,
  getProfileById,
  getProfileUsageMap,
  createProfile,
  updateProfile,
  deleteProfile,
  sanitizeProfileForApi,
} = require('./lib/mqtt-profiles');
const {
  listProfilesForApi: listWebhookProfilesForApi,
  getProfileById: getWebhookProfileById,
  createProfile: createWebhookProfile,
  updateProfile: updateWebhookProfile,
  recordProfileTest,
  deleteProfile: deleteWebhookProfile,
  sanitizeProfileForApi: sanitizeWebhookProfileForApi,
} = require('./lib/webhook-profiles');

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
const ALL_PERMISSIONS = ['monitor', 'alert-config', 'flight-records', 'device-config', 'image-studio', 'ai-assistant', 'audit-log'];
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
  if (!safe.regionId) safe.regionId = DEFAULT_REGION_ID;
  if (regionRuntime) {
    const scope = regionRuntime.getScopeForUser(safe);
    safe.visibleRegionIds = scope.visibleRegionIds;
    const regions = regionRuntime.listRegions();
    safe.regionName = regions.find((r) => r.id === safe.regionId)?.name || safe.regionId;
    const leafProcs = getLeafProcessorsInScope(scope.processors, regions);
    safe.leafRegions = leafProcs.map(({ regionId, regionName }) => ({
      id: regionId,
      name: regionName || regionId,
    }));
    const { buildRegionTree, getVisibleRegionIds } = require('./lib/region-tree');
    const visibleIds = new Set(getVisibleRegionIds(safe.regionId, regions));
    const scopedRegions = regions
      .filter((r) => visibleIds.has(r.id))
      .map((r) => ({ id: r.id, name: r.name || r.id, parentId: r.parentId }));
    const fullTree = buildRegionTree(scopedRegions);
    const findSubtree = (nodes, rootId) => {
      for (const node of nodes) {
        if (node.id === rootId) return [node];
        const sub = findSubtree(node.children || [], rootId);
        if (sub.length) return sub;
      }
      return nodes;
    };
    safe.regionTree = findSubtree(fullTree, safe.regionId).map((node) => ({
      id: node.id,
      name: node.name || node.id,
      children: (node.children || []).map(function mapChild(n) {
        return { id: n.id, name: n.name || n.id, children: (n.children || []).map(mapChild) };
      }),
    }));
  }
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
        regionId: (process.env.DEFAULT_ROOT_REGION_ID || 'gz-jhzd').trim(),
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

let regionRuntime;

function processorFor(req) {
  if (!regionRuntime) return null;
  return regionRuntime.getProcessorForUser(req?.user) || regionRuntime.getDefaultProcessor();
}

function processorForDevice(deviceId) {
  if (!regionRuntime) return null;
  return regionRuntime.getProcessorForDevice(deviceId);
}

const SCOPE_UNMAPPED = '__unmapped__';

function resolveRegionalScope(user, scopeRegionIdRaw) {
  const scope = regionRuntime.getScopeForUser(user);
  if (!scope.primaryProcessor) {
    const err = new Error('账号未绑定有效区域，请联系管理员');
    err.status = 403;
    throw err;
  }
  const regions = regionRuntime.listRegions();
  const leafProcessors = getLeafProcessorsInScope(scope.processors, regions);
  const scopeRegionId = String(scopeRegionIdRaw || '').trim();

  let visibleProcessors = leafProcessors;
  let scopeUnmappedOnly = false;
  let effectiveRegionId = scopeRegionId || scope.regionId;

  if (scopeRegionId === SCOPE_UNMAPPED) {
    if (!isAdminUser(user)) {
      const err = new Error('仅管理员可查看无归属设备');
      err.status = 403;
      throw err;
    }
    scopeUnmappedOnly = true;
    effectiveRegionId = SCOPE_UNMAPPED;
  } else if (scopeRegionId) {
    if (!scope.visibleRegionIds.includes(scopeRegionId)) {
      const err = new Error('无权访问该区域');
      err.status = 403;
      throw err;
    }
    const { getDescendantIds } = require('./lib/region-tree');
    const subtreeIds = new Set(getDescendantIds(scopeRegionId, regions));
    const matched = leafProcessors.filter((p) => subtreeIds.has(p.regionId));
    if (!matched.length) {
      const err = new Error('无效的区域筛选');
      err.status = 400;
      throw err;
    }
    visibleProcessors = matched;
    effectiveRegionId = scopeRegionId;
  }

  return {
    scope,
    visibleProcessors,
    scopeUnmappedOnly,
    regionId: scopeUnmappedOnly ? SCOPE_UNMAPPED : effectiveRegionId,
    visibleRegionIds: scope.visibleRegionIds,
    regions,
  };
}

function attachRegionalProcessor(req, res, next) {
  const scopeRegionId = String(
    req.query.scopeRegionId || req.body?.scopeRegionId || '',
  ).trim();

  try {
    const resolved = resolveRegionalScope(req.user, scopeRegionId);
    req.processor = resolved.visibleProcessors[0]?.processor || resolved.scope.primaryProcessor;
    req.regionScope = resolved.scope;
    req.visibleProcessors = resolved.visibleProcessors;
    req.visibleRegionIds = resolved.visibleRegionIds;
    req.regionId = resolved.regionId;
    req.scopeRegionId = scopeRegionId || null;
    req.scopeUnmappedOnly = resolved.scopeUnmappedOnly;
    next();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

function isAdminUser(user) {
  return user?.role === 'admin';
}

function collectScopeOptions(req) {
  return { unmappedOnly: !!req.scopeUnmappedOnly };
}

function filterUnmappedRegistryRows(rows, user) {
  if (isAdminUser(user)) return rows;
  return rows.filter((row) => row?.source !== 'unmapped');
}

function mergeDeviceRegistryGrouped(visibleProcessors) {
  const pairs = [];
  const singlePairs = [];
  const unboundSingles = [];
  const unboundRemotes = [];
  const unboundDrones = [];
  const devices = [];
  const boundDroneSns = new Set();
  const boundSingleSns = new Set();

  for (const { regionId, regionName, processor } of visibleProcessors) {
    const grouped = processor.getDeviceRegistryGrouped();
    for (const p of grouped.pairs) {
      pairs.push({ ...p, regionId, regionName, airport: { ...p.airport, regionId, regionName }, drone: p.drone ? { ...p.drone, regionId, regionName } : null });
      if (p.droneSn) boundDroneSns.add(p.droneSn);
    }
    for (const p of grouped.singlePairs) {
      singlePairs.push({ ...p, regionId, regionName, remote: { ...p.remote, regionId, regionName }, drone: p.drone ? { ...p.drone, regionId, regionName } : null });
      if (p.droneSn) boundSingleSns.add(p.droneSn);
    }
    for (const d of grouped.unboundSingles) unboundSingles.push({ ...d, regionId, regionName });
    for (const d of grouped.unboundRemotes) unboundRemotes.push({ ...d, regionId, regionName });
    for (const d of grouped.unboundDrones) unboundDrones.push({ ...d, regionId, regionName });
    for (const d of processor.getDeviceRegistryList()) {
      devices.push({ ...d, regionId, regionName });
    }
  }

  return { pairs, singlePairs, unboundSingles, unboundRemotes, unboundDrones, devices };
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

function auditLog(req, { action, status = 'success', detail, resource, actor } = {}) {
  const user = actor || req?.user;
  appendAuditEntry({
    action,
    status,
    actor: user
      ? { username: user.username, role: user.role }
      : { username: detail?.username || '(未知)', role: null },
    resource: resource || null,
    detail: detail || null,
    ip: req ? getClientIp(req) : null,
  });
}

const CLIENT_AUDIT_ACTIONS = new Set([
  'flight.export.records',
  'flight.export.ranking',
  'ai.image.generate',
  'ai.image.edit',
  'ai.image.polish',
  'ai.image.download',
]);

const AUDIT_ACTION_LABELS = {
  'auth.login': '登录',
  'auth.login_failed': '登录失败',
  'auth.logout': '退出登录',
  'ai.assistant.chat': 'AI 飞行助手对话',
  'assistant.model.update': '切换飞行助手模型',
  'ai.image.generate': 'AI 文生图',
  'ai.image.edit': 'AI 图生图',
  'ai.image.polish': 'AI 生图提示词润色',
  'ai.image.download': 'AI 生图下载',
  'flight.export.records': '导出飞行记录',
  'flight.export.ranking': '导出设备排名',
  'region.freeze_online': '固化区域线上配置',
};

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
      auditLog(req, { action: 'auth.login', actor: sanitizeUser(user) });
      return res.json({ token, user: sanitizeUser(user), expiresIn: TOKEN_TTL_MS });
    }
    auditLog(req, {
      action: 'auth.login_failed',
      status: 'denied',
      detail: { username: username || '(空)' },
    });
    return res.status(401).json({ error: '用户名或密码错误' });
  } catch (e) {
    console.error('[Auth] 登录失败:', e.message);
    return res.status(500).json({ error: '登录服务异常，请稍后重试' });
  }
});

app.post('/api/logout', requireLogin, (req, res) => {
  auditLog(req, { action: 'auth.logout' });
  sessions.delete(req.token);
  persistSessions();
  res.json({ success: true });
});

app.get('/api/me', requireLogin, (req, res) => {
  const user = readUsers().find(u => u.username === req.user.username);
  if (user) updateSessionUser(req.token, user);
  res.json({ user: sanitizeUser(user || req.user) });
});

app.get('/api/audit-logs', requirePermission('audit-log'), (req, res) => {
  const { startTime, endTime, action, category, username, limit, offset, stats } = req.query || {};
  const { list, result } = loadAuditLogsQuery({
    startTime,
    endTime,
    action,
    category,
    username,
    limit: limit ? Number(limit) : 20,
    offset: offset ? Number(offset) : 0,
  });
  const includeStats = stats !== '0' && stats !== 'false';
  res.json({
    ...result,
    actionLabels: AUDIT_ACTION_LABELS,
    ...(includeStats ? { stats: getAuditStats(list, { hours: 24 }) } : {}),
  });
});

app.post('/api/audit/client-event', requireLogin, (req, res) => {
  const { action, detail } = req.body || {};
  if (!CLIENT_AUDIT_ACTIONS.has(action)) {
    return res.status(400).json({ error: '无效的操作类型' });
  }
  auditLog(req, { action, detail: detail || null });
  res.json({ ok: true });
});

app.get('/api/users', requireAdmin, (req, res) => {
  const onlineStats = getOnlineUserStats();
  const flat = regionRuntime ? regionRuntime.listRegions() : [];
  const userCounts = countUsersByRegion(readUsers(), flat);
  const regions = flat.map((r) => ({ ...r, userCount: userCounts[r.id] || 0 }));
  res.json({
    regions,
    tree: regionRuntime ? buildRegionTree(regions) : [],
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
  const { username, password, permissions = [], regionId } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const resolvedRegion = String(regionId || DEFAULT_REGION_ID).trim();
  if (!getRegionById(resolvedRegion)) return res.status(400).json({ error: '所选区域不存在' });
  const users = readUsers();
  if (users.find(u => u.username === username)) return res.status(409).json({ error: '用户名已存在' });
  const safePermissions = permissions.filter(p => ALL_PERMISSIONS.includes(p));
  const user = {
    username,
    role: 'user',
    regionId: resolvedRegion,
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
  const { permissions, password, regionId } = req.body || {};
  const users = readUsers();
  const idx = users.findIndex(u => u.username === target);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });

  const user = users[idx];
  if (regionId) {
    const resolvedRegion = String(regionId).trim();
    if (!getRegionById(resolvedRegion)) return res.status(400).json({ error: '所选区域不存在' });
    user.regionId = resolvedRegion;
  }
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

// 设备名称与分类管理（管理员）
app.get('/api/device-registry', requirePermission('device-config'), attachRegionalProcessor, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { category, q } = req.query;
  const keyword = q ? String(q).trim().toLowerCase() : '';
  const regions = regionRuntime.listRegions();
  const leafProcessors = getLeafProcessorsInScope(req.visibleProcessors, regions);

  if (req.scopeUnmappedOnly) {
    const matchKeyword = (row) => !keyword || [
      row?.deviceId,
      row?.name,
      row?.mqttSourceRegionName,
      row?.mqttBroker,
    ].some((v) => String(v || '').toLowerCase().includes(keyword));

    let devices = regionRuntime.collectUnmappedDevicesFromScope(leafProcessors)
      .map((d) => ({
        deviceId: d.deviceId,
        name: d.deviceName || d.deviceId,
        category: leafProcessors.find((p) => p.regionId === d.mqttConnectionRegionId)?.processor.inferDeviceCategory(d.deviceId) || 'unknown',
        categoryLabel: DeviceProcessor.DEVICE_CATEGORY_LABELS.unknown,
        source: 'unmapped',
        online: true,
        lastSeen: d.lastUpdate || null,
        gateway: d.gateway || null,
        statusText: d.statusText || null,
        regionId: null,
        regionName: null,
        mqttConnectionRegionId: d.mqttConnectionRegionId,
        mqttProfileId: d.mqttProfileId,
        mqttProfileName: d.mqttProfileName,
        mqttSourceRegionId: d.mqttProfileId,
        mqttSourceRegionName: d.mqttProfileName,
        mqttBroker: d.mqttBroker,
        unmapped: true,
      }))
      .filter((d) => {
        const catOk = !category || category === 'all' || d.category === category;
        return catOk && matchKeyword(d);
      });

    devices.forEach((d) => {
      d.categoryLabel = DeviceProcessor.DEVICE_CATEGORY_LABELS[d.category] || d.category;
    });

    return res.json({
      pairs: [],
      singlePairs: [],
      unboundSingles: [],
      unboundRemotes: [],
      unboundDrones: [],
      devices,
      categories: DeviceProcessor.DEVICE_CATEGORY_LABELS,
      unmappedCount: devices.length,
      scopeUnmappedOnly: true,
      regionId: req.regionId,
      visibleRegionIds: req.visibleRegionIds,
    });
  }

  const grouped = leafProcessors.length > 1
    ? mergeDeviceRegistryGrouped(leafProcessors)
    : {
      ...leafProcessors[0].processor.getDeviceRegistryGrouped(),
      devices: leafProcessors[0].processor.getDeviceRegistryList(),
    };
  const matchKeyword = (row) => !keyword || [
    row?.deviceId,
    row?.name,
    row?.statusText,
  ].some((v) => String(v || '').toLowerCase().includes(keyword));

  const matchPair = (pair) => !keyword || matchKeyword(pair.airport) || matchKeyword(pair.drone);
  const matchSinglePair = (pair) => !keyword || matchKeyword(pair.remote) || matchKeyword(pair.drone);

  let pairs = grouped.pairs.filter(matchPair);
  let singlePairs = grouped.singlePairs.filter(matchSinglePair);

  if (category && category !== 'all') {
    if (category === 'airport' || category === 'airport_drone') {
      singlePairs = [];
    } else if (category === 'single' || category === 'remote') {
      pairs = [];
    }
  }

  const devices = filterUnmappedRegistryRows(
    (grouped.devices || req.processor.getDeviceRegistryList()).filter((d) => {
      const catOk = !category || category === 'all' || d.category === category
        || (category === 'airport_drone' && ['airport', 'airport_drone'].includes(d.category))
        || (category === 'remote' && ['single', 'remote'].includes(d.category));
      const kwOk = matchKeyword(d);
      return catOk && kwOk;
    }),
    req.user,
  );

  res.json({
    pairs,
    singlePairs,
    unboundSingles: filterUnmappedRegistryRows(grouped.unboundSingles.filter(matchKeyword), req.user),
    unboundRemotes: filterUnmappedRegistryRows(grouped.unboundRemotes.filter(matchKeyword), req.user),
    unboundDrones: filterUnmappedRegistryRows(grouped.unboundDrones.filter(matchKeyword), req.user),
    devices,
    categories: DeviceProcessor.DEVICE_CATEGORY_LABELS,
    unmappedCount: isAdminUser(req.user) ? devices.filter((d) => d.source === 'unmapped').length : 0,
    regionId: req.regionId,
    visibleRegionIds: req.visibleRegionIds,
  });
});

app.put('/api/device-registry/bindings/:airportSn', requirePermission('device-config'), attachRegionalProcessor, (req, res) => {
  const { droneSn, droneName } = req.body || {};
  try {
    const pair = req.processor.upsertAirportBinding(req.params.airportSn, droneSn, { droneName });
    regionRuntime.rebuildDeviceIndex();
    res.json({ message: '机场绑定已保存', pair });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/device-registry/remote-bindings/:remoteSn', requirePermission('device-config'), attachRegionalProcessor, (req, res) => {
  const { droneSn, droneName } = req.body || {};
  try {
    const pair = req.processor.upsertRemoteBinding(req.params.remoteSn, droneSn, { droneName });
    regionRuntime.rebuildDeviceIndex();
    res.json({ message: '单兵绑定已保存', pair });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/device-registry', requirePermission('device-config'), attachRegionalProcessor, (req, res) => {
  const { deviceId, name, category } = req.body || {};
  try {
    const device = req.processor.upsertDeviceRegistry(deviceId, { name, category });
    regionRuntime.rebuildDeviceIndex();
    res.json({ message: '设备映射已添加', device });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/device-registry/:deviceId', requirePermission('device-config'), attachRegionalProcessor, (req, res) => {
  const { name, category } = req.body || {};
  try {
    const device = req.processor.upsertDeviceRegistry(req.params.deviceId, { name, category });
    regionRuntime.rebuildDeviceIndex();
    res.json({ message: '设备映射已保存', device });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/device-registry/:deviceId', requirePermission('device-config'), attachRegionalProcessor, (req, res) => {
  try {
    req.processor.removeDeviceRegistryOverride(req.params.deviceId);
    regionRuntime.rebuildDeviceIndex();
    res.json({ message: '已恢复为内置/环境配置' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

regionRuntime = new RegionRuntime(thresholdConfig);
regionRuntime.init();

const { createAlertAiAnalyzer } = require('./lib/alert-ai-analyzer');
let mqttService;
const alertAiAnalyzer = createAlertAiAnalyzer({
  updateTokenUsage,
  getDeviceState: (deviceId) => regionRuntime.getDeviceState(deviceId),
  processor: regionRuntime.getDefaultProcessor(),
  getMqttService: () => mqttService,
  resolveRegionId: (deviceId) => regionRuntime.resolveRegionIdForDevice(deviceId),
});
const alertService = new AlertService({
  aiAnalyzer: alertAiAnalyzer,
  getDeviceState: (deviceId) => regionRuntime.getDeviceState(deviceId),
  processor: regionRuntime.getDefaultProcessor(),
  resolveRegionId: (deviceId) => regionRuntime.resolveRegionIdForDevice(deviceId),
  aiAnalysisEnabled: process.env.ALERT_AI_ENABLED !== '0',
});

const mqttManager = new MQTTManager(wsService, alertService, regionRuntime);
mqttService = mqttManager;

app.get('/api/regions', requireAdmin, (req, res) => {
  const flat = regionRuntime.listRegions();
  const userCounts = countUsersByRegion(readUsers(), flat);
  const regions = flat.map((region) => {
    const proc = regionRuntime.getProcessor(region.id);
    const registryPath = getRegionDeviceRegistryPath(region.id);
    let frozen = false;
    let mappingCount = 0;
    let deviceCount = 0;
    if (fs.existsSync(registryPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        frozen = !!raw?.meta?.frozen;
        mappingCount = Object.keys(raw?.mappings || {}).length;
      } catch {
        frozen = false;
      }
    }
    if (proc) deviceCount = proc.getAllDeviceStates().length;
    return {
      ...region,
      frozen,
      mappingCount,
      deviceCount,
      userCount: userCounts[region.id] || 0,
    };
  });
  res.json({
    regions,
    tree: buildRegionTree(regions),
    defaultRegionId: regionRuntime.defaultRegionId,
  });
});

app.post('/api/regions', requireAdmin, (req, res) => {
  try {
    const region = regionRuntime.addRegion(req.body || {});
    res.json({ message: '区域已创建', region });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/regions/:regionId', requireAdmin, (req, res) => {
  try {
    const { name, parentId } = req.body || {};
    if (name === undefined && parentId === undefined) {
      return res.status(400).json({ error: '请提供 name 或 parentId' });
    }
    const payload = {};
    if (name !== undefined) payload.name = name;
    if (parentId !== undefined) {
      payload.parentId = parentId === '' || parentId == null ? null : parentId;
    }
    const region = regionRuntime.updateRegionMeta(req.params.regionId, payload);
    const action = parentId !== undefined ? 'region.move' : 'region.rename';
    auditLog(req, {
      action,
      resource: { type: 'region', id: region.id },
      detail: {
        name: region.name,
        parentId: region.parentId,
      },
    });
    res.json({
      message: parentId !== undefined ? '区域已移动' : '区域名称已更新',
      region,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/regions/:regionId/freeze-online', requireAdmin, (req, res) => {
  try {
    const result = regionRuntime.freezeOnlineToRegion(req.params.regionId);
    auditLog(req, {
      action: 'region.freeze_online',
      resource: { type: 'region', id: req.params.regionId },
      detail: result,
    });
    res.json({ message: '已将当前线上配置固化到区域', ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function buildMqttProfileConnectionStatus() {
  const status = mqttManager.getStatus();
  const usageMap = getProfileUsageMap();
  const byProfile = {};
  for (const row of status.regions || []) {
    const conn = sanitizeConnectivityForApi(row.regionId);
    const profileId = conn.mqttProfileId;
    if (!profileId) continue;
    byProfile[profileId] = byProfile[profileId] || { connected: false, regions: [] };
    byProfile[profileId].connected = byProfile[profileId].connected || row.connected;
    byProfile[profileId].regions.push(row.regionId);
  }
  return byProfile;
}

app.get('/api/mqtt-profiles', requireAdmin, (req, res) => {
  const connectionStatus = buildMqttProfileConnectionStatus();
  const usageMap = getProfileUsageMap();
  const profiles = listProfilesForApi().map((p) => ({
    ...p,
    boundRegions: usageMap[p.id] || [],
    connected: connectionStatus[p.id]?.connected ?? null,
  }));
  res.json({ profiles });
});

app.post('/api/mqtt-profiles', requireAdmin, (req, res) => {
  try {
    const profile = createProfile(req.body || {});
    mqttManager.reload();
    auditLog(req, {
      action: 'mqtt_profile.create',
      resource: { type: 'mqtt_profile', id: profile.id },
      detail: { name: profile.name, broker: profile.mqtt?.brokerUrl },
    });
    res.json({
      message: 'MQTT 配置已创建',
      profile: sanitizeProfileForApi(profile),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/mqtt-profiles/:profileId', requireAdmin, (req, res) => {
  try {
    const profile = updateProfile(req.params.profileId, req.body || {});
    mqttManager.reload();
    auditLog(req, {
      action: 'mqtt_profile.update',
      resource: { type: 'mqtt_profile', id: profile.id },
      detail: { name: profile.name },
    });
    res.json({
      message: 'MQTT 配置已更新',
      profile: sanitizeProfileForApi(profile),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/mqtt-profiles/:profileId', requireAdmin, (req, res) => {
  try {
    deleteProfile(req.params.profileId);
    mqttManager.reload();
    auditLog(req, {
      action: 'mqtt_profile.delete',
      resource: { type: 'mqtt_profile', id: req.params.profileId },
    });
    res.json({ message: 'MQTT 配置已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/webhook-profiles', requirePermission('alert-config'), (req, res) => {
  res.json({ profiles: listWebhookProfilesForApi() });
});

app.post('/api/webhook-profiles', requirePermission('alert-config'), (req, res) => {
  try {
    const profile = createWebhookProfile(req.body || {});
    auditLog(req, {
      action: 'webhook_profile.create',
      resource: { type: 'webhook_profile', id: profile.id },
      detail: { name: profile.name, type: profile.type },
    });
    res.json({
      message: 'Webhook 配置已创建',
      profile: sanitizeWebhookProfileForApi(profile),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/webhook-profiles/:profileId', requirePermission('alert-config'), (req, res) => {
  try {
    const profile = updateWebhookProfile(req.params.profileId, req.body || {});
    auditLog(req, {
      action: 'webhook_profile.update',
      resource: { type: 'webhook_profile', id: profile.id },
      detail: { name: profile.name },
    });
    res.json({
      message: 'Webhook 配置已更新',
      profile: sanitizeWebhookProfileForApi(profile),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/webhook-profiles/:profileId', requirePermission('alert-config'), (req, res) => {
  try {
    deleteWebhookProfile(req.params.profileId);
    auditLog(req, {
      action: 'webhook_profile.delete',
      resource: { type: 'webhook_profile', id: req.params.profileId },
    });
    res.json({ message: 'Webhook 配置已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/webhook-profiles/:profileId/test', requirePermission('alert-config'), (req, res) => {
  const profile = getWebhookProfileById(req.params.profileId);
  if (!profile) return res.status(404).json({ error: 'Webhook 配置不存在' });
  if (!profile.url) return res.status(400).json({ error: 'Webhook URL 未配置' });
  try {
    alertService._sendWecomWebhook(profile.url, '测试设备', 'TEST-DEVICE', 99, 'test');
    recordProfileTest(profile.id, { ok: true, message: '测试成功' });
    res.json({ message: '测试消息已发送，请查看对应群聊' });
  } catch (e) {
    recordProfileTest(profile.id, { ok: false, message: e.message });
    res.status(500).json({ error: e.message || '发送失败' });
  }
});

app.get('/api/regions/:regionId/connectivity', requireAdmin, (req, res) => {
  const region = getRegionById(req.params.regionId);
  if (!region) return res.status(404).json({ error: '区域不存在' });
  res.json(sanitizeConnectivityForApi(req.params.regionId));
});

app.put('/api/regions/:regionId/connectivity', requireAdmin, (req, res) => {
  try {
    const region = getRegionById(req.params.regionId);
    if (!region) return res.status(404).json({ error: '区域不存在' });
    const body = req.body || {};
    const saved = writeRegionConnectivity(req.params.regionId, body);
    mqttManager.reload();
    auditLog(req, {
      action: 'region.connectivity_update',
      resource: { type: 'region', id: req.params.regionId },
      detail: {
        mqttProfileId: saved.mqttProfileId || null,
        streamBase: saved.stream?.baseUrl,
      },
    });
    res.json({
      message: saved.mqttProfileId
        ? '组织 MQTT 绑定已保存，连接已重连'
        : '区域连接配置已保存，MQTT 已重连',
      connectivity: sanitizeConnectivityForApi(req.params.regionId),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/stream/url', requireLogin, attachRegionalProcessor, (req, res) => {
  const deviceId = String(req.query.deviceId || '').trim();
  const suffix = String(req.query.suffix || '_out').trim();
  const regionIdParam = String(req.query.regionId || '').trim();
  const mqttProfileIdParam = String(req.query.mqttProfileId || '').trim();
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  let streamKey = resolveStreamConnectivityKey({
    regionId: regionIdParam,
    mqttProfileId: mqttProfileIdParam,
  });
  let mappedRegionId = regionIdParam || null;
  let mqttProfileId = mqttProfileIdParam || null;
  let unmapped = false;

  if (!streamKey) {
    mappedRegionId = regionRuntime.resolveRegionIdForDevice(deviceId) || null;
    if (mappedRegionId) {
      streamKey = mappedRegionId;
    } else {
      const device = regionRuntime.findDeviceInScope(
        deviceId,
        req.visibleProcessors,
        { unmappedOnly: true },
      );
      if (device) {
        streamKey = resolveStreamConnectivityKey({
          mqttProfileId: device.mqttProfileId,
          mqttConnectionRegionId: device.mqttConnectionRegionId,
        });
        mqttProfileId = device.mqttProfileId || mqttProfileId;
        unmapped = true;
      }
    }
  } else if (!mappedRegionId) {
    unmapped = true;
  }

  if (!streamKey) {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ error: '无权访问该设备推流' });
    }
    streamKey = regionRuntime.getUnmappedSinkRegionId();
    unmapped = true;
  }

  if (unmapped) {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ error: '无权访问该设备推流' });
    }
    const inScope = regionRuntime.findDeviceInScope(
      deviceId,
      req.visibleProcessors,
      { unmappedOnly: true, mqttSourceRegionId: mqttProfileId || null },
    );
    if (!inScope && !regionRuntime.getProcessorForDevice(deviceId)?.getDeviceState(deviceId)) {
      return res.status(403).json({ error: '无权访问该设备推流' });
    }
  } else if (!req.visibleRegionIds.includes(streamKey)) {
    return res.status(403).json({ error: '无权访问该区域推流' });
  }

  res.json({
    url: buildStreamUrl(streamKey, deviceId, suffix),
    regionId: mappedRegionId,
    mqttProfileId,
    streamKey,
    deviceId,
    suffix,
  });
});

alertService.setMqttService(mqttService);

mqttManager.connectAll();

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
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 每分钟检查一次机场是否离线
setInterval(() => alertService.checkAirportOffline(), 60 * 1000);

// API路由
registerImageRoutes(app, {
  requireImageStudio: requirePermission('image-studio'),
  auditLog,
  updateTokenUsage,
});
registerAssistantRoutes(app, {
  requireAssistant: requirePermission('ai-assistant'),
  requireAdmin,
  updateTokenUsage,
  auditLog,
  enrichAssistantContext: (ctx, req) => {
    const scopeRegionId = ctx?.scopeRegionId || req.body?.scopeRegionId || '';
    try {
      const resolved = resolveRegionalScope(req?.user, scopeRegionId);
      return enrichAssistantContextWithScope(ctx || {}, {
        regionRuntime,
        ...resolved,
      });
    } catch (e) {
      console.warn('[Assistant] 区域隔离失败:', e.message);
      return { ...ctx, scopeError: e.message };
    }
  },
});

const arkKey = (process.env.ARK_API_KEY || '').trim();
const { getAssistantModelSettings } = require('./lib/assistant-model-store');
const assistantModelSettings = getAssistantModelSettings();
const arkModel = assistantModelSettings.modelId;
const alertAiOn = process.env.ALERT_AI_ENABLED !== '0' && !!arkKey;
console.log(`[Assistant] Ark: key=${arkKey ? '已配置' : '未配置'}, model=${arkModel || '(空)'} (${assistantModelSettings.model?.name || '默认'})`);
console.log(`[AlertAI] 告警多模态分析: ${alertAiOn ? '已启用' : '未启用'}`);
console.log(`[Ark] 联网搜索: ${process.env.ARK_WEB_SEARCH || 'auto'}（有外网时自动开启）`);

function buildAlertConfigPayload(req) {
  const procs = req?.visibleProcessors
    || regionRuntime.getScopeForUser(req?.user).processors
    || [{ processor: regionRuntime.getDefaultProcessor() }];
  const regions = regionRuntime.listRegions();
  const { ids: allowedIds } = collectAlertConfigDeviceIds(procs, regions);
  const scoped = alertService.getScopedConfig({
    visibleRegionIds: req.visibleRegionIds,
    regionId: req.regionId,
    processors: procs,
  });
  const deviceConfigs = {};
  for (const id of allowedIds) {
    deviceConfigs[id] = scoped.deviceConfigs[id] || {};
  }
  const deviceNameMap = {};
  const leafProcs = collectAlertConfigDeviceIds(procs, regions).procs || procs;
  allowedIds.forEach((id) => {
    const found = regionRuntime.findDeviceInScope(id, leafProcs);
    if (found) {
      deviceNameMap[id] = found.deviceName || id;
    } else {
      const proc = regionRuntime.getProcessorForDevice(id);
      const state = proc?.getDeviceState(id);
      deviceNameMap[id] = proc?.getDeviceName(id, state?.gateway || null) || id;
    }
  });
  const deviceRegionMap = {};
  allowedIds.forEach((id) => {
    deviceRegionMap[id] = resolveRegionIdInScope(id, leafProcs, regions)
      || regionRuntime.resolveRegionIdForDevice(id);
  });
  return {
    globalWebhookUrl: scoped.globalWebhookUrl,
    globalWebhookProfileId: scoped.globalWebhookProfileId,
    regionWebhooks: scoped.regionWebhooks,
    regionWebhookProfileIds: scoped.regionWebhookProfileIds,
    leafRegions: scoped.leafRegions,
    deviceConfigs,
    deviceNameMap,
    deviceRegionMap,
    regionId: req.regionId,
    visibleRegionIds: req.visibleRegionIds,
  };
}

// 获取离巢告警配置
app.get('/api/alert-config', requireLogin, attachRegionalProcessor, (req, res) => {
  res.json(buildAlertConfigPayload(req));
});

// 更新离巢告警配置
app.post('/api/alert-config', requireLogin, attachRegionalProcessor, (req, res) => {
  alertService.updateScopedConfigs(req.regionScope, req.body);
  res.json({ message: '告警配置已保存', config: buildAlertConfigPayload(req) });
});

// 手动触发飞丢告警（测试截图 + AI + 企业微信推送）
app.post('/api/alert-config/trigger-lost', requireLogin, attachRegionalProcessor, (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });
  if (!regionRuntime.findDeviceInScope(deviceId, req.visibleProcessors, collectScopeOptions(req))) {
    return res.status(403).json({ error: '无权操作该设备' });
  }
  const proc = processorForDevice(deviceId);
  const state = proc?.getDeviceState?.(deviceId);
  const deviceName = proc?.getDeviceName(deviceId, state?.gateway || null);
  const regions = regionRuntime.listRegions();
  const regionId = resolveRegionIdInScope(deviceId, req.visibleProcessors, regions)
    || regionRuntime.resolveRegionIdForDevice(deviceId);
  const result = alertService.triggerLostAlertTest(deviceId, deviceName, regionId);
  if (!result.ok) {
    return res.status(result.error?.includes('执行中') ? 409 : 400).json({ error: result.error });
  }
  res.json({ message: '飞丢告警测试已触发', pid: result.pid });
});

// 测试推送
app.post('/api/alert-config/test', requireLogin, attachRegionalProcessor, (req, res) => {
  const { webhookUrl, snapshotDeviceId, snapshotStream } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: '缺少 webhookUrl' });
  const scopedDevices = regionRuntime.collectDevicesFromScope(
    req.visibleProcessors,
    regionRuntime.listRegions(),
    collectScopeOptions(req),
  );
  const fallback = scopedDevices.find((d) => d.deviceType === 'airport' || d.deviceType === 'remote');
  const testDeviceId = snapshotDeviceId || fallback?.deviceId;
  if (!testDeviceId || !regionRuntime.findDeviceInScope(testDeviceId, req.visibleProcessors, collectScopeOptions(req))) {
    return res.status(400).json({ error: '当前区域没有可用于测试的设备' });
  }
  alertService._sendWecomWebhook(webhookUrl, '测试设备', testDeviceId, 99, 'test');
  alertService._sendStreamSnapshot(webhookUrl, testDeviceId, '_out');
  alertService._sendStreamSnapshot(webhookUrl, testDeviceId, '_in');
  alertService._sendStreamSnapshot(webhookUrl, testDeviceId, '_flight');
  res.json({ message: '测试消息已发送' });
});

// 获取连接状态
app.get('/api/status', (req, res) => {
  const mqttStatus = mqttManager.getStatus();
  res.json({
    mqtt: {
      ...mqttStatus,
      broker: mqttStatus.regions[0]?.broker || process.env.MQTT_BROKER_URL,
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

app.get('/api/devices', requireLogin, attachRegionalProcessor, (req, res) => {
  const devices = regionRuntime.collectDevicesFromScope(
    req.visibleProcessors,
    regionRuntime.listRegions(),
    collectScopeOptions(req),
  );
  res.json({
    count: devices.length,
    devices,
    regionId: req.regionId,
    visibleRegionIds: req.visibleRegionIds,
  });
});

// 获取单个设备状态
app.get('/api/devices/:deviceId', requireLogin, attachRegionalProcessor, (req, res) => {
  const device = regionRuntime.findDeviceInScope(req.params.deviceId, req.visibleProcessors, collectScopeOptions(req));
  if (device) {
    res.json(device);
  } else {
    res.status(404).json({ error: '设备未找到' });
  }
});

// 更新阈值配置
app.post('/api/thresholds', (req, res) => {
  const { thresholds } = req.body;
  const proc = regionRuntime.getDefaultProcessor();
  proc.updateThresholds(thresholds);
  res.json({ 
    message: '阈值配置已更新',
    thresholds: proc.thresholds 
  });
});

// 获取当前阈值配置
app.get('/api/thresholds', (req, res) => {
  res.json(regionRuntime.getDefaultProcessor().thresholds);
});

// 手动重连MQTT
app.post('/api/mqtt/reconnect', (req, res) => {
  mqttManager.reconnect();
  res.json({ message: '正在重新连接各区域 MQTT...' });
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

function flightScopeOptions(req, query = {}) {
  const { mqttProfileId } = query;
  return {
    unmappedOnly: !!req.scopeUnmappedOnly,
    mqttProfileId: mqttProfileId ? String(mqttProfileId).trim() : null,
  };
}

function buildActiveFlightSessions(type, reqOrProc, scopeOptions = {}) {
  const regions = regionRuntime.listRegions();
  const options = {
    unmappedOnly: !!scopeOptions.unmappedOnly,
    mqttProfileId: scopeOptions.mqttProfileId || null,
  };
  if (reqOrProc?.visibleProcessors) {
    return regionRuntime.buildActiveSessionsFromScope(
      type,
      reqOrProc.visibleProcessors,
      regions,
      options,
    );
  }
  const proc = reqOrProc?.primaryProcessor || reqOrProc || regionRuntime.getDefaultProcessor();
  return regionRuntime.buildActiveSessionsFromScope(
    type,
    [{ regionId: proc.regionId, regionName: proc.regionId, processor: proc }],
    regions,
    options,
  );
}

function flightScopeMeta(req) {
  const regions = regionRuntime.listRegions();
  const leafProcs = getLeafProcessorsInScope(req.visibleProcessors, regions);
  return {
    regionId: req.regionId,
    visibleRegionIds: req.visibleRegionIds,
    scopeUnmappedOnly: !!req.scopeUnmappedOnly,
    leafRegions: leafProcs.map(({ regionId, regionName }) => ({ id: regionId, name: regionName || regionId })),
  };
}

function loadScopedFlightHistory(req, query = {}) {
  const { type, startTime, endTime } = query;
  return regionRuntime.collectFlightHistoryFromScope(
    req.visibleProcessors,
    regionRuntime.listRegions(),
    { type, startTime, endTime, ...flightScopeOptions(req, query) },
  );
}

// 获取飞行统计摘要（首屏：汇总 + 排名，不含明细列表）
app.get('/api/flight-summary', requireLogin, attachRegionalProcessor, (req, res) => {
  noCache(res);
  const { type, startTime, endTime } = req.query;
  const history = loadScopedFlightHistory(req, { type, startTime, endTime });
  const active = buildActiveFlightSessions(type, req, flightScopeOptions(req, req.query));
  const ranking = buildFlightRanking(history);
  const scopeOpts = flightScopeOptions(req, req.query);
  const { matchesScopeDeviceType, isDeviceOnline } = require('./lib/flight-query');
  const scopedDevices = regionRuntime.collectDevicesFromScope(
    req.visibleProcessors,
    regionRuntime.listRegions(),
    scopeOpts,
  ).filter((d) => matchesScopeDeviceType(d, type));
  res.json({
    stats: buildFlightStats(history),
    ranking,
    daily: buildDailyDistribution(history, startTime, endTime),
    deviceCount: scopedDevices.length,
    onlineCount: scopedDevices.filter(isDeviceOnline).length,
    flightDeviceCount: ranking.length,
    activeCount: active.length,
    totalRecords: history.length + active.length,
    ...flightScopeMeta(req),
  });
});

// 获取飞行统计历史
app.get('/api/flight-history', requireLogin, attachRegionalProcessor, (req, res) => {
  noCache(res);
  const { type, startTime, endTime } = req.query;
  const history = loadScopedFlightHistory(req, { type, startTime, endTime });
  res.json({ history, ...flightScopeMeta(req) });
});

// 获取飞行记录列表（已完成 + 进行中，支持分页）
app.get('/api/flight-records', requireLogin, attachRegionalProcessor, (req, res) => {
  noCache(res);
  const { type, startTime, endTime, page, limit, all } = req.query;
  const history = loadScopedFlightHistory(req, { type, startTime, endTime });
  const active = buildActiveFlightSessions(type, req, flightScopeOptions(req, req.query));
  const records = mergeFlightRecords(active, history);
  console.log(`[飞行记录接口] /api/flight-records type=${type || 'all'} completed=${history.length} active=${active.length} total=${records.length}: ${active.map(s => `${s.deviceName || s.deviceId}(${s.deviceType})`).join(', ') || '无进行中'}`);

  if (all === '1' || all === 'true') {
    return res.json({ records, history, active, total: records.length, ...flightScopeMeta(req) });
  }

  const paged = paginateRecords(records, page, limit);
  res.json({
    records: paged.records,
    total: paged.total,
    page: paged.page,
    limit: paged.limit,
    activeCount: active.length,
    ...flightScopeMeta(req),
  });
});

// 获取进行中的飞行会话
app.get('/api/flight-active', requireLogin, attachRegionalProcessor, (req, res) => {
  noCache(res)
  const { type } = req.query;
  const allSessions = buildActiveFlightSessions(null, req);
  console.log(`[飞行记录接口] /api/flight-active type=${type || 'all'} activeSessions=${allSessions.length}`);
  const sessions = buildActiveFlightSessions(type, req);
  console.log(`[飞行记录接口] 返回进行中=${sessions.length}: ${sessions.map(s => `${s.deviceName || s.deviceId}(${s.deviceType})`).join(', ') || '无'}`);
  res.json(sessions);
});

// 模拟飞行测试接口（仅供调试，触发后立刻生成一条已完成的虚拟飞行记录）
app.post('/api/simulate-flight', requireLogin, attachRegionalProcessor, (req, res) => {
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
  req.processor.flightHistory.push(record);
  req.processor.saveFlightHistory();
  req.processor.logFlight(`[模拟飞行] 写入虚拟记录 ${deviceName} duration=${durationSec}s mileage=${mileage}m`);
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
  mqttManager.disconnect();
  wsService.close();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  process.emit('SIGTERM');
});
