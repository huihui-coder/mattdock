const ZHIPU_API_BASE = (process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(
  /\/$/,
  '',
);
const ZHIPU_MODEL = (process.env.ZHIPU_MODEL || 'glm-4.6v-flash').trim();
const RATE_LIMIT_HINT = '该模型当前访问量过大，请您稍后再试';
const MAX_RETRIES = 20;
const RETRY_BASE_MS = 2000;

function getApiKey() {
  return (process.env.ZHIPU_API_KEY || '').trim();
}

function isRateLimitError(text) {
  const msg = String(text || '');
  return msg.includes(RATE_LIMIT_HINT) || msg.includes('访问量过大');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带限流重试的上游 fetch（最多 20 次）
 */
async function fetchZhipuWithRetry(url, options, maxRetries = MAX_RETRIES) {
  let lastResponse;
  let lastText = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResponse = await fetch(url, options);
    if (lastResponse.ok) return lastResponse;

    lastText = await lastResponse.text();
    if (isRateLimitError(lastText) && attempt < maxRetries) {
      const delay = RETRY_BASE_MS * Math.min(attempt, 5);
      console.warn(`[Zhipu] 访问量过大，第 ${attempt}/${maxRetries} 次重试，${delay}ms 后重试…`);
      await sleep(delay);
      continue;
    }

    return new Response(lastText, {
      status: lastResponse.status,
      statusText: lastResponse.statusText,
      headers: lastResponse.headers,
    });
  }

  return new Response(lastText, {
    status: lastResponse?.status || 429,
    statusText: lastResponse?.statusText || 'Too Many Requests',
    headers: lastResponse?.headers,
  });
}

/**
 * 非流式多模态对话，返回 assistant 文本
 */
async function callZhipuChatCompletion({ messages, onTokenUsage, model = ZHIPU_MODEL }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('未配置 ZHIPU_API_KEY');

  const res = await fetchZhipuWithRetry(`${ZHIPU_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      thinking: { type: 'disabled' },
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || res.statusText || '智谱 API 响应异常');
  }

  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || text;
    throw new Error(typeof errMsg === 'string' ? errMsg : '智谱 API 请求失败');
  }

  if (onTokenUsage && data.usage) onTokenUsage(data.usage);

  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

module.exports = {
  ZHIPU_API_BASE,
  ZHIPU_MODEL,
  getApiKey,
  isRateLimitError,
  fetchZhipuWithRetry,
  callZhipuChatCompletion,
  MAX_RETRIES,
};
