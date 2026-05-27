// POST /api/scores — 提交分數

const ALLOWED_ORIGINS = [
  'https://glass-smash.pages.dev',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// SHA-256 hash (Web Crypto API，Pages Functions 支援)
async function sha256hex(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 名稱驗證：只允許 CJK / 英數 / 空白 / 常用符號，不允許 HTML 特殊字元
const NAME_RE = /^[一-鿿぀-ヿ가-힯a-zA-Z0-9 _\-!?~^*#@%&+.]+$/u;

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }
  const cors = corsHeaders(origin);

  // 解析 body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400, cors);
  }

  const { name, score, round = 1 } = body;

  // 驗證 name
  if (
    typeof name !== 'string' ||
    name.trim().length < 1 ||
    name.trim().length > 20 ||
    !NAME_RE.test(name.trim())
  ) {
    return json({ ok: false, error: 'Invalid name' }, 400, cors);
  }

  // 驗證 score
  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 1 ||
    score > 9_999_999
  ) {
    return json({ ok: false, error: 'Invalid score' }, 400, cors);
  }

  // 驗證 round
  if (
    typeof round !== 'number' ||
    !Number.isInteger(round) ||
    round < 1 ||
    round > 9999
  ) {
    return json({ ok: false, error: 'Invalid round' }, 400, cors);
  }

  const cleanName = name.trim();

  // Rate limiting — 每 IP 每 60 秒最多 3 次
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = (await sha256hex(ip)).slice(0, 16);
  const rlKey = `rl:${ipHash}`;

  const existing = await env.RATE_KV.get(rlKey, 'json');
  const now = Date.now();

  if (existing && (now - existing.ts) < 60_000) {
    if (existing.count >= 3) {
      return json({ ok: false, error: 'Rate limit exceeded' }, 429, cors);
    }
    await env.RATE_KV.put(
      rlKey,
      JSON.stringify({ count: existing.count + 1, ts: existing.ts }),
      { expirationTtl: 60 }
    );
  } else {
    await env.RATE_KV.put(
      rlKey,
      JSON.stringify({ count: 1, ts: now }),
      { expirationTtl: 60 }
    );
  }

  // 寫入 D1
  const createdAt = Math.floor(now / 1000);
  await env.DB.prepare(
    'INSERT INTO scores (name, score, round, created_at) VALUES (?, ?, ?, ?)'
  ).bind(cleanName, score, round, createdAt).run();

  // 查詢排名（分數嚴格高於此分數的數量 + 1）
  const rankResult = await env.DB.prepare(
    'SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?'
  ).bind(score).first();

  return json({ ok: true, rank: rankResult?.rank ?? 1 }, 200, cors);
}
