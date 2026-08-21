/**
 * 登录验证码 + IP 失败限流（内存，进程重启清空）
 */

const crypto = require('crypto');

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const CAPTCHA_LEN = 4;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混 0O1Il

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_FAILS = 20;
const IP_LOCK_MS = 15 * 60 * 1000;

const captchas = new Map(); // id -> { code, expireAt }
const ipFails = new Map(); // ip -> { count, windowStart, lockedUntil }

function pruneCaptchas(now = Date.now()) {
  for (const [id, row] of captchas.entries()) {
    if (row.expireAt <= now) captchas.delete(id);
  }
}

function randomCode(len = CAPTCHA_LEN) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i += 1) {
    out += CHARSET[bytes[i] % CHARSET.length];
  }
  return out;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 简易 SVG 验证码（无第三方依赖） */
function buildCaptchaSvg(code) {
  const w = 120;
  const h = 40;
  const chars = String(code).split('');
  const letters = chars.map((ch, i) => {
    const x = 18 + i * 26;
    const y = 26 + ((i % 2 === 0 ? -1 : 1) * (2 + (i % 3)));
    const rot = (i % 2 === 0 ? -1 : 1) * (6 + (i % 4) * 2);
    const color = `rgb(${50 + i * 20},${60 + i * 15},${130 + i * 10})`;
    return `<text x="${x}" y="${y}" fill="${color}" font-size="22" font-family="Verdana,Arial,sans-serif" font-weight="700" transform="rotate(${rot} ${x} ${y})">${escapeXml(ch)}</text>`;
  }).join('');
  const lines = [
    '<line x1="8" y1="12" x2="110" y2="28" stroke="rgba(100,116,139,0.35)" stroke-width="1"/>',
    '<line x1="10" y1="32" x2="112" y2="10" stroke="rgba(100,116,139,0.3)" stroke-width="1"/>',
    '<line x1="20" y1="8" x2="100" y2="36" stroke="rgba(148,163,184,0.4)" stroke-width="1"/>',
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="验证码"><rect width="100%" height="100%" fill="#f1f5f9"/>${lines}${letters}</svg>`;
}

function createCaptcha() {
  pruneCaptchas();
  const id = crypto.randomBytes(16).toString('hex');
  const code = randomCode();
  captchas.set(id, { code, expireAt: Date.now() + CAPTCHA_TTL_MS });
  const svg = buildCaptchaSvg(code);
  return {
    captchaId: id,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    expiresIn: CAPTCHA_TTL_MS,
  };
}

/**
 * 校验并消费验证码（一次性）
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function consumeCaptcha(captchaId, captchaCode) {
  pruneCaptchas();
  const id = String(captchaId || '').trim();
  const input = String(captchaCode || '').trim().toUpperCase();
  if (!id || !input) {
    return { ok: false, error: '请输入验证码' };
  }
  const row = captchas.get(id);
  captchas.delete(id);
  if (!row) {
    return { ok: false, error: '验证码已失效，请刷新' };
  }
  if (row.expireAt <= Date.now()) {
    return { ok: false, error: '验证码已过期，请刷新' };
  }
  if (row.code !== input) {
    return { ok: false, error: '验证码错误' };
  }
  return { ok: true };
}

function normalizeIp(ip) {
  if (!ip) return 'unknown';
  const s = String(ip).trim();
  if (s.startsWith('::ffff:')) return s.slice(7);
  return s;
}

function getIpGuard(ip) {
  const key = normalizeIp(ip);
  const now = Date.now();
  let row = ipFails.get(key);
  if (!row) {
    row = { count: 0, windowStart: now, lockedUntil: 0 };
    ipFails.set(key, row);
  }
  if (row.lockedUntil && row.lockedUntil > now) {
    const mins = Math.ceil((row.lockedUntil - now) / 60000);
    return { ok: false, error: `尝试过多，请 ${mins} 分钟后再试` };
  }
  if (now - row.windowStart > IP_WINDOW_MS) {
    row.count = 0;
    row.windowStart = now;
    row.lockedUntil = 0;
  }
  return { ok: true, key, row };
}

function assertIpNotLocked(ip) {
  return getIpGuard(ip);
}

function recordLoginFailure(ip) {
  const guard = getIpGuard(ip);
  if (!guard.ok) return guard;
  const { row } = guard;
  row.count += 1;
  if (row.count >= IP_MAX_FAILS) {
    row.lockedUntil = Date.now() + IP_LOCK_MS;
    return { ok: false, error: `尝试过多，请 ${Math.ceil(IP_LOCK_MS / 60000)} 分钟后再试` };
  }
  return { ok: true, remaining: IP_MAX_FAILS - row.count };
}

function clearLoginFailures(ip) {
  ipFails.delete(normalizeIp(ip));
}

module.exports = {
  createCaptcha,
  consumeCaptcha,
  assertIpNotLocked,
  recordLoginFailure,
  clearLoginFailures,
  CAPTCHA_TTL_MS,
  IP_MAX_FAILS,
  IP_LOCK_MS,
};
