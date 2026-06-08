const { buildAssistantContext } = require('../lib/build-assistant-context');
const {
  deriveConversationFocus,
  formatFocusForPrompt,
  augmentUserPrompt,
} = require('../lib/assistant-conversation-focus');
const {
  getApiKey,
  getAssistantModel,
  fetchArkStreamResponse,
  createOpenAIStreamTransformer,
} = require('../lib/ark-client');
const {
  getAssistantModelSettings,
  setAssistantModelId,
  listAssistantModels,
} = require('../lib/assistant-model-store');

const MAX_HISTORY = 20;

function buildSystemPrompt(modelId) {
  const model = modelId || getAssistantModel();
  return `你是「飞行助手」，海珠无人机管理平台的 AI 运维助手。

【能力与边界】
- 用户问平均飞行时长/里程、架次合计等：**必须使用下方「飞行统计」中已算好的数值**，禁止从明细列表自行计数或推算。
- 用户问哪些机场/设备在下雨、网络差、无人机是否在库、子设备是否在线、风速/电量/工作模式等：**必须使用下方「设备实时状态」**，按设备名称列出符合条件的条目；无数据时如实说明「未上报」或「当前范围内无此类设备」。
- 你不能：下载/导出文件、代替用户点击系统按钮、执行停飞等操作。
- 用户要求「下载/导出表格/排名记录」时：明确说明无法代其下载，并指引：打开左侧菜单「飞行记录」→ 设备排名区域 → 点击「导出排名」或「导出」按钮；可口头概括排名前几名作为补充。
- 用户问「你是什么模型/谁」时：如实回答「我是飞行助手，当前使用火山方舟 ${model} 模型」，不要回避。

【回答原则（必须遵守）】
1. **先直接回答用户当前这句话**，不要答非所问。
2. 用户未要求「摘要/概况/解读告警」时，不要擅自输出整段设备状态或告警汇总。
3. 问题与监控无关（如模型身份、操作指引）时，正常作答，不必强行引用下方数据。
4. 需要数据支撑时，仅引用下方参考数据中存在的设备与数值，勿编造。
5. **指代与追问**：用户说「它」「这个」「要怎么处理」「怎么办」等时，以**对话历史中你上一轮回复**的设备与告警为准作答，不要跳到其他设备或其他告警（例如上一轮讲机械臂 Y 轴报警，就不要改答电池槽问题）。

语气：专业、友好、简短。
格式：简洁 Markdown，禁止输出思考过程或 reasoning 标签。`;
}

function buildAssistantMessages({ history, prompt, imageDataUrl, context, modelId }) {
  const focus = deriveConversationFocus(history, prompt);
  const focusBlock = formatFocusForPrompt(focus);
  const systemParts = [buildSystemPrompt(modelId), buildAssistantContext(context)];
  if (focusBlock) systemParts.push(focusBlock);

  const messages = [
    {
      role: 'system',
      content: systemParts.join('\n\n'),
    },
  ];

  for (const m of (history || []).slice(-MAX_HISTORY)) {
    if (!m?.role || !m?.content) continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    messages.push({ role: m.role, content: String(m.content) });
  }

  const userContent = [];
  if (imageDataUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: imageDataUrl },
    });
  }
  userContent.push({
    type: 'text',
    text: augmentUserPrompt(prompt, focus) || String(prompt || '').trim(),
  });
  messages.push({ role: 'user', content: userContent });

  return messages;
}

function buildAssistantConfigPayload(req) {
  const hasApiKey = !!getApiKey();
  const settings = getAssistantModelSettings();
  const isAdmin = req?.user?.role === 'admin';
  return {
    configured: hasApiKey && !!settings.modelId,
    hasApiKey,
    hasModel: !!settings.modelId,
    model: settings.modelId,
    modelName: settings.model?.name || settings.modelId,
    modelProvider: settings.model?.provider || '火山方舟',
    defaultModelId: settings.defaultModelId,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
    canManageModel: isAdmin,
    models: isAdmin ? listAssistantModels() : undefined,
  };
}

function registerAssistantRoutes(app, {
  requireAssistant,
  requireAdmin,
  updateTokenUsage,
  enrichAssistantContext,
  auditLog,
}) {
  app.get('/api/assistant/config', requireAssistant, (req, res) => {
    res.json(buildAssistantConfigPayload(req));
  });

  app.put('/api/assistant/model', requireAdmin, (req, res) => {
    const { modelId } = req.body || {};
    try {
      const settings = setAssistantModelId(modelId, req.user?.username);
      if (auditLog) {
        auditLog(req, {
          action: 'assistant.model.update',
          detail: { modelId: settings.modelId, modelName: settings.model?.name },
        });
      }
      res.json({
        ok: true,
        ...buildAssistantConfigPayload(req),
      });
    } catch (e) {
      res.status(400).json({ error: e.message || '模型切换失败' });
    }
  });

  app.post('/api/assistant/chat', requireAssistant, async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(503).json({ error: '未配置 ARK_API_KEY，请在服务器 .env 中设置' });
    }

    const modelId = getAssistantModel();
    if (!modelId) {
      return res.status(503).json({ error: '未配置 ARK_MODEL' });
    }

    const { prompt, history, context, imageBase64, imageMime } = req.body || {};
    const text = String(prompt || '').trim();
    if (!text && !imageBase64) {
      return res.status(400).json({ error: '请输入问题或上传图片' });
    }

    let imageDataUrl;
    if (imageBase64) {
      const mime = imageMime || 'image/png';
      const raw = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
      imageDataUrl = `data:${mime};base64,${raw}`;
    }

    const messages = buildAssistantMessages({
      history,
      prompt: text || '请描述这张图片与当前监控场景的关系，并给出建议。',
      imageDataUrl,
      context: enrichAssistantContext ? enrichAssistantContext(context || {}, req) : context || {},
      modelId,
    });

    if (auditLog) {
      auditLog(req, {
        action: 'ai.assistant.chat',
        detail: {
          promptPreview: text.slice(0, 120),
          promptLength: text.length,
          hasImage: !!imageBase64,
          historyCount: (history || []).length,
          modelId,
        },
      });
    }

    try {
      const upstream = await fetchArkStreamResponse({
        model: modelId,
        messages,
        webSearch: 'auto',
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        let errJson;
        try {
          errJson = JSON.parse(errText);
        } catch {
          errJson = { error: { message: errText || upstream.statusText } };
        }
        return res.status(upstream.status).json(errJson);
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      const transformer = createOpenAIStreamTransformer(modelId);

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = transformer.transformChunk(decoder.decode(value, { stream: true }));
          if (chunk) res.write(chunk);
        }
        res.write('data: [DONE]\n\n');

        const lastUsage = transformer.getLastUsage();
        if (updateTokenUsage && lastUsage) {
          updateTokenUsage(modelId, lastUsage);
        }
        res.end();
      };

      pump().catch((e) => {
        console.error('[Assistant] 流式转发失败:', e.message);
        if (!res.headersSent) {
          res.status(502).json({ error: e.message || '流式响应失败' });
        } else {
          res.end();
        }
      });
    } catch (e) {
      console.error('[Assistant] 请求失败:', e.message);
      res.status(502).json({ error: e.message || '助手服务不可用' });
    }
  });
}

module.exports = { registerAssistantRoutes };
