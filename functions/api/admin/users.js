/**
 * Cloudflare Pages Function
 * 路径: /api/admin/users
 * GET: 管理员查看所有注册用户列表 (?page=1)
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
    `SELECT sessions.expires_at, users.id, users.email, users.is_admin
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return row;
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.is_admin) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const PAGE_SIZE = 50;
  const offset = (page - 1) * PAGE_SIZE;

  const db = env.DB;

  // Get users with their activity counts
  const users = await db.prepare(`
    SELECT 
      u.id, u.email, u.display_name, u.avatar_url, u.is_admin, u.created_at,
      (SELECT COUNT(*) FROM wall_posts WHERE user_id = u.id) as wall_posts,
      (SELECT COUNT(*) FROM askbox_questions WHERE user_id = u.id) as questions,
      (SELECT COUNT(*) FROM askbox_questions WHERE user_id = u.id AND answer_content IS NOT NULL AND answer_content != '') as answers,
      (SELECT COUNT(*) FROM activity_log WHERE user_id = u.id AND is_anonymous = 1) as anonymous_actions,
      (SELECT COUNT(*) FROM page_views WHERE user_id = u.id) as page_views
    FROM users u
    ORDER BY u.id ASC
    LIMIT ? OFFSET ?
  `).bind(PAGE_SIZE, offset).all();

  const countRow = await db.prepare('SELECT COUNT(*) as total FROM users').first();
  const total = countRow.total;

  return jsonResponse({
    users: users.results,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  });
};
