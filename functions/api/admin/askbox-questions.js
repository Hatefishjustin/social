/**
 * Cloudflare Pages Function
 * 路径: /api/admin/askbox-questions
 * 方法: GET
 * S09 提问箱问题列表（管理员）
 * 返回: 提问者 / 目标用户 / 问题内容 / 时间 / 状态（是否回答/是否公开）
 * 兼容迁移前/后状态（S09 未执行时同样可用，仅依赖现有字段）
 */
import { getCurrentUser } from '../../_lib/auth.js';

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
  const targetId = url.searchParams.get('target') || '';
  const status = url.searchParams.get('status') || ''; // answered / unanswered / all
  const offset = (page - 1) * PAGE_SIZE;

  const db = env.DB;
  const where = [];
  const params = [];

  if (targetId) {
    where.push('q.target_id = ?');
    params.push(targetId);
  }
  if (status === 'answered') {
    where.push('q.answer_content IS NOT NULL AND q.answer_content != ?');
    params.push('');
  } else if (status === 'unanswered') {
    where.push('(q.answer_content IS NULL OR q.answer_content = ?)');
    params.push('');
  }

  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const sql = `
    SELECT
      q.id, q.content, q.is_anonymous, q.created_at, q.answered_at,
      q.answer_visibility, q.answer_content,
      q.asker_id, q.target_id,
      asker.email as asker_email,
      COALESCE(asker_p.nickname, asker.display_name, '') as asker_name,
      target.email as target_email,
      COALESCE(target_p.nickname, target.display_name, '') as target_name
    FROM askbox_questions q
    LEFT JOIN users asker ON asker.id = q.asker_id
    LEFT JOIN profiles asker_p ON asker_p.user_id = q.asker_id
    LEFT JOIN users target ON target.id = q.target_id
    LEFT JOIN profiles target_p ON target_p.user_id = q.target_id
    ${whereSql}
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const countSql = `SELECT COUNT(*) as total FROM askbox_questions q ${whereSql}`;

  const { results } = await db.prepare(sql).bind(...params, PAGE_SIZE, offset).all();
  const countRow = await db.prepare(countSql).bind(...params).first();

  const questions = (results || []).map((q) => ({
    id: q.id,
    question_id: q.id,
    asker_id: q.asker_id,
    asker_email: q.asker_email || '',
    asker_name: q.asker_name || (q.is_anonymous ? '匿名' : (q.asker_email || '匿名')),
    target_id: q.target_id,
    target_email: q.target_email || '',
    target_name: q.target_name || q.target_email || '',
    content: q.content,
    is_anonymous: !!q.is_anonymous,
    created_at: q.created_at,
    answered_at: q.answered_at,
    is_answered: !!(q.answer_content && q.answer_content.trim()),
    answer_visibility: q.answer_visibility || 'public',
    answer_content: q.answer_content || '',
  }));

  return jsonResponse({
    questions,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total: countRow?.total || 0,
      totalPages: Math.ceil((countRow?.total || 0) / PAGE_SIZE),
    },
    generatedAt: Date.now(),
  });
};