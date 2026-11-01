/**
 * Cloudflare Pages Function
 * 路径: /chat/close
 * 方法: POST
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
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { matchId } = body || {};
  if (!matchId) return jsonResponse({ error: 'missing_param' }, 400);

  const match = await env.DB.prepare(
    `SELECT * FROM matches
     WHERE id = ? AND (user_a = ? OR user_b = ?) AND status = 'accepted'`
  ).bind(matchId, user.id, user.id).first();

  if (!match) return jsonResponse({ error: 'not_found' }, 404);

  await env.DB.prepare(
    `UPDATE matches SET status = 'closed', closed_at = ? WHERE id = ?`
  ).bind(Date.now(), matchId).run();

  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, is_system, created_at)
     VALUES (?, NULL, ?, 1, ?)`
  ).bind(matchId, '【系统】对方已结束对话。你可以随时开始新的匹配。', Date.now()).run();

  return jsonResponse({ ok: true });
};
