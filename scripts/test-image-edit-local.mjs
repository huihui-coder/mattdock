/**
 * 本地直连 xomodel 图生图（不启动 Express）
 * Usage: node scripts/test-image-edit-local.mjs [imagePath] [prompt]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

const imagePath = path.resolve(root, process.argv[2] || 'image.png');
const prompt = process.argv[3] || '重构';

const { normalizeEditImage } = await import('../server/lib/normalize-edit-image.js');
const { upstreamImageEdit } = await import('../server/lib/image-edit-upstream.js');

const apiBase = (process.env.XOMODEL_API_URL || 'https://api.xomodel.com').replace(/\/$/, '');
const apiKey = (process.env.XOMODEL_API_KEY || '').trim();
const model = (process.env.XOMODEL_IMAGE_MODEL || 'gpt-image-2').trim();

if (!apiKey) {
  console.error('缺少 XOMODEL_API_KEY');
  process.exit(1);
}
if (!fs.existsSync(imagePath)) {
  console.error('图片不存在:', imagePath);
  process.exit(1);
}

const raw = fs.readFileSync(imagePath);
const file = {
  buffer: raw,
  mimetype: 'image/png',
  originalname: path.basename(imagePath),
};

console.log('=== 本地图生图（与服务端相同链路）===');
console.log({ imagePath, rawKb: Math.round(raw.length / 1024), model, prompt, apiBase });

const normalized = await normalizeEditImage(file);
const uploadFile = {
  buffer: normalized.buffer,
  mimetype: normalized.mimetype,
  originalname: normalized.originalname,
};

console.log('规范化后', {
  kb: Math.round(uploadFile.buffer.length / 1024),
  meta: normalized.meta,
});

const t0 = Date.now();
const { ok, status, data } = await upstreamImageEdit({
  apiBase,
  apiKey,
  model,
  file: uploadFile,
  prompt,
  size: 'auto',
  quality: process.env.IMAGE_EDIT_QUALITY || 'standard',
  outputFormat: 'png',
  count: 1,
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log({ ok, status, elapsed: `${elapsed}s` });

if (!ok) {
  console.error('失败:', JSON.stringify(data?.error || data).slice(0, 800));
  process.exit(1);
}

const b64 = data?.data?.[0]?.b64_json;
if (b64) {
  const out = path.join(__dirname, '_test_local_edit_out.png');
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('OK ->', out);
} else {
  console.log('OK (无 b64_json):', JSON.stringify(data).slice(0, 300));
}
