/**
 * Cloudflare Pages Function
 * 路径: /chat/report
 * 方法: POST
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

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { matchId, reason } = body || {};
  if (!matchId || !reason || reason.length < 5) {
    return jsonResponse({ error: 'invalid_body', message: '请填写举报原因（至少5字）' }, 400);
  }

  const match = await env.DB.prepare(
    `SELECT * FROM matches WHERE id = ? AND (user_a = ? OR user_b = ?)`
  ).bind(matchId, user.id, user.id).first();

  if (!match) return jsonResponse({ error: 'not_found' }, 404);

  await env.DB.prepare(
    `INSERT INTO reports (reporter_id, match_id, reason, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(user.id, matchId, reason, Date.now()).run();

  await env.DB.prepare(
    `UPDATE matches SET status = 'closed', closed_at = ? WHERE id = ?`
  ).bind(Date.now(), matchId).run();

  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, created_at)
     VALUES (?, 0, ?, ?)`
  ).bind(matchId, '【系统】该对话已被举报并冻结，平台工作人员将介入调查。', Date.now()).run();

  return jsonResponse({ ok: true, message: '举报已提交，对话已冻结' });
};
