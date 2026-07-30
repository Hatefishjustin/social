/**
 * Cloudflare Pages Function
 * 路径: /api/admin/users
 * GET: 管理员查看所有注册用户列表 (?page=1)
 */

import { getCurrentUser } from '../../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) {
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
      (SELECT COUNT(*) FROM askbox_questions WHERE target_id = u.id) as questions,
      (SELECT COUNT(*) FROM askbox_questions WHERE target_id = u.id AND answer_content IS NOT NULL AND answer_content != '') as answers,
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
