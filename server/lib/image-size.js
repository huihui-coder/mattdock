/** GPT Image 2 / NewAPI 官方预设像素表（1k/2k/4k × 宽高比） */
const PRESET_PIXEL_SIZES = {
  '1k': {
    '1:1': '1024x1024',
    '16:9': '1536x864',
    '9:16': '864x1536',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '5:4': '1280x1024',
    '4:5': '1024x1280',
    '21:9': '2016x864',
  },
  '2k': {
    '1:1': '2048x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '3:2': '2048x1360',
    '2:3': '1360x2048',
    '5:4': '2560x2048',
    '4:5': '2048x2560',
    '21:9': '2688x1152',
  },
  '4k': {
    '1:1': '2880x2880',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3312x2480',
    '3:4': '2480x3312',
    '3:2': '3520x2336',
    '2:3': '2336x3520',
    '5:4': '3216x2576',
    '4:5': '2576x3216',
    '21:9': '3840x1648',
  },
};

const RESOLUTION_LONG_EDGE = { '1k': 1024, '2k': 2048, '4k': 4096 };

const ASPECT_RATIOS = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9',
];

/** GPT Image 2 最小总像素（低于此值上游会异常或长时间无响应） */
const MIN_TOTAL_PIXELS = 655360;

function normalizeResolution(resolution) {
  return PRESET_PIXEL_SIZES[resolution] ? resolution : '1k';
}

function normalizeAspectRatio(aspectRatio) {
  if (!aspectRatio || aspectRatio === 'auto') return '1:1';
  return aspectRatio;
}

function roundEven(n) {
  const v = Math.max(256, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

function parsePixelSize(sizeStr) {
  const m = String(sizeStr || '').match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

function meetsPixelConstraints(sizeStr) {
  const dim = parsePixelSize(sizeStr);
  if (!dim) return false;
  const { width, height } = dim;
  const total = width * height;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge > 3840) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  if (shortEdge <= 0 || longEdge / shortEdge > 3) return false;
  if (total < MIN_TOTAL_PIXELS || total > 8294400) return false;
  return true;
}

/** 由分辨率档位 + 宽高比得到 API 像素 size，优先查官方预设表 */
function resolveImageSize(resolution = '1k', aspectRatio = '1:1') {
  const res = normalizeResolution(resolution);
  const ratio = normalizeAspectRatio(aspectRatio);
  const preset = PRESET_PIXEL_SIZES[res]?.[ratio];
  if (preset) return preset;

  const longEdge = RESOLUTION_LONG_EDGE[res] || 1024;
  const parts = ratio.split(':').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return PRESET_PIXEL_SIZES[res]['1:1'] || `${longEdge}x${longEdge}`;
  }

  const [wR, hR] = parts;
  let width;
  let height;
  if (wR >= hR) {
    width = roundEven(longEdge);
    height = roundEven((longEdge * hR) / wR);
  } else {
    height = roundEven(longEdge);
    width = roundEven((longEdge * wR) / hR);
  }
  width = Math.ceil(width / 16) * 16;
  height = Math.ceil(height / 16) * 16;
  return `${width}x${height}`;
}

/**
 * 文生图上游参数。
 * aspect 模式（默认）：size=宽高比字符串 + resolution=1k/2k/4k（frimodel/NewAPI 兼容）
 * pixel 模式：size=像素字符串（OpenAI 原生）
 */
function resolveGenerateUpstreamParams(resolution = '1k', aspectRatio = '1:1') {
  const res = normalizeResolution(resolution);
  const ratio = normalizeAspectRatio(aspectRatio);
  const pixelSize = resolveImageSize(res, ratio);
  const mode = (process.env.IMAGE_GENERATE_SIZE_MODE || 'aspect').trim().toLowerCase();

  if (mode === 'pixel') {
    return { size: pixelSize, resolution: res, mode: 'pixel' };
  }
  return { size: ratio, resolution: res, pixelSize, mode: 'aspect' };
}

/** 图生图：auto 保持原图比例，否则传具体像素尺寸 */
function resolveEditSize(resolution, aspectRatio) {
  if (!aspectRatio || aspectRatio === 'auto') return 'auto';
  return resolveImageSize(resolution, aspectRatio);
}

module.exports = {
  PRESET_PIXEL_SIZES,
  RESOLUTION_LONG_EDGE,
  ASPECT_RATIOS,
  MIN_TOTAL_PIXELS,
  meetsPixelConstraints,
  resolveImageSize,
  resolveEditSize,
  resolveGenerateUpstreamParams,
};
