/**
 * Cloudflare Pages Function
 * 路径: /functions/wall.js
 * 路由: /wall
 *
 * GET  /wall?page=1&tag=表白   -> 获取帖子列表
 * POST /wall                    -> 发布帖子
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
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

const PAGE_SIZE = 20;

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const tag = url.searchParams.get('tag') || null;
  const offset = (page - 1) * PAGE_SIZE;

  let sql = `SELECT id, content, tag, is_anonymous, school, created_at, likes_count, comments_count
             FROM wall_posts`;
  let countSql = `SELECT COUNT(*) as total FROM wall_posts`;
  const params = [];

  if (tag) {
    sql += ` WHERE tag = ?`;
    countSql += ` WHERE tag = ?`;
    params.push(tag);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const { results } = await env.DB.prepare(sql).bind(...params, PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare(countSql).bind(...params.slice(0, -2)).first();
  const total = countRow?.total || 0;

  return jsonResponse({
    posts: results,
    pagination: { page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) },
  });
};

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体必须是 JSON' }, 400);
  }

  const { content, tag = '#表白', isAnonymous = true, school = '' } = body || {};
  if (!content || typeof content !== 'string' || content.length > 2000) {
    return jsonResponse({ error: 'invalid_content', message: '内容不能为空且不超过2000字' }, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO wall_posts (user_id, content, tag, is_anonymous, school, created_at, likes_count, comments_count)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
  ).bind(
    user ? user.id : null,
    content,
    tag.slice(0, 20),
    isAnonymous ? 1 : 0,
    school.slice(0, 50),
    Date.now()
  ).run();

  return jsonResponse({ ok: true, id: result.meta.last_row_id });
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};
