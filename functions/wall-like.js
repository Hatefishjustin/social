/**
 * 路径: /functions/wall-like.js
 * 路由: /wall-like
 */

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { postId, action } = body || {};
  if (!postId || !['like', 'unlike'].includes(action)) {
    return jsonResponse({ error: 'invalid_params' }, 400);
  }

  if (action === 'like') {
    try {
      await env.DB.prepare(
        `INSERT INTO wall_likes (post_id, user_id, created_at) VALUES (?, ?, ?)`
      ).bind(postId, user.id, Date.now()).run();
      await env.DB.prepare(
        `UPDATE wall_posts SET likes_count = likes_count + 1 WHERE id = ?`
      ).bind(postId).run();
    } catch (e) {
      // 唯一约束冲突表示已点赞，忽略
    }
  } else {
    const del = await env.DB.prepare(
      `DELETE FROM wall_likes WHERE post_id = ? AND user_id = ?`
    ).bind(postId, user.id).run();
    if (del.meta.changes > 0) {
      await env.DB.prepare(
        `UPDATE wall_posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?`
      ).bind(postId).run();
    }
  }

  const row = await env.DB.prepare(
    `SELECT likes_count FROM wall_posts WHERE id = ?`
  ).bind(postId).first();

  return jsonResponse({ ok: true, likesCount: row?.likes_count || 0 });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};
