const { computeLocationDistanceContext } = require('./geo-utils');
const { fitWecomMarkdown, WECOM_MARKDOWN_MAX } = require('./wecom-webhook');

/**
 * 飞丢告警 Markdown 正文
 */
function buildLostAlertMarkdown({
  deviceName,
  deviceId,
  elapsedMin,
  location,
  deviceState,
  subDeviceOnline,
}) {
  const time = new Date().toLocaleString('zh-CN');
  const distCtx = computeLocationDistanceContext(location, deviceState?.location);
  const locStr = location
    ? `\n> 最后位置：${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}（高度 ${location.height || 0}m）${distCtx.webhookLine || ''}`
    : '';
  const subOnline =
    subDeviceOnline === 1 ? '（无人机在线）' : subDeviceOnline === 0 ? '（无人机离线）' : '';

  return `⚠️ **无人机离巢告警**
> 设备：${deviceName} ${subOnline}
> SN：${deviceId}
> 无人机已离开机巢 **${elapsedMin} 分钟**，飞机疑似飞丢请检查飞行状态${locStr}
> 时间：${time}`;
}

/** 单条企业微信 markdown 内合并（易超长，推荐分两条推送） */
function buildLostAlertWithAiMarkdown(lostMarkdown, analysis) {
  if (!analysis) return lostMarkdown;
  const aiBlock = buildLostAlertAiMarkdown(analysis);
  return fitWecomMarkdown(`${lostMarkdown}\n\n---\n\n${aiBlock}`);
}

/** 第二条：仅 AI 分析（单独推送，按 UTF-8 字节限制 ≤4096） */
const AI_DISCLAIMER = '\n\n> _以上内容由 AI 生成，仅供参考_';

function buildLostAlertAiMarkdown(analysis) {
  const header = '🤖 **AI 分析**\n\n';
  const maxChars = Number(process.env.ALERT_AI_MARKDOWN_MAX || 900);
  const bodyBudget = Math.max(200, maxChars - AI_DISCLAIMER.length);
  const trimmed = String(analysis || '').slice(0, bodyBudget);
  return fitWecomMarkdown(`${header}${trimmed}${AI_DISCLAIMER}`, WECOM_MARKDOWN_MAX - 200);
}

module.exports = {
  buildLostAlertMarkdown,
  buildLostAlertWithAiMarkdown,
  buildLostAlertAiMarkdown,
  fitWecomMarkdown,
};
