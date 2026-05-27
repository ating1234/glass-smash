// glass-smash-api Worker
// 部署方式：Cloudflare Dashboard → Workers → 貼上此檔案

const ALLOWED_ORIGINS = ['https://glass-smash.pages.dev'];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const NAME_RE = /^[一-鿿぀-ヿ가-힣a-zA-Z0-9 _\-!?.]+$/u;

async function handlePostScores(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const { name, score, round = 1 } = body;

  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 20 || !NAME_RE.test(name.trim()))
    return json({ ok: false, error: 'Invalid name' }, 400);
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 9_999_999)
    return json({ ok: false, error: 'Invalid score' }, 400);
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 1 || round > 9999)
    return json({ ok: false, error: 'Invalid round' }, 400);

  const cleanName = name.trim();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = (await sha256hex(ip)).slice(0, 16);
  const rlKey = `rl:${ipHash}`;
  const now = Date.now();

  const existing = await env.RATE_KV.get(rlKey, 'json');
  if (existing && (now - existing.ts) < 60_000) {
    if (existing.count >= 3) return json({ ok: false, error: 'Rate limit exceeded' }, 429);
    await env.RATE_KV.put(rlKey, JSON.stringify({ count: existing.count + 1, ts: existing.ts }), { expirationTtl: 60 });
  } else {
    await env.RATE_KV.put(rlKey, JSON.stringify({ count: 1, ts: now }), { expirationTtl: 60 });
  }

  await env.DB.prepare('INSERT INTO scores (name, score, round, created_at) VALUES (?, ?, ?, ?)')
    .bind(cleanName, score, round, Math.floor(now / 1000)).run();

  const rankResult = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?')
    .bind(score).first();

  return json({ ok: true, rank: rankResult?.rank ?? 1 });
}

async function handleGetTop(env) {
  const result = await env.DB.prepare(
    'SELECT name, score, round FROM scores ORDER BY score DESC LIMIT 10'
  ).all();
  return json({ ok: true, data: result.results ?? [] }, 200, { 'Cache-Control': 'public, max-age=30' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    // Health check（開放）
    if (path === '/ping' && method === 'GET') {
      return json({ ok: true, message: 'pong', ts: Date.now() });
    }

    // CORS preflight
    if (method === 'OPTIONS') {
      if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!isAllowedOrigin(origin)) return json({ ok: false, error: 'Forbidden' }, 403);
    const cors = corsHeaders(origin);

    let res;
    if (path === '/scores' && method === 'POST') {
      res = await handlePostScores(request, env);
    } else if (path === '/scores/top' && method === 'GET') {
      res = await handleGetTop(env);
    } else {
      res = json({ ok: false, error: 'Not found' }, 404);
    }

    const headers = new Headers(res.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(res.body, { status: res.status, headers });
  },
};
