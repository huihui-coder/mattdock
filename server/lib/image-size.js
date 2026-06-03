const RESOLUTION_LONG_EDGE = { '1k': 1024, '2k': 2048, '4k': 4096 };

const ASPECT_RATIOS = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9',
];

function roundEven(n) {
  const v = Math.max(256, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

/** 由分辨率档位 + 宽高比得到 API size 字符串，如 1792x1024 */
function resolveImageSize(resolution = '1k', aspectRatio = '1:1') {
  const longEdge = RESOLUTION_LONG_EDGE[resolution] || 1024;

  if (!aspectRatio || aspectRatio === 'auto') {
    return `${longEdge}x${longEdge}`;
  }

  const parts = aspectRatio.split(':').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return `${longEdge}x${longEdge}`;
  }

  const [wR, hR] = parts;
  if (wR >= hR) {
    const width = roundEven(longEdge);
    const height = roundEven((longEdge * hR) / wR);
    return `${width}x${height}`;
  }
  const height = roundEven(longEdge);
  const width = roundEven((longEdge * wR) / hR);
  return `${width}x${height}`;
}

/** 图生图：auto 保持原图比例，否则传具体像素尺寸 */
function resolveEditSize(resolution, aspectRatio) {
  if (!aspectRatio || aspectRatio === 'auto') return 'auto';
  return resolveImageSize(resolution, aspectRatio);
}

module.exports = {
  RESOLUTION_LONG_EDGE,
  ASPECT_RATIOS,
  resolveImageSize,
  resolveEditSize,
};
