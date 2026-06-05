const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_FILE = path.join(__dirname, '../../haizhuDB/audit-log.json');
const MAX_RECORDS = 2000;

function readLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[AuditLog] 读取失败:', e.message);
    return [];
  }
}

function writeLogs(list) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(list.slice(0, MAX_RECORDS), null, 2), 'utf8');
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

function queryAuditLogs({
  startTime,
  endTime,
  action,
  category,
  username,
  limit = 100,
  offset = 0,
} = {}) {
  let list = readLogs();

  if (startTime) {
    const start = new Date(startTime).getTime();
    if (!Number.isNaN(start)) list = list.filter((r) => new Date(r.timestamp).getTime() >= start);
  }
  if (endTime) {
    const end = new Date(endTime).getTime();
    if (!Number.isNaN(end)) list = list.filter((r) => new Date(r.timestamp).getTime() <= end);
  }
  if (action) list = list.filter((r) => r.action === action);
  if (category) list = list.filter((r) => getActionCategory(r.action) === category);
  if (username) list = list.filter((r) => r.actor?.username === username);

  const total = list.length;
  const items = list.slice(offset, offset + Math.min(Math.max(limit, 1), 500));
  return { total, items, limit, offset };
}

function getAuditStats({ hours = 24 } = {}) {
  const since = Date.now() - hours * 3600000;
  const recent = readLogs().filter((r) => new Date(r.timestamp).getTime() >= since);
  const byAction = {};
  const byUser = {};
  for (const r of recent) {
    byAction[r.action] = (byAction[r.action] || 0) + 1;
    const u = r.actor?.username || '(未知)';
    byUser[u] = (byUser[u] || 0) + 1;
  }
  return { total: recent.length, byAction, byUser, hours };
}

module.exports = {
  appendAuditEntry,
  queryAuditLogs,
  getAuditStats,
  getActionCategory,
  readLogs,
};
