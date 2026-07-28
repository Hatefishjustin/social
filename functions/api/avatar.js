/**
 * Cloudflare Pages Function
 * 路径: /api/avatar
 * POST - 上传头像（base64图片，存入avatars表）
 * GET  - 获取头像图片
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\s*)' + name + '=([^;]+)'));
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
    `SELECT image_data FROM avatars WHERE user_id = ?`
  ).bind(userId).first();

  if (!row || !row.image_data) {
    return new Response(null, { status: 404 });
  }

  return new Response(row.image_data, {
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
  if (!image.startsWith('data:image/')) {
    return jsonResponse({ error: 'invalid_format', message: '请提供base64图片数据' }, 400);
  }

  // 150KB limit
  if (image.length > 210000) {
    return jsonResponse({ error: 'too_large', message: '图片过大，请压缩后重试' }, 400);
  }

  // Auto-create avatars table
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS avatars (user_id TEXT PRIMARY KEY, image_data TEXT NOT NULL, updated_at INTEGER NOT NULL)`
    ).run();
  } catch(e) { console.error('create avatars table:', e.message); }

  // Upsert avatar
  await env.DB.prepare(
    `INSERT INTO avatars (user_id, image_data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET image_data = excluded.image_data, updated_at = excluded.updated_at`
  ).bind(user.id, image, Date.now()).run();

  const avatarUrl = '/api/avatar?userId=' + user.id;

  // Update users.avatar_url for session.js sync
  await env.DB.prepare(
    `UPDATE users SET avatar_url = ? WHERE id = ?`
  ).bind(avatarUrl, user.id).run();

  return jsonResponse({ ok: true, avatarUrl: avatarUrl });
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
