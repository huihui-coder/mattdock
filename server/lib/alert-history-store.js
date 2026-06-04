const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../../haizhuDB/alert-history.json');
const MAX_RECORDS = 500;

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[AlertHistory] 读取失败:', e.message);
    return [];
  }
}

function writeHistory(list) {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, MAX_RECORDS), null, 2), 'utf8');
  } catch (e) {
    console.warn('[AlertHistory] 写入失败:', e.message);
  }
}

function appendAlertRecord(record) {
  const list = readHistory();
  list.unshift({
    id: `${record.deviceId}_${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...record,
  });
  writeHistory(list);
  return list[0];
}

function getRecentAlerts(deviceId, limit = 8) {
  return readHistory()
    .filter((r) => r.deviceId === deviceId)
    .slice(0, limit);
}

function formatHistoryForPrompt(records) {
  if (!records.length) return '该设备暂无历史告警记录。';
  return records
    .map((r, i) => {
      const time = r.createdAt || r.timestamp || '';
      const ai = r.aiAnalysis ? `；AI结论摘要：${String(r.aiAnalysis).slice(0, 120)}…` : '';
      return `${i + 1}. [${time}] ${r.alertType || r.type} | ${r.summary || r.detail || ''}${ai}`;
    })
    .join('\n');
}

module.exports = {
  appendAlertRecord,
  getRecentAlerts,
  formatHistoryForPrompt,
  readHistory,
};
