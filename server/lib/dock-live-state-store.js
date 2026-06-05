/**
 * Dock 直播相机位置持久化（舱内/舱外）
 * DJI 物模型 live_status 不含 camera_position，内外相机 index 同为 165-0-7，需本地记录。
 */
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../data/dock-live-state.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[DockLiveState] 写入失败:', e.message);
  }
}

function getLiveCameraPosition(deviceId) {
  const store = readStore();
  const entry = store[deviceId];
  if (!entry) return null;
  const pos = entry.liveCameraPosition;
  return pos === 0 || pos === 1 ? pos : null;
}

function setLiveCameraPosition(deviceId, position, source = 'unknown') {
  if (position !== 0 && position !== 1) return;
  const store = readStore();
  store[deviceId] = {
    liveCameraPosition: position,
    source,
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

module.exports = {
  getLiveCameraPosition,
  setLiveCameraPosition,
};
