const MAX_EDGE = Math.min(Math.max(Number(process.env.IMAGE_EDIT_MAX_EDGE || 2048), 512), 4096);

/**
 * 图生图前规范化参考图：修正 EXIF、限制尺寸、统一为 PNG
 * 避免部分 PNG/WebP 触发上游 502 Upstream request failed
 */
async function normalizeEditImage(file) {
  const original = {
    buffer: file.buffer,
    mimetype: file.mimetype || 'image/png',
    originalname: file.originalname || 'input.png',
  };

  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.warn('[ImageAPI] 未安装 sharp，跳过图片规范化');
    return { ...original, meta: { skipped: true } };
  }

  try {
    const input = sharp(original.buffer, { failOn: 'none' });
    const meta = await input.metadata();
    let pipeline = input.rotate();

    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w > MAX_EDGE || h > MAX_EDGE) {
      pipeline = pipeline.resize(MAX_EDGE, MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const buffer = await pipeline
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const outMeta = await sharp(buffer).metadata();
    console.log('[ImageAPI] 参考图已规范化', {
      from: `${w}x${h}`,
      to: `${outMeta.width || '?'}x${outMeta.height || '?'}`,
      kb: Math.round(buffer.length / 1024),
    });

    return {
      buffer,
      mimetype: 'image/png',
      originalname: String(original.originalname).replace(/\.[^.]+$/, '') + '.png',
      meta: { width: w, height: h, outW: outMeta.width, outH: outMeta.height },
    };
  } catch (e) {
    console.warn('[ImageAPI] 图片规范化失败，使用原图:', e.message);
    return { ...original, meta: { skipped: true, error: e.message } };
  }
}

module.exports = { normalizeEditImage, MAX_EDGE };
