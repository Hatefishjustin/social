/**
 * Cloudflare Pages Function
 * 路径: /admin/support/matches
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

async function isStaff(userId, env) {
  const staff = await env.DB.prepare(
    'SELECT * FROM staff_accounts WHERE user_id = ?'
  ).bind(userId).first();
  return !!staff;
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

  if (!await isStaff(user.id, env)) {
    return jsonResponse({ error: 'forbidden', message: '非客服账号' }, 403);
  }

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.user_a, m.match_score, m.match_reason, m.status, m.created_at,
            p.nickname as user_nickname, p.gender, p.age_group, p.scores_json,
            (SELECT COUNT(*) FROM messages WHERE match_id = m.id AND sender_id = m.user_a AND is_read = 0) as unread_count
     FROM matches m
     JOIN profiles p ON p.user_id = m.user_a
     WHERE m.user_b = ? AND m.is_shadow = 1 AND m.status = 'accepted'
     ORDER BY unread_count DESC, m.created_at DESC`
  ).bind(user.id).all();

  return jsonResponse({ matches: results || [] });
};
