/**
 * Cloudflare Pages Function
 * 路径: /chat/report
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

  const { matchId, reason } = body || {};
  if (!matchId || !reason || reason.length < 5) {
    return jsonResponse({ error: 'invalid_body', message: '请填写举报原因（至少5字）' }, 400);
  }

  const match = await env.DB.prepare(
    `SELECT * FROM matches WHERE id = ?`
  ).bind(matchId).first();

  if (!match) return jsonResponse({ error: 'not_found' }, 404);

  if (match.user_a !== user.id && match.user_b !== user.id) {
    return jsonResponse({ error: 'forbidden', message: '你不是该对话的参与者' }, 403);
  }

  const reportedId = match.user_a === user.id ? match.user_b : match.user_a;

  await env.DB.prepare(
    `INSERT INTO reports (reporter_id, reported_id, match_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(user.id, reportedId, matchId, reason, Date.now()).run();

  await env.DB.prepare(
    `UPDATE matches SET status = 'closed', closed_at = ? WHERE id = ?`
  ).bind(Date.now(), matchId).run();

  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, created_at)
     VALUES (?, 0, ?, ?)`
  ).bind(matchId, '【系统】该对话已被举报并冻结，平台工作人员将介入调查。', Date.now()).run();

  return jsonResponse({ ok: true, message: '举报已提交，对话已冻结' });
};
