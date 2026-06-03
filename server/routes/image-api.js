const multer = require('multer');
const FormData = require('form-data');
const { ASPECT_RATIOS, resolveImageSize, resolveEditSize } = require('../lib/image-size');

const XOMODEL_API_BASE = (process.env.XOMODEL_API_URL || 'https://api.xomodel.com').replace(/\/$/, '');
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

function getImageModel(override) {
  const raw = override ?? process.env.XOMODEL_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  const model = String(raw).trim();
  return model || DEFAULT_IMAGE_MODEL;
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

function registerImageRoutes(app, { requireImageStudio }) {
  app.get('/api/image/config', requireImageStudio, (_req, res) => {
    const model = getImageModel();
    res.json({
      configured: !!getApiKey() && !!model,
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
      if (!ok) return res.status(status).json(data);
      res.json({ ...data, meta: { model, size, resolution, aspectRatio, n: count, quality } });
    } catch (e) {
      console.error('[ImageAPI] 文生图失败:', e.message);
      res.status(502).json({ error: e.message || '上游请求失败' });
    }
  });

  app.post('/api/image/edit', requireImageStudio, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  }, async (req, res) => {
    const model = getImageModel(req.body?.model);
    if (!ensureApiReady(res, model)) return;
    const prompt = (req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: '请输入编辑提示词 prompt' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请上传参考图片' });
    }
    const resolution = req.body?.resolution || '1k';
    const aspectRatio = req.body?.aspectRatio || 'auto';
    const size = req.body?.size || resolveEditSize(resolution, aspectRatio);
    const quality = req.body?.quality || 'high';
    const outputFormat = req.body?.output_format || 'png';
    const count = clampCount(req.body?.n);

    try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('image[]', req.file.buffer, {
        filename: req.file.originalname || 'input.png',
        contentType: req.file.mimetype,
      });
      form.append('size', size);
      form.append('quality', quality);
      form.append('output_format', outputFormat);
      if (count > 1) form.append('n', String(count));

      const resp = await fetch(`${XOMODEL_API_BASE}/v1/images/edits`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          ...form.getHeaders(),
        },
        body: form,
      });
      const { ok, status, data } = await parseUpstreamResponse(resp);
      if (!ok) return res.status(status).json(data);
      res.json({ ...data, meta: { model, size, resolution, aspectRatio, quality, n: count } });
    } catch (e) {
      console.error('[ImageAPI] 图生图失败:', e.message);
      res.status(502).json({ error: e.message || '上游请求失败' });
    }
  });
}

module.exports = { registerImageRoutes, upload };
