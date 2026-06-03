const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

function extFromMime(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[mime] || '.png';
}

function mimeFromFile(file) {
  return file.mimetype || 'image/png';
}

/** 图生图清晰度：xomodel 控制台成功记录多为 standard */
const DEFAULT_EDIT_QUALITY = (process.env.IMAGE_EDIT_QUALITY || 'standard').trim() || 'standard';

/**
 * 图生图输出尺寸：官方示例与控制台成功记录均为 auto
 * 非 auto 的 2k/16:9 会得到 4096x2304，易触发上游 502
 */
function resolveUpstreamEditSize(resolution, aspectRatio, explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  if (process.env.IMAGE_EDIT_FORCE_AUTO_SIZE === '0') {
    const { resolveEditSize } = require('./image-size');
    return resolveEditSize(resolution, aspectRatio);
  }
  return 'auto';
}

/**
 * 经 curl 转发图生图（与官方示例一致，避免 Node fetch multipart 丢失 model 字段）
 */
async function upstreamImageEditViaCurl({
  apiBase,
  apiKey,
  model,
  file,
  prompt,
  size,
  quality,
  outputFormat,
  count,
}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-img-edit-'));
  try {
    const mime = mimeFromFile(file);
    const ext = path.extname(file.originalname || '') || extFromMime(mime);
    const imgPath = path.join(tmpDir, `input${ext}`);
    const outPath = path.join(tmpDir, 'out.json');

    fs.writeFileSync(imgPath, file.buffer);

    const imageField = `image[]=@${imgPath};type=${mime}`;

    const args = [
      '-s',
      '--connect-timeout',
      '30',
      '--max-time',
      '300',
      '-X',
      'POST',
      `${apiBase}/v1/images/edits`,
      '-H',
      `Authorization: Bearer ${apiKey}`,
      '-F',
      `model=${model}`,
      '-F',
      imageField,
      '--form-string',
      `prompt=${prompt}`,
      '-F',
      `size=${size}`,
      '-F',
      `quality=${quality}`,
      '-F',
      `output_format=${outputFormat}`,
      '-o',
      outPath,
      '-w',
      '%{http_code}',
    ];
    if (count > 1) args.push('-F', `n=${String(count)}`);

    let stdout;
    let stderr;
    try {
      const out = await execFileAsync('curl', args, {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300000,
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (e) {
      stderr = e.stderr || e.message;
      throw new Error(stderr ? String(stderr).trim() : e.message);
    }

    const httpCode = Number(String(stdout).trim()) || 500;
    const raw = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    let data;
    try {
      data = raw ? JSON.parse(raw) : { error: stderr || 'empty response' };
    } catch {
      data = { error: raw || stderr || 'invalid json' };
    }
    if (!data.error && httpCode >= 400) {
      data = { error: { message: raw || `HTTP ${httpCode}` } };
    }
    if (httpCode >= 400) {
      const preview = raw ? raw.slice(0, 800).replace(/\s+/g, ' ') : '(empty body)';
      console.error(`[ImageAPI] curl 上游响应 http=${httpCode} mime=${mime} fileKb=${Math.round(file.buffer.length / 1024)} body=${preview}`);
    }
    return { ok: httpCode >= 200 && httpCode < 300, status: httpCode, data };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 构建上游图生图 multipart（fetch 回退） */
function buildUpstreamEditForm({ model, file, prompt, size, quality, outputFormat, count }) {
  const form = new FormData();
  form.append('model', model);
  const blob = new Blob([file.buffer], { type: file.mimetype || 'image/png' });
  form.append('image[]', blob, file.originalname || 'input.png');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  form.append('output_format', outputFormat);
  if (count > 1) form.append('n', String(count));
  return form;
}

async function upstreamImageEditViaFetch({ apiBase, apiKey, model, file, prompt, size, quality, outputFormat, count }) {
  const form = buildUpstreamEditForm({
    model,
    file,
    prompt,
    size,
    quality,
    outputFormat,
    count,
  });
  const resp = await fetch(`${apiBase}/v1/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || resp.statusText };
  }
  return { ok: resp.ok, status: resp.status, data };
}

/**
 * 图生图上游请求：默认 curl，502/503/429 自动重试一次
 */
async function upstreamImageEdit(opts) {
  const useCurl = process.env.IMAGE_EDIT_USE_CURL !== '0';
  const maxAttempts = Math.min(Math.max(Number(process.env.IMAGE_EDIT_RETRY || 2), 1), 3);
  const retryStatuses = new Set([502, 503, 429]);

  const runOnce = async () => {
    if (useCurl) {
      try {
        return await upstreamImageEditViaCurl(opts);
      } catch (e) {
        console.warn('[ImageAPI] curl 执行异常:', e.message);
        if (process.env.IMAGE_EDIT_USE_CURL === '1') throw e;
      }
    }
    return upstreamImageEditViaFetch(opts);
  };

  let last;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      console.warn(`[ImageAPI] 图生图第 ${attempt + 1} 次重试…`);
      await new Promise((r) => setTimeout(r, 2500));
    }
    last = await runOnce();
    const via = useCurl ? 'curl' : 'fetch';
    console.log(`[ImageAPI] 图生图 via ${via}`, { model: opts.model, status: last.status, attempt: attempt + 1 });
    if (last.ok || !retryStatuses.has(last.status)) return last;
  }
  return last;
}

module.exports = {
  upstreamImageEdit,
  upstreamImageEditViaCurl,
  DEFAULT_EDIT_QUALITY,
  resolveUpstreamEditSize,
};
