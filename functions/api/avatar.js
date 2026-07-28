/**
 * Cloudflare Pages Function
 * 路径: /api/avatar
 * POST - 上传头像（base64图片数据）
 * GET  - 获取头像
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
    `SELECT sessions.expires_at, users.id, users.email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return row;
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');

  if (!userId) return jsonResponse({ error: 'missing_userId' }, 400);

  const row = await env.DB.prepare(
    `SELECT avatar_data FROM users WHERE id = ?`
  ).bind(userId).first();

  if (!row || !row.avatar_data) {
    return new Response(null, { status: 404 });
  }

  return new Response(row.avatar_data, {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { image } = body || {};
  if (!image || typeof image !== 'string') {
    return jsonResponse({ error: 'missing_image' }, 400);
  }

  // Validate base64 data URL format: data:image/...;base64,...
  if (!image.startsWith('data:image/')) {
    return jsonResponse({ error: 'invalid_format', message: '请提供base64图片数据' }, 400);
  }

  const MAX_SIZE = 150 * 1024; // 150KB
  if (image.length > MAX_SIZE * 1.5) {
    return jsonResponse({ error: 'too_large', message: '图片过大，请压缩后重新上传' }, 400);
  }

  await env.DB.prepare(
    `UPDATE users SET avatar_data = ? WHERE id = ?`
  ).bind(image, user.id).run();

  // Also set avatar_url to API endpoint for backwards compatibility
  const avatarApiUrl = `/api/avatar?userId=${user.id}`;
  await env.DB.prepare(
    `UPDATE users SET avatar_url = ? WHERE id = ?`
  ).bind(avatarApiUrl, user.id).run();

  return jsonResponse({ ok: true, avatarUrl: avatarApiUrl });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
