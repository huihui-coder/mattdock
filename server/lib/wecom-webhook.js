const https = require('https');
const http = require('http');

/** 企业微信 markdown.content 上限（UTF-8 字节，官方 4096） */
const WECOM_MARKDOWN_MAX = Number(process.env.WECOM_MARKDOWN_MAX || 4096);

function byteLengthUtf8(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function fitWecomMarkdown(content, maxBytes = WECOM_MARKDOWN_MAX) {
  const text = String(content || '');
  if (byteLengthUtf8(text) <= maxBytes) return text;

  const suffix = '\n\n> …（已截断）';
  const suffixBytes = byteLengthUtf8(suffix);
  const budget = Math.max(200, maxBytes - suffixBytes);

  let end = text.length;
  while (end > 0 && byteLengthUtf8(text.slice(0, end)) > budget) {
    end -= 32;
  }
  return `${text.slice(0, Math.max(0, end))}${suffix}`;
}

function parseWecomWebhookResponse(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      ok: data.errcode === 0,
      errcode: data.errcode,
      errmsg: data.errmsg,
      raw: data,
    };
  } catch {
    return { ok: false, errcode: -1, errmsg: String(raw), raw: null };
  }
}

function postWecomRaw(webhookUrl, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * @returns {Promise<{ ok: boolean, errcode: number, errmsg: string }>}
 */
async function postWecomPayload(webhookUrl, payload, logPrefix = '[WeCom]') {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const raw = await postWecomRaw(webhookUrl, body);
  console.log(`${logPrefix} 企业微信推送:`, raw);
  const result = parseWecomWebhookResponse(raw);
  if (!result.ok) {
    throw new Error(`企业微信推送失败 ${result.errcode}: ${result.errmsg}`);
  }
  return result;
}

async function postWecomMarkdown(webhookUrl, content, logPrefix = '[WeCom]') {
  const maxBytes = WECOM_MARKDOWN_MAX;
  const fitted = fitWecomMarkdown(content, maxBytes);
  const beforeBytes = byteLengthUtf8(content);
  const afterBytes = byteLengthUtf8(fitted);
  if (afterBytes < beforeBytes) {
    console.warn(
      `${logPrefix} Markdown 已截断 ${beforeBytes} → ${afterBytes} 字节（上限 ${maxBytes}）`,
    );
  }
  return postWecomPayload(
    webhookUrl,
    { msgtype: 'markdown', markdown: { content: fitted } },
    logPrefix,
  );
}

module.exports = {
  WECOM_MARKDOWN_MAX,
  fitWecomMarkdown,
  parseWecomWebhookResponse,
  postWecomPayload,
  postWecomMarkdown,
};
