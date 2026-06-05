const ZHIPU_API_BASE = (process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(
  /\/$/,
  '',
);
const ZHIPU_MODEL = (process.env.ZHIPU_MODEL || 'glm-4.6v-flash').trim();
const RATE_LIMIT_HINT = '该模型当前访问量过大，请您稍后再试';
const MAX_RETRIES = 20;
const RETRY_BASE_MS = 2000;
const NETWORK_PROBE_CACHE_MS = 60 * 1000;

let networkProbeCache = { ok: null, at: 0 };

function getApiKey() {
  return (process.env.ZHIPU_API_KEY || '').trim();
}

function isRateLimitError(text) {
  const msg = String(text || '');
  return msg.includes(RATE_LIMIT_HINT) || msg.includes('访问量过大');
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

/**
 * 带限流与网络错误重试的上游 fetch（最多 20 次）
 */
async function fetchZhipuWithRetry(url, options, maxRetries = MAX_RETRIES) {
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
          `[Zhipu] 网络异常（${err.message}），第 ${attempt}/${maxRetries} 次重试，${delay}ms 后重试…`,
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }

    if (lastResponse.ok) return lastResponse;

    lastText = await lastResponse.text();
    if (isRateLimitError(lastText) && attempt < maxRetries) {
      const delay = retryDelayMs(attempt);
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

  if (lastNetworkError) throw lastNetworkError;

  return new Response(lastText, {
    status: lastResponse?.status || 429,
    statusText: lastResponse?.statusText || 'Too Many Requests',
    headers: lastResponse?.headers,
  });
}

/**
 * 探测是否可访问外网（用于决定是否启用智谱联网搜索）
 */
async function isExternalNetworkAvailable() {
  const now = Date.now();
  if (networkProbeCache.ok !== null && now - networkProbeCache.at < NETWORK_PROBE_CACHE_MS) {
    return networkProbeCache.ok;
  }

  const probeUrl = (process.env.NETWORK_PROBE_URL || 'https://open.bigmodel.cn').trim();
  let ok = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.NETWORK_PROBE_TIMEOUT_MS || 4000));
    const res = await fetch(probeUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    ok = res.ok || (res.status >= 200 && res.status < 500);
  } catch {
    ok = false;
  }

  networkProbeCache = { ok, at: now };
  return ok;
}

/**
 * @param {boolean|string|undefined} flag true/'1' 强制开，false/'0' 关，'auto' 或默认按外网探测
 */
async function shouldUseWebSearch(flag) {
  const mode = flag !== undefined ? flag : (process.env.ZHIPU_WEB_SEARCH || 'auto');
  if (mode === false || mode === 0 || mode === '0' || mode === 'false') return false;
  if (mode === true || mode === 1 || mode === '1' || mode === 'true') return true;
  return isExternalNetworkAvailable();
}

function buildWebSearchTools(searchQuery) {
  const webSearch = {
    enable: true,
    search_result: true,
  };
  const q = String(searchQuery || '').trim();
  if (q) webSearch.search_query = q;
  const engine = (process.env.ZHIPU_WEB_SEARCH_ENGINE || '').trim();
  if (engine) webSearch.search_engine = engine;
  const count = (process.env.ZHIPU_WEB_SEARCH_COUNT || '').trim();
  if (count) webSearch.count = count;
  const recency = (process.env.ZHIPU_WEB_SEARCH_RECENCY || '').trim();
  if (recency) webSearch.search_recency_filter = recency;
  return [{ type: 'web_search', web_search: webSearch }];
}

/**
 * 构建 chat/completions 请求体（可选联网搜索）
 */
async function buildChatCompletionPayload({
  model = ZHIPU_MODEL,
  messages,
  stream = false,
  thinkingType = 'disabled',
  webSearch,
  webSearchQuery,
}) {
  const payload = {
    model,
    messages,
    stream,
    thinking: { type: thinkingType },
  };
  const webSearchEnabled = await shouldUseWebSearch(webSearch);
  if (webSearchEnabled) {
    payload.tools = buildWebSearchTools(webSearchQuery);
  }
  return { payload, webSearchEnabled };
}

/**
 * 非流式多模态对话，返回 assistant 文本
 */
async function callZhipuChatCompletion({
  messages,
  onTokenUsage,
  model = ZHIPU_MODEL,
  webSearch,
  webSearchQuery,
}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('未配置 ZHIPU_API_KEY');

  const { payload, webSearchEnabled } = await buildChatCompletionPayload({
    model,
    messages,
    stream: false,
    thinkingType: 'disabled',
    webSearch,
    webSearchQuery,
  });
  if (webSearchEnabled) {
    const qHint = webSearchQuery ? `，检索：${String(webSearchQuery).slice(0, 60)}…` : '';
    console.log(`[Zhipu] 已启用联网搜索（web_search）${qHint}`);
  }

  const res = await fetchZhipuWithRetry(`${ZHIPU_API_BASE}/chat/completions`, {
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
  isExternalNetworkAvailable,
  shouldUseWebSearch,
  buildWebSearchTools,
  buildChatCompletionPayload,
  fetchZhipuWithRetry,
  callZhipuChatCompletion,
  MAX_RETRIES,
};
