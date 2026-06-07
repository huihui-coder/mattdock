/** 悬浮助手待机时随机播报的短句 */
export const IDLE_SPEECH_PHRASES = [
  'Hi!',
  '有需要随时叫我～',
  '设备状态还好吗？',
  '今日飞行记录看过没？',
  '有告警需要解读吗？',
  '我在呢，尽管问！',
  '巡逻辛苦了～',
  '记得关注设备告警信息哦',
  '想查某台设备？点我就行',
  '飞行数据也可以问我',
  '告警解读·值班摘要',
  'Ctrl+/ 快速打开',
]

export const IDLE_SPEECH_INTERVAL_MS = 2 * 60 * 1000
/** 进入页面后首次弹出延迟 */
export const IDLE_SPEECH_FIRST_MS = 5 * 1000
export const IDLE_SPEECH_VISIBLE_MS = 6500

export function pickIdlePhrase(exclude) {
  const pool = exclude
    ? IDLE_SPEECH_PHRASES.filter((p) => p !== exclude)
    : IDLE_SPEECH_PHRASES
  return pool[Math.floor(Math.random() * pool.length)] || IDLE_SPEECH_PHRASES[0]
}
