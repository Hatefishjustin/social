/**
 * Cloudflare Pages Function
 * 路径: /api/admin/askbox-list
 * 方法: GET
 * S09 提问箱列表（管理员）
 * 返回: 用户 / 访问量 / 问题数 / 回答数 / 回答率
 * 兼容迁移前/后状态（S09 未执行时 askbox_visits 表不存在，访问量降级为 0）
 */
import { getCurrentUser } from '../../_lib/auth.js';
import { hasTable } from '../../_lib/schema.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const PAGE_SIZE = 50;

export const onRequestGet = async ({ request, env }) => {
  if (!env || !env.DB) return jsonResponse({ error: 'missing_db', message: '数据库未配置' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) return jsonResponse({ error: 'forbidden', message: '无权限' }, 403);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  const db = env.DB;
  const hasAskboxVisits = await hasTable(env, 'askbox_visits');

  // 按用户聚合提问箱（以 target_id 为用户身份）
  const sql = `
    SELECT
      u.id as user_id,
      u.email as user_email,
      COALESCE(p.nickname, u.display_name, u.email) as display_name,
      COUNT(q.id) as question_count,
      SUM(CASE WHEN q.answer_content IS NOT NULL AND q.answer_content != '' THEN 1 ELSE 0 END) as answer_count,
      MAX(q.created_at) as last_question_at
      ${hasAskboxVisits ? ', (SELECT COUNT(*) FROM askbox_visits av2 WHERE av2.target_user_id = u.id) as visit_count' : ''}
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN askbox_questions q ON q.target_id = u.id
    GROUP BY u.id
    HAVING question_count > 0 OR ${hasAskboxVisits ? 'visit_count > 0' : '0 > 0'}
    ORDER BY last_question_at DESC
    LIMIT ? OFFSET ?
  `;

  let { results } = await db.prepare(sql).bind(PAGE_SIZE, offset).all();

  // 无 askbox_visits 表时补 visit_count = 0
  if (!hasAskboxVisits) {
    results = (results || []).map((r) => ({ ...r, visit_count: 0 }));
  }

  const countRow = await db.prepare(
    `SELECT COUNT(DISTINCT u.id) as total
     FROM users u
     WHERE EXISTS (SELECT 1 FROM askbox_questions q WHERE q.target_id = u.id)`
  ).first();

  const questions = (results || []).map((r) => {
    const qc = r.question_count || 0;
    const ac = r.answer_count || 0;
    return {
      user_id: r.user_id,
      email: r.user_email,
      display_name: r.display_name || r.user_email || '',
      visit_count: r.visit_count || 0,
      question_count: qc,
      answer_count: ac,
      answer_rate: qc > 0 ? Math.round((ac / qc) * 100) / 100 : 0,
      last_question_at: r.last_question_at || null,
    };
  });

  return jsonResponse({
    askboxes: questions,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: countRow?.total || 0,
      totalPages: Math.ceil((countRow?.total || 0) / PAGE_SIZE),
    },
    visitMode: hasAskboxVisits ? 'askbox_visits' : 'degraded',
    generatedAt: Date.now(),
  });
};