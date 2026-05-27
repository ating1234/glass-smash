// GET /api/scores/top — 取前 10 名排行榜

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }
  const cors = corsHeaders(origin);

  const result = await env.DB.prepare(
    'SELECT name, score, round FROM scores ORDER BY score DESC LIMIT 10'
  ).all();

  return json(
    { ok: true, data: result.results ?? [] },
    200,
    { ...cors, 'Cache-Control': 'public, max-age=30' }
  );
}
