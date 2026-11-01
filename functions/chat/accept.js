/**
 * Cloudflare Pages Function
 * 路径: /chat/accept
 * 方法: POST
 * 功能: 被邀请方接受或拒绝对话请求
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

  const matchId = parseInt(body.matchId);
  const action = body.action;
  if (!matchId || (action !== 'accept' && action !== 'reject')) {
    return jsonResponse({ error: 'invalid_params', message: '参数不合法' }, 400);
  }

  const match = await env.DB.prepare(
    'SELECT id, user_a, user_b, status FROM matches WHERE id = ?'
  ).bind(matchId).first();

  // 只有被邀请方可以处理，且请求必须仍在等待中
  if (!match || match.user_b !== user.id || match.status !== 'pending') {
    return jsonResponse({ error: 'forbidden', message: '该请求不存在或已处理' }, 403);
  }

  const now = Date.now();

  if (action === 'accept') {
    await env.DB.prepare(
      "UPDATE matches SET status = 'accepted' WHERE id = ?"
    ).bind(matchId).run();

    await env.DB.prepare(
      `INSERT INTO messages (match_id, sender_id, content, is_system, created_at)
       VALUES (?, NULL, '对方接受了你的对话请求，现在可以开始聊天了。', 1, ?)`
    ).bind(matchId, now).run();

    await env.DB.prepare(
      `INSERT INTO notifications (user_id, type, target_type, target_id, actor_email, content_preview, is_read, created_at)
       VALUES (?, 'chat_message', 'chat', ?, ?, '对方接受了你的对话请求', 0, ?)`
    ).bind(match.user_a, String(matchId), user.email, now).run();

    return jsonResponse({ ok: true, status: 'accepted', matchId });
  }

  await env.DB.prepare(
    "UPDATE matches SET status = 'rejected' WHERE id = ?"
  ).bind(matchId).run();

  await env.DB.prepare(
    `INSERT INTO notifications (user_id, type, target_type, target_id, actor_email, content_preview, is_read, created_at)
     VALUES (?, 'chat_request_rejected', 'chat', ?, ?, '对方拒绝了你的对话请求', 0, ?)`
  ).bind(match.user_a, String(matchId), user.email, now).run();

  return jsonResponse({ ok: true, status: 'rejected', matchId });
};
