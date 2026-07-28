/**
 * Cloudflare Pages Function
 * 路径: /api/view
 * POST: 记录页面访问 {page:"index"}
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const page = (body.page || 'unknown').slice(0, 50);

  // Check if logged in
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  let userId = null;
  let isLoggedIn = 0;

  if (sessionToken) {
    const row = await env.DB.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token = ?'
    ).bind(sessionToken).first();
    if (row && Date.now() <= row.expires_at) {
      userId = row.user_id;
      isLoggedIn = 1;
    }
  }

  await env.DB.prepare(
    'INSERT INTO page_views (page, user_id, is_logged_in, created_at) VALUES (?, ?, ?, ?)'
  ).bind(page, userId, isLoggedIn, Date.now()).run();

  return jsonResponse({ success: true });
};
