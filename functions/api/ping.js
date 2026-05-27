// GET /api/ping — 無需 Binding 的健康檢查
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: 'pong', ts: Date.now() }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
