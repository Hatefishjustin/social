/**
 * Cloudflare Pages Function
 * 路径: /functions/api/notifications.js
 * 路由: /api/notifications
 * GET  - 获取通知列表（分页）
 * PUT  - 标记已读
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at, users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.id };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(5, parseInt(url.searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  const [{ results }, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, type, target_type, target_id, actor_email, content_preview, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(user.id, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) as total FROM notifications WHERE user_id = ?`).bind(user.id).first(),
  ]);

  const unreadRow = await env.DB.prepare(
    `SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = 0`
  ).bind(user.id).first();

  return json({
    notifications: results,
    pagination: { page, limit, total: countRow.total, totalPages: Math.ceil(countRow.total / limit) },
    unread: unreadRow.unread,
  });
};

export const onRequestPut = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: 'invalid_body' }, 400);
  }

  if (body.mark_all_read) {
    await env.DB.prepare(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`
    ).bind(user.id).run();
    return json({ ok: true });
  }

  if (body.id) {
    await env.DB.prepare(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`
    ).bind(body.id, user.id).run();
    return json({ ok: true });
  }

  return json({ error: 'missing_params' }, 400);
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};
