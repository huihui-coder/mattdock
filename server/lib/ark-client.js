const ARK_API_BASE = (
  process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3'
).replace(/\/$/, '');
const ARK_MODEL = (process.env.ARK_MODEL || 'doubao-seed-2-0-mini-260428').trim();
const RATE_LIMIT_HINTS = ['访问量过大', 'RateLimit', 'rate limit', 'Too Many Requests', '限流', '并发'];
const MAX_RETRIES = 20;
const RETRY_BASE_MS = 2000;
const NETWORK_PROBE_CACHE_MS = 60 * 1000;

let networkProbeCache = { ok: null, at: 0 };

function getApiKey() {
  return (process.env.ARK_API_KEY || '').trim();
}

function getAssistantModel() {
  try {
    const { getAssistantModelId } = require('./assistant-model-store');
    return getAssistantModelId();
  } catch {
    return ARK_MODEL;
  }
}

function normalizeUsage(usage) {
  if (!usage) return null;
  const total =
    usage.total_tokens ??
    (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0));
  return { ...usage, total_tokens: total };
}

function isRateLimitError(text) {
  const msg = String(text || '');
  return RATE_LIMIT_HINTS.some((hint) => msg.includes(hint));
}

function isRetryableNetworkError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('fetch failed')
    || msg.includes('econnreset')
    || msg.includes('etimedout')
    || msg.includes('enotfound')
    || msg.includes('econnrefused')
    || msg.includes('socket hang up')
    || msg.includes('network')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  return RETRY_BASE_MS * Math.min(attempt, 5);
}

async function fetchArkWithRetry(url, options, maxRetries = MAX_RETRIES) {
  let lastResponse;
  let lastText = '';
  let lastNetworkError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      lastResponse = await fetch(url, options);
      lastNetworkError = null;
    } catch (err) {
      lastNetworkError = err;
      if (isRetryableNetworkError(err) && attempt < maxRetries) {
        const delay = retryDelayMs(attempt);
        console.warn(
          `[Ark] 网络异常（${err.message}），第 ${attempt}/${maxRetries} 次重试，${delay}ms 后重试…`,
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }

    if (lastResponse.ok) return lastResponse;

    lastText = await lastResponse.text();
    if (
      (lastResponse.status === 429 || isRateLimitError(lastText))
      && attempt < maxRetries
    ) {
      const delay = retryDelayMs(attempt);
      console.warn(`[Ark] 限流/繁忙，第 ${attempt}/${maxRetries} 次重试，${delay}ms 后重试…`);
      await sleep(delay);
      continue;
    }

    return new Response(lastText, {
      status: lastResponse.status,
      statusText: lastResponse.statusText,
      headers: lastResponse.headers,
    });
  }

  if (lastNetworkError) throw lastNetworkError;

  return new Response(lastText, {
    status: lastResponse?.status || 429,
    statusText: lastResponse?.statusText || 'Too Many Requests',
    headers: lastResponse?.headers,
  });
}

async function isExternalNetworkAvailable() {
  const now = Date.now();
  if (networkProbeCache.ok !== null && now - networkProbeCache.at < NETWORK_PROBE_CACHE_MS) {
    return networkProbeCache.ok;
  }

  const probeUrl = (process.env.NETWORK_PROBE_URL || 'https://ark.cn-beijing.volces.com').trim();
  let ok = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Number(process.env.NETWORK_PROBE_TIMEOUT_MS || 4000),
    );
    const res = await fetch(probeUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    ok = res.ok || (res.status >= 200 && res.status < 500);
  } catch {
    ok = false;
  }

  networkProbeCache = { ok, at: now };
  return ok;
}

async function shouldUseWebSearch(flag) {
  const mode = flag !== undefined ? flag : (process.env.ARK_WEB_SEARCH || 'auto');
  if (mode === false || mode === 0 || mode === '0' || mode === 'false') return false;
  if (mode === true || mode === 1 || mode === '1' || mode === 'true') return true;
  return isExternalNetworkAvailable();
}

function convertContentPart(part) {
  if (!part) return null;
  if (typeof part === 'string') {
    return { type: 'input_text', text: part };
  }
  if (part.type === 'text') {
    return { type: 'input_text', text: part.text || '' };
  }
  if (part.type === 'image_url') {
    const url = part.image_url?.url || part.image_url;
    if (!url) return null;
    return { type: 'input_image', image_url: url };
  }
  return null;
}

function convertMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  const parts = content.map(convertContentPart).filter(Boolean);
  if (parts.length === 1 && parts[0].type === 'input_text') return parts[0].text;
  return parts;
}

function messagesToArkRequest(messages) {
  const instructionsParts = [];
  const input = [];

  for (const msg of messages || []) {
    if (!msg?.role) continue;
    if (msg.role === 'system') {
      instructionsParts.push(String(msg.content || ''));
      continue;
    }
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;

    input.push({
      type: 'message',
      role: msg.role,
      content: convertMessageContent(msg.content),
    });
  }

  return {
    instructions: instructionsParts.length ? instructionsParts.join('\n\n') : undefined,
    input,
  };
}

function extractResponseText(data) {
  const output = data?.output;
  if (!Array.isArray(output)) return '';

  const parts = [];
  for (const item of output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === 'output_text' && block.text) parts.push(block.text);
      }
    }
  }
  return parts.join('').trim();
}

function parseArkError(data, fallbackText) {
  const errMsg =
    data?.error?.message
    || data?.message
    || (typeof data?.error === 'string' ? data.error : null)
    || fallbackText;
  return typeof errMsg === 'string' ? errMsg : '火山方舟 API 请求失败';
}

async function buildResponsesPayload({
  model = ARK_MODEL,
  messages,
  stream = false,
  webSearch,
}) {
  const { instructions, input } = messagesToArkRequest(messages);
  const payload = {
    model,
    input,
    stream,
  };
  if (instructions) payload.instructions = instructions;

  const webSearchEnabled = await shouldUseWebSearch(webSearch);
  if (webSearchEnabled) {
    payload.tools = [{ type: 'web_search' }];
  }

  return { payload, webSearchEnabled };
}

async function callArkCompletion({
  messages,
  onTokenUsage,
  model = ARK_MODEL,
  webSearch,
}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('未配置 ARK_API_KEY');

  const { payload, webSearchEnabled } = await buildResponsesPayload({
    model,
    messages,
    stream: false,
    webSearch,
  });
  if (webSearchEnabled) {
    console.log('[Ark] 已启用联网搜索（web_search）');
  }

  const res = await fetchArkWithRetry(`${ARK_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || res.statusText || '火山方舟 API 响应异常');
  }

  if (!res.ok) {
    throw new Error(parseArkError(data, text));
  }

  if (data.status === 'failed') {
    throw new Error(parseArkError(data, '模型生成失败'));
  }

  if (onTokenUsage && data.usage) {
    onTokenUsage(normalizeUsage(data.usage));
  }

  return extractResponseText(data);
}

function arkStreamEventToOpenAIChunk(event, model) {
  const type = event?.type;
  if (type === 'response.output_text.delta' && event.delta) {
    return {
      id: event.response_id || 'ark-stream',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }],
      model,
    };
  }
  if (type === 'response.completed') {
    const usage = normalizeUsage(event.response?.usage || event.usage);
    return {
      id: event.response?.id || 'ark-stream',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      model,
      usage,
    };
  }
  return null;
}

async function fetchArkStreamResponse({ messages, model = ARK_MODEL, webSearch }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('未配置 ARK_API_KEY');

  const { payload, webSearchEnabled } = await buildResponsesPayload({
    model,
    messages,
    stream: true,
    webSearch,
  });
  if (webSearchEnabled) {
    console.log('[Ark] 已启用联网搜索（web_search）');
  }

  return fetchArkWithRetry(`${ARK_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function createOpenAIStreamTransformer(model) {
  let buffer = '';
  let lastUsage;

  return {
    getLastUsage: () => lastUsage,
    transformChunk(value) {
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      const out = [];
      let pendingEventType = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          pendingEventType = '';
          continue;
        }
        if (trimmed.startsWith('event:')) {
          pendingEventType = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') {
          out.push('data: [DONE]\n\n');
          continue;
        }

        try {
          const event = JSON.parse(dataStr);
          const eventType = event.type || pendingEventType;
          if (eventType && !event.type) event.type = eventType;

          const chunk = arkStreamEventToOpenAIChunk(event, model);
          if (chunk?.usage) lastUsage = chunk.usage;
          if (chunk) {
            out.push(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        } catch {
          /* ignore partial JSON */
        }
      }

      return out.join('');
    },
    flush() {
      return buffer;
    },
  };
}

module.exports = {
  ARK_API_BASE,
  ARK_MODEL,
  getApiKey,
  getAssistantModel,
  normalizeUsage,
  isRateLimitError,
  isExternalNetworkAvailable,
  shouldUseWebSearch,
  messagesToArkRequest,
  buildResponsesPayload,
  fetchArkWithRetry,
  callArkCompletion,
  fetchArkStreamResponse,
  createOpenAIStreamTransformer,
  extractResponseText,
  MAX_RETRIES,
};
