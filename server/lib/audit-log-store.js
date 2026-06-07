const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_FILE = path.join(__dirname, '../../haizhuDB/audit-log.json');
const MAX_RECORDS = 2000;

let _logCache = { mtime: 0, list: [], at: 0 };

function readLogsFromDisk() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[AuditLog] 读取失败:', e.message);
    return [];
  }
}

function readLogs(force = false) {
  const now = Date.now();
  let mtime = 0;
  try {
    if (fs.existsSync(LOG_FILE)) mtime = fs.statSync(LOG_FILE).mtimeMs;
  } catch {
    mtime = 0;
  }
  if (!force && _logCache.mtime === mtime && now - _logCache.at < 5000) {
    return _logCache.list;
  }
  const list = readLogsFromDisk();
  _logCache = { mtime, list, at: now };
  return list;
}

function invalidateLogCache(list) {
  _logCache.list = list;
  _logCache.at = Date.now();
  try {
    if (fs.existsSync(LOG_FILE)) _logCache.mtime = fs.statSync(LOG_FILE).mtimeMs;
  } catch {
    _logCache.mtime = 0;
  }
}

function writeLogs(list) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const trimmed = list.slice(0, MAX_RECORDS);
    fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    invalidateLogCache(trimmed);
  } catch (e) {
    console.warn('[AuditLog] 写入失败:', e.message);
  }
}

function appendAuditEntry(entry) {
  const list = readLogs();
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    status: 'success',
    ...entry,
  };
  list.unshift(record);
  writeLogs(list);
  return record;
}

function getActionCategory(action) {
  const key = String(action || '');
  if (key.startsWith('auth.')) return 'auth';
  if (key.startsWith('ai.')) return 'ai';
  if (key.startsWith('flight.')) return 'flight';
  if (key.startsWith('device.')) return 'device';
  if (key.startsWith('user.')) return 'user';
  return 'other';
}

function queryAuditLogs(list, {
  startTime,
  endTime,
  action,
  category,
  username,
  limit = 100,
  offset = 0,
} = {}) {
  let filtered = list;

  if (startTime) {
    const start = new Date(startTime).getTime();
    if (!Number.isNaN(start)) filtered = filtered.filter((r) => new Date(r.timestamp).getTime() >= start);
  }
  if (endTime) {
    const end = new Date(endTime).getTime();
    if (!Number.isNaN(end)) filtered = filtered.filter((r) => new Date(r.timestamp).getTime() <= end);
  }
  if (action) filtered = filtered.filter((r) => r.action === action);
  if (category) filtered = filtered.filter((r) => getActionCategory(r.action) === category);
  if (username) filtered = filtered.filter((r) => r.actor?.username === username);

  const total = filtered.length;
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 500);
  const pageOffset = Math.max(Number(offset) || 0, 0);
  const items = filtered.slice(pageOffset, pageOffset + pageSize);
  return { total, items, limit: pageSize, offset: pageOffset };
}

function getAuditStats(list, { hours = 24 } = {}) {
  const since = Date.now() - hours * 3600000;
  const recent = list.filter((r) => new Date(r.timestamp).getTime() >= since);
  const byAction = {};
  const byUser = {};
  for (const r of recent) {
    byAction[r.action] = (byAction[r.action] || 0) + 1;
    const u = r.actor?.username || '(未知)';
    byUser[u] = (byUser[u] || 0) + 1;
  }
  return { total: recent.length, byAction, byUser, hours };
}

function loadAuditLogsQuery(options = {}) {
  const list = readLogs();
  const result = queryAuditLogs(list, options);
  return { list, result };
}

module.exports = {
  appendAuditEntry,
  queryAuditLogs,
  getAuditStats,
  loadAuditLogsQuery,
  getActionCategory,
  readLogs,
};
