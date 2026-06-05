/**
 * 独立子进程：Dock 飞丢截图 + 推送（告警正文 → 截图 → AI 分析）
 * MQTT 经主进程 HTTP 代理，不复用第二路 broker 连接
 */
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const DeviceProcessor = require('../device-processor');
const { createAlertAiAnalyzer } = require('../lib/alert-ai-analyzer');
const { captureLostAlertSnapshots } = require('../lib/dock-lost-alert-snapshots');
const {
  buildLostAlertMarkdown,
  buildLostAlertAiMarkdown,
} = require('../lib/lost-alert-markdown');
const { postWecomPayload, postWecomMarkdown } = require('../lib/wecom-webhook');
const { createLostAlertMqttBridge } = require('../lib/lost-alert-mqtt-bridge');
const {
  tryAcquireLostAlertJobLock,
  releaseLostAlertJobLock,
} = require('../lib/lost-alert-job-lock');

const LOG = '[LostAlertJob]';

async function sendSnapshotShot(webhookUrl, shot) {
  if (!shot?.base64) return;
  const md5 = crypto.createHash('md5').update(shot.buffer).digest('hex');
  await postWecomPayload(
    webhookUrl,
    { msgtype: 'image', image: { base64: shot.base64, md5 } },
    LOG,
  );
  console.log(`${LOG} 截图已推送 ${shot.label || shot.suffix}`);
}

async function sendAllSnapshotShots(webhookUrl, shots) {
  for (const shot of shots) {
    try {
      await sendSnapshotShot(webhookUrl, shot);
    } catch (e) {
      console.warn(`${LOG} 截图推送失败:`, e.message);
    }
  }
}

async function sendMarkdown(webhookUrl, content, label = '告警正文') {
  await postWecomMarkdown(webhookUrl, content, LOG);
  console.log(`${LOG} ${label}已推送`);
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error(`${LOG} 缺少任务参数`);
    process.exit(1);
  }

  let job;
  try {
    job = JSON.parse(raw);
  } catch (e) {
    console.error(`${LOG} 任务参数解析失败:`, e.message);
    process.exit(1);
  }

  const {
    deviceId,
    deviceName,
    elapsedMin,
    webhookUrl,
    location,
    subDeviceOnline,
    deviceState,
    sendSnapshot = true,
    aiEnabled = true,
    thresholdMinutes,
  } = job;

  console.log(`${LOG} 开始 pid=${process.pid} ${deviceName} (截图=${sendSnapshot}, AI=${aiEnabled})`);

  if (!tryAcquireLostAlertJobLock(deviceId)) {
    console.log(`${LOG} 已有任务在执行，退出 ${deviceName} (${deviceId})`);
    process.exit(0);
  }

  const processor = new DeviceProcessor({});
  const mqttService = createLostAlertMqttBridge();

  const alertAiAnalyzer = createAlertAiAnalyzer({
    getDeviceState: (id) => (id === deviceId ? deviceState : null),
    processor,
    getMqttService: () => mqttService,
  });

  let shots = [];
  let analysis = null;

  try {
    await mqttService.ensureConnected();
    console.log(`${LOG} 已通过主进程 MQTT 代理就绪`);

    if (sendSnapshot) {
      shots = await captureLostAlertSnapshots(deviceId, {
        mqttService,
        processor,
        getDeviceState: (id) =>
          id === deviceId
            ? { deviceId, deviceName, deviceType: 'airport', ...(deviceState || {}) }
            : null,
      });
      console.log(`${LOG} 截图完成，共 ${shots.length} 张`);
    }

    if (aiEnabled && process.env.ALERT_AI_ENABLED !== '0' && alertAiAnalyzer) {
      const result = await alertAiAnalyzer.analyzeAlert({
        alertKind: 'lost',
        deviceId,
        deviceName,
        elapsedMin,
        thresholdMinutes,
        location,
        subDeviceOnline,
        deviceState,
        preCapturedShots: shots,
      });
      analysis = result?.analysis || null;
      console.log(`${LOG} AI 分析${analysis ? '完成' : '无结果'}`);
    }

    if (webhookUrl) {
      const lostMarkdown = buildLostAlertMarkdown({
        deviceName,
        deviceId,
        elapsedMin,
        location,
        deviceState,
        subDeviceOnline,
      });
      await sendMarkdown(webhookUrl, lostMarkdown, '离巢告警');
      if (sendSnapshot && shots.length) {
        await sendAllSnapshotShots(webhookUrl, shots);
      }
      if (aiEnabled && analysis) {
        await sendMarkdown(webhookUrl, buildLostAlertAiMarkdown(analysis), 'AI 分析');
      }
    }
  } catch (e) {
    console.error(`${LOG} 执行失败:`, e.message);
    if (webhookUrl) {
      try {
        const fallback = buildLostAlertMarkdown({
          deviceName,
          deviceId,
          elapsedMin,
          location,
          deviceState,
          subDeviceOnline,
        });
        await sendMarkdown(
          webhookUrl,
          `${fallback}\n\n> ⚠️ 截图/AI 流程异常：${e.message}`,
        );
      } catch {
        /* ignore */
      }
    }
    process.exitCode = 1;
  } finally {
    releaseLostAlertJobLock(deviceId);
    console.log(`${LOG} 结束 ${deviceName}`);
  }
}

main();
