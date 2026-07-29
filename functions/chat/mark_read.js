/**
 * Cloudflare Pages Function
 * 路径: /chat/mark_read
 * 方法: POST
 * 功能: 将指定会话中对方发来的消息标记为已读
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
    `SELECT sessions.expires_at, users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.id };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const matchId = body.matchId;
  if (!matchId) return jsonResponse({ error: 'missing_param' }, 400);

  await env.DB.prepare(
    `UPDATE messages SET is_read = 1
     WHERE match_id = ? AND sender_id != ? AND sender_id IS NOT NULL AND is_read = 0`
  ).bind(matchId, user.id).run();

  return jsonResponse({ ok: true });
};
