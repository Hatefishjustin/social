/**
 * Cloudflare Pages Function
 * 路径: /admin/support/send
 * 方法: POST
 */

import { getCurrentUser } from '../../_lib/auth.js';

async function isStaff(userId, env) {
  const staff = await env.DB.prepare(
    'SELECT * FROM staff_accounts WHERE user_id = ?'
  ).bind(userId).first();
  return !!staff;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  if (!await isStaff(user.id, env)) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { matchId, content } = body || {};
  if (!matchId || !content || content.length > 500) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const match = await env.DB.prepare(
    `SELECT * FROM matches WHERE id = ? AND user_b = ? AND is_shadow = 1`
  ).bind(matchId, user.id).first();

  if (!match) return jsonResponse({ error: 'not_found' }, 404);

  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(matchId, user.id, content, Date.now()).run();

  return jsonResponse({ ok: true });
};
