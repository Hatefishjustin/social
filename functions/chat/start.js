/**
 * Cloudflare Pages Function
 * 路径: /chat/start
 * 方法: POST
 * 功能: 定向发起对话请求（需对方接受后才建立会话），is_shadow=0
 */
import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体不是合法 JSON' }, 400);
  }

  const targetUserId = parseInt(body.targetUserId);
  if (!targetUserId || targetUserId === user.id) {
    return jsonResponse({ error: 'invalid_params', message: '无效的目标用户' }, 400);
  }

  // 检查目标用户是否存在且活跃
  const target = await env.DB.prepare(
    'SELECT user_id FROM profiles WHERE user_id = ? AND is_active = 1'
  ).bind(targetUserId).first();
  if (!target) {
    return jsonResponse({ error: 'not_found', message: '目标用户不存在' }, 404);
  }

  // 已有 accepted 会话则直接复用
  const existing = await env.DB.prepare(
    `SELECT id FROM matches
     WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
     AND status = 'accepted'
     LIMIT 1`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();

  if (existing) {
    return jsonResponse({ ok: true, matchId: existing.id, reused: true });
  }

  // 已有待处理请求：不重复插入，告知前端等待对方回应
  const pending = await env.DB.prepare(
    `SELECT id FROM matches
     WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
     AND status = 'pending'
     LIMIT 1`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();

  if (pending) {
    return jsonResponse({ ok: true, matchId: pending.id, pending: true, reused: true });
  }

  // 新建对话请求：必须由对方接受后才可聊天
  const result = await env.DB.prepare(
    `INSERT INTO matches (user_a, user_b, match_score, match_reason, status, is_shadow, created_at)
     VALUES (?, ?, 85, '对方通过个人主页向你发起了对话请求', 'pending', 0, ?)`
  ).bind(user.id, targetUserId, Date.now()).run();

  const matchId = result.meta.last_row_id;

  // 通知对方（不写系统消息，接受后再写）
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, type, target_type, target_id, actor_email, content_preview, is_read, created_at)
     VALUES (?, 'chat_request', 'chat', ?, ?, '对方请求与你开始对话', 0, ?)`
  ).bind(targetUserId, String(matchId), user.email, Date.now()).run();

  return jsonResponse({ ok: true, matchId, pending: true, reused: false });
};
