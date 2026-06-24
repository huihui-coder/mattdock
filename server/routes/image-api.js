const multer = require('multer');
const { ASPECT_RATIOS, resolveImageSize, resolveGenerateUpstreamParams } = require('../lib/image-size');
const { upstreamImageEdit, DEFAULT_EDIT_QUALITY, resolveUpstreamEditSize } = require('../lib/image-edit-upstream');
const { normalizeEditImage } = require('../lib/normalize-edit-image');
const { callArkCompletion, getApiKey: getArkApiKey, getAssistantModel } = require('../lib/ark-client');

const XOMODEL_API_BASE = (process.env.XOMODEL_API_URL || 'https://api.frimodel.com').replace(/\/$/, '');
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

function normalizeGenerateQuality(quality) {
  const q = String(quality || 'medium').trim().toLowerCase();
  if (['low', 'medium', 'high', 'auto'].includes(q)) return q;
  if (q === 'standard') return 'medium';
  return 'medium';
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

function buildPolishSystemPrompt(language) {
  if (language === 'en') {
    return `You are an expert AI image prompt engineer. Rewrite the user's idea into one polished English prompt for text-to-image models (GPT Image style).

Rules:
- Output ONLY the final prompt text. No quotes, labels, explanation, or markdown.
- Preserve the user's subject and intent; add concrete details: subject, environment, lighting, camera angle, composition, color mood, and style.
- Use fluent descriptive English suitable for photorealistic or stylized generation as implied by the user.
- Do not add watermarks or UI chrome unless the user asked.`;
  }
  return `你是 AI 绘画提示词专家。将用户的描述润色为一条完整的中文生图提示词。

规则：
- 只输出润色后的提示词正文，不要引号、不要标题、不要解释、不要 Markdown。
- 保留用户主题与意图；补充画面细节：主体、环境、光线、镜头角度、构图、色调与风格。
- 语言流畅自然，适合文生图模型理解。
- 除非用户提到，不要添加水印或界面元素。`;
}

function stripPolishOutput(text) {
  let s = String(text || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith('「') && s.endsWith('」'))
    || (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('```')) {
    s = s.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return s;
}

function registerImageRoutes(app, { requireImageStudio, auditLog, updateTokenUsage }) {
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

  app.post('/api/image/polish-prompt', requireImageStudio, async (req, res) => {
    const modelId = getAssistantModel();
    if (!getArkApiKey()) {
      return res.status(503).json({ error: '飞行助手未配置，请在服务器 .env 中设置 ARK_API_KEY' });
    }
    if (!modelId) {
      return res.status(503).json({ error: '飞行助手未配置模型' });
    }

    const rawPrompt = String(req.body?.prompt || '').trim();
    if (!rawPrompt) {
      return res.status(400).json({ error: '请先输入提示词' });
    }
    const language = req.body?.language === 'en' ? 'en' : 'zh';
    const isEdit = !!req.body?.isEdit;

    if (auditLog) {
      auditLog(req, {
        action: 'ai.image.polish',
        detail: {
          language,
          isEdit,
          promptPreview: rawPrompt.slice(0, 80),
          promptLength: rawPrompt.length,
          modelId,
        },
      });
    }

    try {
      const userTask = isEdit
        ? `请润色以下图生图编辑提示词（${language === 'en' ? '输出英文' : '输出中文'}）：\n\n${rawPrompt}`
        : `请润色以下文生图提示词（${language === 'en' ? '输出英文' : '输出中文'}）：\n\n${rawPrompt}`;

      const polished = await callArkCompletion({
        model: modelId,
        webSearch: false,
        onTokenUsage: updateTokenUsage
          ? (usage) => updateTokenUsage(modelId, usage)
          : undefined,
        messages: [
          { role: 'system', content: buildPolishSystemPrompt(language) },
          { role: 'user', content: userTask },
        ],
      });

      const text = stripPolishOutput(polished);
      if (!text) {
        return res.status(502).json({ error: '润色结果为空，请重试' });
      }
      res.json({
        prompt: text,
        language,
        model: modelId,
      });
    } catch (e) {
      console.error('[ImageAPI] 提示词润色失败:', e.message);
      res.status(502).json({ error: e.message || 'AI 润色失败' });
    }
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
    const sizeParams = sizeOverride
      ? { size: String(sizeOverride).trim(), resolution, mode: 'pixel', pixelSize: String(sizeOverride).trim() }
      : resolveGenerateUpstreamParams(resolution, aspectRatio);
    const count = clampCount(n);
    if (auditLog) {
      auditLog(req, {
        action: 'ai.image.generate',
        detail: {
          promptPreview: prompt.trim().slice(0, 80),
          promptLength: prompt.trim().length,
          n: count,
          resolution,
          aspectRatio,
          model,
          sizeMode: sizeParams.mode,
          upstreamSize: sizeParams.size,
          pixelSize: sizeParams.pixelSize,
        },
      });
    }
    try {
      const body = {
        model,
        prompt: prompt.trim(),
        n: count,
        size: sizeParams.size,
        quality: normalizeGenerateQuality(quality),
      };
      if (sizeParams.mode === 'aspect') {
        body.resolution = sizeParams.resolution;
      }
      console.log('[ImageAPI] 文生图 upstream', {
        model,
        sizeMode: sizeParams.mode,
        size: body.size,
        resolution: body.resolution,
        pixelSize: sizeParams.pixelSize,
        quality: body.quality,
      });
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
      res.json({
        ...data,
        meta: {
          model,
          size: sizeParams.pixelSize || sizeParams.size,
          resolution,
          aspectRatio,
          n: count,
          quality: body.quality,
          sizeMode: sizeParams.mode,
          upstreamSize: sizeParams.size,
        },
      });
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
    const normalized = await normalizeEditImage(file);
    const uploadFile = {
      buffer: normalized.buffer,
      mimetype: normalized.mimetype,
      originalname: normalized.originalname,
    };
    const resolution = req.body?.resolution || '1k';
    const aspectRatio = req.body?.aspectRatio || 'auto';
    const size = resolveUpstreamEditSize(
      resolution,
      aspectRatio,
      req.body?.size,
    );
    const quality = req.body?.quality || DEFAULT_EDIT_QUALITY;
    const outputFormat = req.body?.output_format || 'png';
    const count = clampCount(req.body?.n);

    if (auditLog) {
      auditLog(req, {
        action: 'ai.image.edit',
        detail: {
          promptPreview: prompt.slice(0, 80),
          promptLength: prompt.length,
          n: count,
          resolution,
          aspectRatio,
          model,
          fileKb: Math.round(uploadFile.buffer.length / 1024),
        },
      });
    }

    try {
      console.log('[ImageAPI] 图生图 upstream', {
        model,
        size,
        promptLen: prompt.length,
        fileKb: Math.round(uploadFile.buffer.length / 1024),
        mime: uploadFile.mimetype || 'unknown',
        name: uploadFile.originalname || '',
        ...(normalized.meta || {}),
      });

      const { ok, status, data } = await upstreamImageEdit({
        apiBase: XOMODEL_API_BASE,
        apiKey: getApiKey(),
        model,
        file: uploadFile,
        prompt,
        size,
        quality,
        outputFormat,
        count,
      });
      if (!ok) {
        logUpstreamModelError('图生图', model, { model, prompt, size, quality }, data);
        const errMsg =
          data?.error?.message || data?.error || data?.message || '上游图生图失败';
        return res.status(status >= 400 && status < 600 ? status : 502).json({
          error: typeof errMsg === 'string' ? { message: errMsg } : errMsg,
          hint: status === 502 ? '上游暂时不可用，请稍后重试或选宽高比 Auto' : undefined,
        });
      }
      res.json({ ...data, meta: { model, size, resolution, aspectRatio, quality, n: count } });
    } catch (e) {
      console.error('[ImageAPI] 图生图失败:', e.message);
      res.status(502).json({
        error: e.message || '图生图请求失败',
        hint: '图生图建议使用宽高比 Auto；若仍失败请查看 pm2 logs',
      });
    }
  });
}

module.exports = { registerImageRoutes, upload };
