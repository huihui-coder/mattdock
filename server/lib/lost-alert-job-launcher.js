const path = require('path');
const { spawn } = require('child_process');
const { isLostAlertJobRunning } = require('./lost-alert-job-lock');

/**
 * 在独立子进程中执行飞丢截图+AI，避免 nodemon 热重载打断主进程
 * @returns {number|null} 子进程 pid；已有任务在跑时返回 null
 */
function launchLostAlertJob(payload) {
  const { deviceId, deviceName } = payload;
  if (isLostAlertJobRunning(deviceId)) {
    console.log(`[AlertService] 飞丢截图任务已在执行，跳过 ${deviceName} (${deviceId})`);
    return null;
  }

  const script = path.join(__dirname, '../jobs/run-lost-alert-job.js');
  const encoded = JSON.stringify(payload);

  const child = spawn(process.execPath, [script, encoded], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LOST_ALERT_MAIN_PORT: String(process.env.PORT || 3001),
    },
    windowsHide: true,
  });

  const forward = (chunk) => {
    process.stdout.write(chunk);
  };
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);
  child.on('exit', (code) => {
    console.log(`[AlertService] 飞丢截图子进程结束 pid=${child.pid} code=${code ?? '?'}`);
  });

  child.unref();
  console.log(`[AlertService] 已启动独立飞丢截图子进程 pid=${child.pid}（日志见下方 [LostAlertJob]/[DockLostSnap]）`);
  return child.pid;
}

module.exports = { launchLostAlertJob };
