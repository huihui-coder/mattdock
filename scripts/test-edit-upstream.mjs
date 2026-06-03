/**
 * 模拟服务端图生图转发逻辑（不启动 Express，仅测 upstream multipart）
 * 用法: node scripts/test-edit-upstream.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE = (process.env.XOMODEL_API_URL || 'https://api.xomodel.com').replace(/\/$/, '');
const API_KEY = (process.env.XOMODEL_API_KEY || '').trim();
const model = (process.env.XOMODEL_IMAGE_MODEL || 'gpt-image-2').trim();

const imgPath = path.join(__dirname, '_test_input.png');
if (!fs.existsSync(imgPath)) {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.writeFileSync(imgPath, Buffer.from(b64, 'base64'));
}

const buf = fs.readFileSync(imgPath);
const form = new FormData();
form.append('model', model);
form.append('image[]', new Blob([buf], { type: 'image/png' }), 'input.png');
form.append('prompt', 'add a red dot, minimal');
form.append('size', 'auto');
form.append('quality', 'high');
form.append('output_format', 'png');

console.log('POST', `${API_BASE}/v1/images/edits`, 'model=', model);
const t0 = Date.now();
const resp = await fetch(`${API_BASE}/v1/images/edits`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}` },
  body: form,
});
const text = await resp.text();
console.log('status', resp.status, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(text.slice(0, 400));
process.exit(resp.ok ? 0 : 1);
