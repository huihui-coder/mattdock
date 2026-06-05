/**
 * Dock 系列机场 — 飞丢告警监控截图
 * 开补光灯 → 舱外 → 等 3s → 截图 → 舱内 → 等 3s → 截图 → 舱外 → 关补光灯（finally 保底）
 * 无人机 _flight 画面单独截取，不参与相机切换
 */
const { captureStreamSnapshot, captureStreamSnapshots } = require('./stream-snapshot');
const { resolveVideoId, METHOD_LIVE_CAMERA_CHANGE } = require('./live-camera-service');
const { isDockSharedOutAirport, METHOD_SUPPLEMENT_LIGHT_OPEN, METHOD_SUPPLEMENT_LIGHT_CLOSE } = require('./dock-service');

const POST_SWITCH_DELAY_MS = Number(process.env.DOCK_ALERT_SWITCH_DELAY_MS || 3000);
const SNAPSHOT_TIMEOUT_MS = Number(process.env.DOCK_ALERT_SNAPSHOT_TIMEOUT_MS || 25000);

const runningByDevice = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDockLostSnapshotTarget(deviceId, getDeviceState) {
  const state = getDeviceState?.(deviceId);
  return isDockSharedOutAirport({
    deviceId,
    deviceType: state?.deviceType || 'airport',
    deviceName: state?.deviceName || deviceId,
  });
}

/**
 * @returns {Promise<{ shots: Array, errors: string[] }>}
 */
async function runDockLostSnapshotSequence(deviceId, mqttService, processor) {
  const conn = mqttService?.getForDevice?.(deviceId) || mqttService;
  if (!conn?.isConnected?.()) {
    return { shots: [], errors: ['MQTT 未连接，无法执行 Dock 截图流程'] };
  }

  const publish = (method, data) => mqttService.publishService(deviceId, method, data);
  const videoId = resolveVideoId(deviceId);
  const errors = [];
  const shots = [];

  const patchCamera = (pos) => {
    processor?.patchDockControlState?.(deviceId, {
      liveCameraPosition: pos,
      source: 'lost_alert',
    });
  };

  const patchLight = (on) => {
    processor?.patchDockControlState?.(deviceId, {
      supplementLightState: on ? 1 : 0,
      source: 'lost_alert',
    });
  };

  /** 下发 MQTT → 固定等待 → 不阻塞在 services_reply */
  const switchCamera = async (position, label) => {
    await publish(METHOD_LIVE_CAMERA_CHANGE, {
      camera_position: position,
      video_id: videoId,
    });
    patchCamera(position);
    console.log(`[DockLostSnap] ${deviceId} 已下发 ${label}，等待 ${POST_SWITCH_DELAY_MS}ms…`);
    await sleep(POST_SWITCH_DELAY_MS);
  };

  const setSupplementLight = async (open) => {
    const method = open ? METHOD_SUPPLEMENT_LIGHT_OPEN : METHOD_SUPPLEMENT_LIGHT_CLOSE;
    await publish(method, null);
    patchLight(open);
    console.log(`[DockLostSnap] ${deviceId} 已下发补光灯${open ? '打开' : '关闭'}`);
    await sleep(1000);
  };

  const snapNow = async (captureTag, label) => {
    console.log(`[DockLostSnap] ${deviceId} 开始截图: ${label}`);
    const regionId = processor?.regionId || null;
    const shot = await captureStreamSnapshot(deviceId, '_out', SNAPSHOT_TIMEOUT_MS, regionId);
    if (!shot) {
      errors.push(`${label}截图失败`);
      console.warn(`[DockLostSnap] ${deviceId} ${label} 截图失败`);
      return;
    }
    shots.push({ ...shot, label, captureTag });
    console.log(`[DockLostSnap] ${deviceId} ${label} 截图完成 (${Math.round(shot.buffer.length / 1024)}KB)`);
  };

  const ensureExternalAndLightOff = async () => {
    try {
      await switchCamera(1, '舱外推流（恢复）');
    } catch (e) {
      errors.push(`恢复舱外摄像头失败: ${e.message}`);
      console.warn(`[DockLostSnap] ${deviceId} 恢复舱外失败:`, e.message);
    }
    try {
      await setSupplementLight(false);
    } catch (e) {
      errors.push(`关闭补光灯失败: ${e.message}`);
      console.warn(`[DockLostSnap] ${deviceId} 关闭补光灯失败:`, e.message);
    }
  };

  console.log(`[DockLostSnap] ${deviceId} 开始 Dock 飞丢截图流程`);

  try {
    await setSupplementLight(true);

    await switchCamera(1, '舱外推流');
    await snapNow('external', '机场外部监控（舱外推流）');

    await switchCamera(0, '舱内推流');
    await snapNow('internal', '机场内部监控（舱内推流）');

    await switchCamera(1, '舱外推流');
  } catch (e) {
    errors.push(e.message || 'Dock 截图流程异常');
    console.error(`[DockLostSnap] ${deviceId} 流程中断:`, e.message);
  } finally {
    await ensureExternalAndLightOff();
  }

  console.log(
    `[DockLostSnap] ${deviceId} 流程结束，截图 ${shots.length} 张${errors.length ? `，异常: ${errors.join('; ')}` : ''}`,
  );

  return { shots, errors };
}

async function captureFlightSnapshot(deviceId, regionId = null) {
  console.log(`[DockLostSnap] ${deviceId} 开始截取无人机画面`);
  const shot = await captureStreamSnapshot(deviceId, '_flight', SNAPSHOT_TIMEOUT_MS, regionId);
  if (!shot) {
    console.warn(`[DockLostSnap] ${deviceId} 无人机画面截图失败`);
    return null;
  }
  console.log(`[DockLostSnap] ${deviceId} 无人机画面截图完成`);
  return { ...shot, captureTag: 'flight', label: shot.label || '无人机画面' };
}

/**
 * 飞丢告警截图（Dock 走 MQTT 切换流程，其它机场沿用多路流）
 */
async function captureLostAlertSnapshots(deviceId, { mqttService, getDeviceState, processor } = {}) {
  const dock = isDockLostSnapshotTarget(deviceId, getDeviceState);

  if (dock && mqttService) {
    const existing = runningByDevice.get(deviceId);
    if (existing) {
      console.log(`[DockLostSnap] ${deviceId} 截图流程进行中，跳过重复触发`);
      return [];
    }

    const job = (async () => {
      const { shots: dockShots, errors } = await runDockLostSnapshotSequence(
        deviceId,
        mqttService,
        processor,
      );
      const flight = await captureFlightSnapshot(deviceId, processor?.regionId);
      const all = flight ? [...dockShots, flight] : [...dockShots];
      if (errors.length) {
        console.warn(`[DockLostSnap] ${deviceId} 部分步骤失败:`, errors.join('; '));
      }
      return all;
    })();

    runningByDevice.set(deviceId, job);
    try {
      return await job;
    } finally {
      runningByDevice.delete(deviceId);
    }
  }

  return captureStreamSnapshots(deviceId, ['_out', '_in', '_flight'], processor?.regionId);
}

module.exports = {
  captureLostAlertSnapshots,
  runDockLostSnapshotSequence,
  isDockLostSnapshotTarget,
  POST_SWITCH_DELAY_MS,
};
