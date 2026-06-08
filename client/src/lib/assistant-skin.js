/** 飞行助手形象（皮肤）偏好，仅存本地 */

export const ASSISTANT_SKIN_STORAGE_KEY = 'haizhu_assistant_skin'
export const ASSISTANT_SKIN_CHANGE_EVENT = 'assistant-skin-change'

export const ASSISTANT_SKINS = {
  default: {
    id: 'default',
    name: '飞行助手',
    description: '默认机器人形象，待机含轻量动画',
    preview: '/images/robot/空闲.png',
  },
  codenono: {
    id: 'codenono',
    name: 'CodeNoNo',
    description: 'Codex 风格悬浮电子宠物，来自开源项目 CodeX_Pet_NoNo',
    preview: '/images/codenono/spritesheet.webp',
    sourceUrl: 'https://github.com/Dqd02/CodeX_Pet_NoNo',
    spritesheet: '/images/codenono/spritesheet.webp',
  },
}

export const CODENONO_ATLAS = {
  sheetWidth: 1536,
  sheetHeight: 1872,
  frameWidth: 192,
  frameHeight: 208,
  framesPerRow: 8,
}

/** 每行动画实际帧数（空格子透明，不可播放）— 来自 CodeNoNo validation.json */
export const CODENONO_ROW_FRAME_COUNT = {
  0: 6, // idle
  1: 8, // running-right
  2: 8, // running-left
  3: 4, // waving
  4: 5, // jumping
  5: 8, // failed
  6: 6, // waiting
  7: 6, // running
  8: 6, // review
}

/** mascotState -> CodeNoNo 精灵图行号 */
export const CODENONO_STATE_ROW = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  thinking: 7,
  alert: 8,
  success: 4,
  error: 5,
  listen: 6,
}

export function loadAssistantSkin() {
  try {
    const stored = localStorage.getItem(ASSISTANT_SKIN_STORAGE_KEY)
    if (stored && ASSISTANT_SKINS[stored]) return stored
  } catch {
    /* ignore */
  }
  return 'default'
}

export function saveAssistantSkin(skinId) {
  const next = ASSISTANT_SKINS[skinId] ? skinId : 'default'
  try {
    localStorage.setItem(ASSISTANT_SKIN_STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(ASSISTANT_SKIN_CHANGE_EVENT, { detail: { skinId: next } }))
  return next
}

export function getAssistantSkinMeta(skinId) {
  return ASSISTANT_SKINS[skinId] || ASSISTANT_SKINS.default
}
