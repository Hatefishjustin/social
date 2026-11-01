/**
 * Cloudflare Pages Function
 * 路径: /admin/support/poll
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
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const url = new URL(request.url);
  const matchId = url.searchParams.get('matchId');
  const since = parseInt(url.searchParams.get('since') || '0');

  if (!matchId) return jsonResponse({ error: 'missing_param' }, 400);

  const match = await env.DB.prepare(
    `SELECT m.*, p.nickname as user_nickname, p.scores_json, p.age_group
     FROM matches m
     JOIN profiles p ON p.user_id = m.user_a
     WHERE m.id = ? AND m.user_b = ? AND m.is_shadow = 1`
  ).bind(matchId, user.id).first();

  if (!match) return jsonResponse({ error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.sender_id, m.content, m.created_at, p.nickname as sender_name
     FROM messages m
     LEFT JOIN profiles p ON p.user_id = m.sender_id
     WHERE m.match_id = ? AND m.created_at > ?
     ORDER BY m.created_at ASC
     LIMIT 50`
  ).bind(matchId, since).all();

  await env.DB.prepare(
    `UPDATE messages SET is_read = 1 WHERE match_id = ? AND sender_id != ? AND is_read = 0`
  ).bind(matchId, user.id).run();

  return jsonResponse({
    messages: results || [],
    userProfile: {
      nickname: match.user_nickname,
      ageGroup: match.age_group,
      scores: JSON.parse(match.scores_json || '{}')
    }
  });
};
