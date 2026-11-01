/**
 * Cloudflare Pages Function
 * 路径: /chat/mark_read
 * 方法: POST
 * 功能: 将指定会话中对方发来的消息标记为已读
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
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const matchId = parseInt(body.matchId);
  if (!matchId) return jsonResponse({ error: 'missing_param' }, 400);

  // 必须先确认该会话属于当前用户，防止越权标记他人会话。
  const match = await env.DB.prepare(
    `SELECT id FROM matches
     WHERE id = ? AND status = 'accepted' AND (user_a = ? OR user_b = ?)`
  ).bind(matchId, user.id, user.id).first();
  if (!match) return jsonResponse({ error: 'forbidden' }, 403);

  await env.DB.prepare(
    `UPDATE messages SET is_read = 1
     WHERE match_id = ? AND sender_id != ? AND sender_id IS NOT NULL AND is_read = 0`
  ).bind(matchId, user.id).run();

  return jsonResponse({ ok: true });
};
