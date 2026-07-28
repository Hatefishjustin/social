/**
 * Cloudflare Pages Function
 * 路径: /profile
 * 方法: GET - 获取个人信息  PUT - 更新昵称/头像
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

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at, users.id, users.email, users.display_name, users.avatar_url
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return row;
}

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);
  return jsonResponse({
    displayName: user.display_name || '',
    avatarUrl: user.avatar_url || '',
  });
};

export const onRequestPut = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { displayName, avatarUrl } = body || {};
  const updates = [];
  const params = [];

  if (displayName !== undefined) {
    const name = String(displayName).trim().slice(0, 30);
    updates.push('display_name = ?');
    params.push(name);
  }
  if (avatarUrl !== undefined) {
    const url = String(avatarUrl).trim().slice(0, 1000);
    updates.push('avatar_url = ?');
    params.push(url);
  }

  if (updates.length === 0) {
    return jsonResponse({ error: 'no_fields' }, 400);
  }

  params.push(user.id);
  await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return jsonResponse({ ok: true });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
};
