const { fitWecomMarkdown, WECOM_MARKDOWN_MAX } = require('./wecom-webhook');

function buildOfflineAlertMarkdown({ deviceName, deviceId, elapsedMin, type = 'offline_first' }) {
  const time = new Date().toLocaleString('zh-CN');
  if (type === 'offline_repeat') {
    return `🔴 **机场持续离线提醒**
> 设备：${deviceName}
> SN：${deviceId}
> 机场已离线 **${elapsedMin} 分钟**，请尽快处理
> 时间：${time}`;
  }
  return `🔴 **机场离线告警**
> 设备：${deviceName}
> SN：${deviceId}
> 机场已离线，请检查设备网络状态
> 时间：${time}`;
}

const AI_DISCLAIMER = '\n\n> _以上内容由 AI 生成，仅供参考_';

function buildOfflineAlertAiMarkdown(analysis) {
  const header = '🤖 **AI 告警分析**\n\n';
  const maxChars = Number(process.env.ALERT_AI_MARKDOWN_MAX || 900);
  const bodyBudget = Math.max(200, maxChars - AI_DISCLAIMER.length);
  const trimmed = String(analysis || '').slice(0, bodyBudget);
  return fitWecomMarkdown(`${header}${trimmed}${AI_DISCLAIMER}`, WECOM_MARKDOWN_MAX - 200);
}

function buildOfflineAlertWithAiMarkdown(offlineMarkdown, analysis) {
  if (!analysis) return offlineMarkdown;
  const aiBlock = buildOfflineAlertAiMarkdown(analysis);
  return fitWecomMarkdown(`${offlineMarkdown}\n\n---\n\n${aiBlock}`);
}

module.exports = {
  buildOfflineAlertMarkdown,
  buildOfflineAlertAiMarkdown,
  buildOfflineAlertWithAiMarkdown,
};
