const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../haizhuDB/assistant-settings.json');
const DEFAULT_MODEL_ID = (process.env.ARK_MODEL || 'doubao-seed-2-0-mini-260428').trim();
const RATE_LIMIT_NOTE = '非刚性保障，受平台负载/调用方式影响，详见文档';

const SEED_2_LIMITS = {
  contextWindow: '256k',
  maxInput: '224k',
  maxOutput: '128k',
  maxOutputDefault: '4k',
  maxThinkingChain: '128k',
};

const SEED_2_RATE = {
  maxRpm: 30000,
  maxTpm: 5000000,
};

/** 火山方舟可用模型（控制台 Model ID 需与接入点一致） */
const ASSISTANT_MODELS = [
  {
    id: 'doubao-seed-2-0-lite-260428',
    name: 'Doubao Seed 2.0 Lite',
    series: 'Seed 2.0',
    variant: 'Lite',
    description: '轻量版，日常问答与设备查询',
    provider: '火山方舟',
    capabilities: ['深度思考', '文本生成', '多模态理解', '工具调用'],
    limits: { ...SEED_2_LIMITS },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
  {
    id: 'doubao-seed-2-0-mini-260428',
    name: 'Doubao Seed 2.0 Mini',
    series: 'Seed 2.0',
    variant: 'Mini',
    description: '默认推荐，速度与能力均衡',
    provider: '火山方舟',
    recommended: true,
    capabilities: ['深度思考', '文本生成', '多模态理解', '工具调用'],
    limits: { ...SEED_2_LIMITS },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
  {
    id: 'doubao-seed-2-0-pro-260215',
    name: 'Doubao Seed 2.0 Pro',
    series: 'Seed 2.0',
    variant: 'Pro',
    description: '旗舰能力，复杂分析与长链路推理',
    provider: '火山方舟',
    capabilities: ['深度思考', '文本生成', '多模态理解', '工具调用'],
    limits: { ...SEED_2_LIMITS },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
  {
    id: 'doubao-seed-2-0-lite-260215',
    name: 'Doubao Seed 2.0 Lite',
    series: 'Seed 2.0',
    variant: 'Lite',
    versionTag: '260215',
    description: '轻量版，支持结构化输出',
    provider: '火山方舟',
    capabilities: ['深度思考', '文本生成', '多模态理解', '工具调用', '结构化输出'],
    limits: { ...SEED_2_LIMITS },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
  {
    id: 'doubao-seed-2-0-mini-260215',
    name: 'Doubao Seed 2.0 Mini',
    series: 'Seed 2.0',
    variant: 'Mini',
    versionTag: '260215',
    description: '均衡版，支持结构化输出',
    provider: '火山方舟',
    capabilities: ['深度思考', '文本生成', '多模态理解', '工具调用', '结构化输出'],
    limits: { ...SEED_2_LIMITS },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
  {
    id: 'doubao-seed-2-0-code-preview-260215',
    name: 'Doubao Seed 2.0 Code Preview',
    series: 'Seed 2.0',
    variant: 'Code',
    description: '代码与逻辑任务预览版',
    provider: '火山方舟',
    capabilities: ['深度思考', '文本生成', '多模态理解', '工具调用'],
    limits: { ...SEED_2_LIMITS },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
  {
    id: 'doubao-seed-character-251128',
    name: 'Doubao Seed Character',
    series: 'Seed',
    variant: 'Character',
    description: '角色扮演与对话风格化',
    provider: '火山方舟',
    capabilities: ['文本生成', '工具调用'],
    limits: {
      contextWindow: '128k',
      maxInput: '96k',
      maxOutput: '32k',
      maxOutputDefault: '4k',
      maxThinkingChain: null,
    },
    rateLimits: { ...SEED_2_RATE },
    rateLimitNote: RATE_LIMIT_NOTE,
  },
];

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (e) {
    console.warn('[AssistantModel] 读取配置失败:', e.message);
    return null;
  }
}

function writeSettings(data) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function isKnownModel(modelId) {
  return ASSISTANT_MODELS.some((m) => m.id === modelId);
}

function resolveModelMeta(modelId) {
  const row = ASSISTANT_MODELS.find((m) => m.id === modelId);
  if (row) return { ...row };
  return {
    id: modelId,
    name: modelId,
    description: '自定义模型',
    provider: '火山方舟',
    capabilities: [],
    limits: {},
    rateLimits: {},
  };
}

function getAssistantModelId() {
  const saved = readSettings()?.modelId;
  if (saved) return saved;
  return DEFAULT_MODEL_ID;
}

function getAssistantModelSettings() {
  const settings = readSettings();
  const modelId = getAssistantModelId();
  return {
    modelId,
    model: resolveModelMeta(modelId),
    defaultModelId: DEFAULT_MODEL_ID,
    updatedAt: settings?.updatedAt || null,
    updatedBy: settings?.updatedBy || null,
  };
}

function setAssistantModelId(modelId, updatedBy) {
  const id = String(modelId || '').trim();
  if (!id) throw new Error('请选择模型');
  if (!isKnownModel(id)) throw new Error('不支持的模型');
  const payload = {
    modelId: id,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || null,
  };
  writeSettings(payload);
  return getAssistantModelSettings();
}

function listAssistantModels() {
  return ASSISTANT_MODELS.map((m) => ({ ...m }));
}

module.exports = {
  ASSISTANT_MODELS,
  DEFAULT_MODEL_ID,
  getAssistantModelId,
  getAssistantModelSettings,
  setAssistantModelId,
  listAssistantModels,
  resolveModelMeta,
  isKnownModel,
};
