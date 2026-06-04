/**
 * 前端绿幕抠像（不修改源视频文件）
 * @param {ImageData} imageData
 * @param {{ minDominance?: number, hardDominance?: number }} opts
 */
export function applyGreenScreenKey(imageData, opts = {}) {
  const minD = opts.minDominance ?? 28
  const hardD = opts.hardDominance ?? 72
  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const dominance = g - Math.max(r, b)

    if (dominance <= minD) continue

    if (dominance >= hardD) {
      data[i + 3] = 0
      continue
    }

    const t = (dominance - minD) / (hardD - minD)
    data[i + 3] = Math.round(data[i + 3] * (1 - t))
  }
}
