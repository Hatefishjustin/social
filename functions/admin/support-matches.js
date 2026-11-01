/**
 * Cloudflare Pages Function
 * 路径: /admin/support/matches
 * 方法: GET
 */

import { getCurrentUser } from '../_lib/auth.js';

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

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  if (!await isStaff(user.id, env)) {
    return jsonResponse({ error: 'forbidden', message: '非客服账号' }, 403);
  }

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.user_a, m.match_score, m.match_reason, m.status, m.created_at,
            p.nickname as user_nickname, p.gender, p.age_group, p.scores_json,
            (SELECT COUNT(*) FROM messages WHERE match_id = m.id AND sender_id = m.user_a AND is_read = 0) as unread_count
     FROM matches m
     JOIN profiles p ON p.user_id = m.user_a
     WHERE m.user_b = ? AND m.is_shadow = 1 AND m.status = 'accepted'
     ORDER BY unread_count DESC, m.created_at DESC`
  ).bind(user.id).all();

  return jsonResponse({ matches: results || [] });
};
