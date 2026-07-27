/**
 * Cloudflare Pages Function
 * 路径: /chat/history
 * 方法: GET
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const matchId = url.searchParams.get('matchId');
  const before = parseInt(url.searchParams.get('before') || '9999999999999');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100);

  if (!matchId) return jsonResponse({ error: 'missing_param' }, 400);

  const match = await env.DB.prepare(
    `SELECT * FROM matches
     WHERE id = ? AND (user_a = ? OR user_b = ?)`
  ).bind(matchId, user.id, user.id).first();

  if (!match) return jsonResponse({ error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.sender_id, m.content, m.created_at, p.nickname as sender_name
     FROM messages m
     LEFT JOIN profiles p ON p.user_id = m.sender_id
     WHERE m.match_id = ? AND m.id < ?
     ORDER BY m.created_at DESC
     LIMIT ?`
  ).bind(matchId, before, limit).all();

  return jsonResponse({
    messages: (results || []).reverse(),
    hasMore: (results || []).length === limit
  });
};
