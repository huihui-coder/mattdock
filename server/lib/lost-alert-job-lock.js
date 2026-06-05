const fs = require('fs');
const path = require('path');

const LOCK_DIR = path.join(__dirname, '../data/lost-alert-locks');

function lockPathFor(deviceId) {
  return path.join(LOCK_DIR, `${deviceId}.lock`);
}

function isPidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 跨进程互斥：同一设备同时只允许一个飞丢截图任务
 * @returns {boolean} 是否成功占用
 */
function tryAcquireLostAlertJobLock(deviceId) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lockPath = lockPathFor(deviceId);
  const payload = JSON.stringify({ pid: process.pid, at: Date.now() });

  try {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const info = JSON.parse(raw);
    if (!isPidAlive(info.pid)) {
      fs.unlinkSync(lockPath);
      return tryAcquireLostAlertJobLock(deviceId);
    }
  } catch {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
    return tryAcquireLostAlertJobLock(deviceId);
  }

  return false;
}

function releaseLostAlertJobLock(deviceId) {
  const lockPath = lockPathFor(deviceId);
  try {
    if (!fs.existsSync(lockPath)) return;
    const raw = fs.readFileSync(lockPath, 'utf8');
    const info = JSON.parse(raw);
    if (info.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    /* ignore */
  }
}

function isLostAlertJobRunning(deviceId) {
  const lockPath = lockPathFor(deviceId);
  if (!fs.existsSync(lockPath)) return false;
  try {
    const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return isPidAlive(info.pid);
  } catch {
    return false;
  }
}

module.exports = {
  tryAcquireLostAlertJobLock,
  releaseLostAlertJobLock,
  isLostAlertJobRunning,
};
