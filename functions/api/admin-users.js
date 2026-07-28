/**
 * Cloudflare Pages Function
 * 路径: /api/admin-users
 * GET: 列出所有管理员
 * PUT: 添加管理员 {email:"xxx@xxx.com"} 或移除 {email:"xxx@xxx.com", action:"remove"}
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

async function getCurrentAdmin(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at, users.id, users.email, users.is_admin
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  if (!row.is_admin) return null;
  return row;
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const admin = await getCurrentAdmin(request, env);
  if (!admin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  const result = await env.DB.prepare(
    'SELECT id, email, is_admin, created_at FROM users WHERE is_admin = 1 ORDER BY created_at DESC'
  ).all();

  return jsonResponse({ admins: result.results });
};

export const onRequestPut = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const admin = await getCurrentAdmin(request, env);
  if (!admin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { email, action } = body;
  if (!email) return jsonResponse({ error: 'missing_email', message: '请输入邮箱' }, 400);

  const userRow = await env.DB.prepare(
    'SELECT id, email, is_admin FROM users WHERE email = ?'
  ).bind(email.trim().toLowerCase()).first();

  if (!userRow) {
    return jsonResponse({ error: 'user_not_found', message: '该邮箱尚未注册' }, 404);
  }

  if (action === 'remove') {
    if (userRow.is_admin === 0) {
      return jsonResponse({ error: 'not_admin', message: '该用户不是管理员' }, 400);
    }
    await env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(userRow.id).run();
    return jsonResponse({ success: true, message: '已移除管理员权限' });
  }

  // Default: add admin
  if (userRow.is_admin === 1) {
    return jsonResponse({ error: 'already_admin', message: '该用户已经是管理员' }, 400);
  }
  await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(userRow.id).run();
  return jsonResponse({ success: true, message: '已添加为管理员' });
};
