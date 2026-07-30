/**
 * Cloudflare Pages Function
 * 路径: /api/feedback
 * GET: 管理员查看反馈列表 (?type=suggestion|bug, ?status=open|closed)
 * POST: 用户提交反馈 {type:"suggestion"|"bug", content:"..."}
 * PUT: 管理员更新反馈状态 {id:1, status:"closed", admin_note:"..."}
 */

import { getCurrentUser } from '../_lib/auth.js';

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
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const status = url.searchParams.get('status');

  let sql = 'SELECT * FROM feedback';
  const conditions = [];
  const params = [];

  if (type && (type === 'suggestion' || type === 'bug')) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (status && (status === 'open' || status === 'closed')) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT 200';

  const stmt = env.DB.prepare(sql);
  const bound = params.length ? stmt.bind(...params) : stmt;
  const result = await bound.all();

  return jsonResponse({ feedback: result.results });
};

export const onRequestPost = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { type, content } = body;
  if (!type || !['suggestion', 'bug'].includes(type)) {
    return jsonResponse({ error: 'invalid_type', message: 'type 必须是 suggestion 或 bug' }, 400);
  }
  if (!content || typeof content !== 'string' || content.trim().length < 3) {
    return jsonResponse({ error: 'invalid_content', message: '内容不能少于3个字' }, 400);
  }
  if (content.trim().length > 2000) {
    return jsonResponse({ error: 'too_long', message: '内容不能超过2000字' }, 400);
  }

  const user = await getCurrentUser(request, env);
  const now = Date.now();

  await env.DB.prepare(
    'INSERT INTO feedback (user_id, user_email, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(user ? user.id : null, user ? user.email : null, type, content.trim(), now).run();

  return jsonResponse({ success: true, message: '感谢你的反馈！' });
};

export const onRequestPut = async ({ request, env }) => {
  if (!env.DB) return jsonResponse({ error: 'missing_db' }, 500);

  const user = await getCurrentUser(request, env);
  if (!user || !user.isAdmin) {
    return jsonResponse({ error: 'forbidden', message: '需要管理员权限' }, 403);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { id, status, admin_note } = body;
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);

  await env.DB.prepare(
    'UPDATE feedback SET status = ?, admin_note = ? WHERE id = ?'
  ).bind(status || 'closed', admin_note || null, id).run();

  return jsonResponse({ success: true });
};
