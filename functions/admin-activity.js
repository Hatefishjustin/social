/**
 * 路径: /functions/admin-activity.js
 * 路由: /admin-activity
 * 后台活动日志查询 API
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

const PAGE_SIZE = 30;

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const action = url.searchParams.get('action') || '';
  const offset = (page - 1) * PAGE_SIZE;

  let where = '';
  const params = [];

  if (action) {
    where = ' WHERE action = ?';
    params.push(action);
  }

  const sql = `SELECT id, user_id, user_email, action, target_type, target_id,
                      content, ip, user_agent, country, city, is_anonymous, created_at
               FROM activity_log${where}
               ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const countSql = `SELECT COUNT(*) as total FROM activity_log${where}`;

  const { results } = await env.DB.prepare(sql).bind(...params, PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare(countSql).bind(...params).first();

  return jsonResponse({
    activities: results,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: countRow?.total || 0,
      totalPages: Math.ceil((countRow?.total || 0) / PAGE_SIZE),
    },
  });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
