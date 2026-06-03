const multer = require('multer');
const { ASPECT_RATIOS, resolveImageSize, resolveEditSize } = require('../lib/image-size');

const XOMODEL_API_BASE = (process.env.XOMODEL_API_URL || 'https://api.xomodel.com').replace(/\/$/, '');
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

function getImageModel(override) {
  const trimmed =
    override != null && String(override).trim() ? String(override).trim() : null;
  const fromEnv = (process.env.XOMODEL_IMAGE_MODEL || '').trim();
  return trimmed || fromEnv || DEFAULT_IMAGE_MODEL;
}

function getApiKey() {
  return (process.env.XOMODEL_API_KEY || '').trim();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('仅支持图片文件'));
    }
    cb(null, true);
  },
});

function ensureApiReady(res, model) {
  if (!getApiKey()) {
    res.status(503).json({ error: '未配置 XOMODEL_API_KEY，请在服务器 .env 中设置' });
    return false;
  }
  if (!model) {
    res.status(503).json({
      error: '未配置生图模型名，请在 .env 设置 XOMODEL_IMAGE_MODEL（如 gpt-image-2 或 nova-g-image-2）',
    });
    return false;
  }
  return true;
}

async function parseUpstreamResponse(resp) {
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || resp.statusText };
  }
  return { ok: resp.ok, status: resp.status, data };
}

function clampCount(n) {
  return Math.min(Math.max(Number(n) || 1, 1), 4);
}

function logUpstreamModelError(kind, model, payload, data) {
  const msg = JSON.stringify(data?.error || data || '');
  if (!/model.*empty|model.*not specified/i.test(msg)) return;
  console.error(
    `[ImageAPI] ${kind} 上游报 model 为空 — 实际发送 model="${model}", env MODEL="${(process.env.XOMODEL_IMAGE_MODEL || '').trim()}"`,
    typeof payload === 'object' && !Buffer.isBuffer(payload?.image)
      ? { ...payload, prompt: payload.prompt ? '(set)' : '(empty)' }
      : '(multipart)',
  );
}

/** 从 multer 解析结果中取参考图 */
function pickUploadedImage(req) {
  const list = Array.isArray(req.files) ? req.files : [];
  return (
    list.find((f) => f.fieldname === 'image[]') ||
    list.find((f) => f.fieldname === 'image') ||
    list.find((f) => (f.mimetype || '').startsWith('image/')) ||
    req.files?.['image[]']?.[0] ||
    req.files?.image?.[0] ||
    req.file ||
    null
  );
}

/** 构建上游图生图 multipart（与 curl 示例字段顺序一致，使用 Node 原生 FormData） */
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

function registerImageRoutes(app, { requireImageStudio }) {
  app.get('/api/image/config', requireImageStudio, (_req, res) => {
    const model = getImageModel();
    const hasApiKey = !!getApiKey();
    res.json({
      configured: hasApiKey && !!model,
      hasApiKey,
      hasModel: !!model,
      model,
      apiBase: XOMODEL_API_BASE,
      resolutions: ['1k', '2k', '4k'],
      aspectRatios: ASPECT_RATIOS,
      counts: [1, 2, 3, 4],
      qualities: ['low', 'medium', 'high'],
    });
  });

  app.post('/api/image/generate', requireImageStudio, async (req, res) => {
    const model = getImageModel(req.body?.model);
    if (!ensureApiReady(res, model)) return;
    const {
      prompt,
      n = 1,
      resolution = '1k',
      aspectRatio = '1:1',
      quality = 'high',
      size: sizeOverride,
    } = req.body || {};
    if (!prompt?.trim()) {
      return res.status(400).json({ error: '请输入提示词 prompt' });
    }
    const size = sizeOverride || resolveImageSize(resolution, aspectRatio);
    const count = clampCount(n);
    try {
      const body = {
        model,
        prompt: prompt.trim(),
        n: count,
        size,
      };
      const resp = await fetch(`${XOMODEL_API_BASE}/v1/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const { ok, status, data } = await parseUpstreamResponse(resp);
      if (!ok) {
        logUpstreamModelError('文生图', model, body, data);
        return res.status(status).json(data);
      }
      res.json({ ...data, meta: { model, size, resolution, aspectRatio, n: count, quality } });
    } catch (e) {
      console.error('[ImageAPI] 文生图失败:', e.message);
      res.status(502).json({ error: e.message || '上游请求失败' });
    }
  });

  app.post('/api/image/edit', requireImageStudio, (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  }, async (req, res) => {
    const model = getImageModel(req.body?.model || req.headers['x-image-model']);
    if (!ensureApiReady(res, model)) return;
    const prompt = (req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: '请输入编辑提示词 prompt' });
    }
    const file = pickUploadedImage(req);
    if (!file) {
      return res.status(400).json({ error: '请上传参考图片' });
    }
    const resolution = req.body?.resolution || '1k';
    const aspectRatio = req.body?.aspectRatio || 'auto';
    const size =
      (req.body?.size && String(req.body.size).trim()) ||
      resolveEditSize(resolution, aspectRatio);
    const quality = req.body?.quality || 'high';
    const outputFormat = req.body?.output_format || 'png';
    const count = clampCount(req.body?.n);

    try {
      const form = buildUpstreamEditForm({
        model,
        file,
        prompt,
        size,
        quality,
        outputFormat,
        count,
      });

      console.log('[ImageAPI] 图生图 upstream', {
        model,
        size,
        promptLen: prompt.length,
        fileKb: Math.round(file.buffer.length / 1024),
      });

      const resp = await fetch(`${XOMODEL_API_BASE}/v1/images/edits`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: form,
      });
      const { ok, status, data } = await parseUpstreamResponse(resp);
      if (!ok) {
        logUpstreamModelError('图生图', model, { model, prompt, size, quality }, data);
        return res.status(status).json(data);
      }
      res.json({ ...data, meta: { model, size, resolution, aspectRatio, quality, n: count } });
    } catch (e) {
      console.error('[ImageAPI] 图生图失败:', e.message);
      res.status(502).json({ error: e.message || '上游请求失败' });
    }
  });
}

module.exports = { registerImageRoutes, upload };
