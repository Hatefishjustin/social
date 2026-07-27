/**
 * Cloudflare Pages Function
 * 路径: /quiz/latest
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

  const row = await env.DB.prepare(
    `SELECT id, created_at, headline, scores_json, answers_json
     FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (!row) return jsonResponse({ exists: false });

  return jsonResponse({
    exists: true,
    id: row.id,
    createdAt: row.created_at,
    headline: row.headline,
    scores: JSON.parse(row.scores_json),
    answers: JSON.parse(row.answers_json || '{}'),
  });
};
