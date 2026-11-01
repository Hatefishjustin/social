/**
 * Cloudflare Pages Function
 * 路径: /chat/poll
 * 方法: GET
 */

import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const matchId = url.searchParams.get('matchId');
  const since = parseInt(url.searchParams.get('since') || '0');

  if (!matchId) return jsonResponse({ error: 'missing_param' }, 400);

  const match = await env.DB.prepare(
    `SELECT * FROM matches
     WHERE id = ? AND (user_a = ? OR user_b = ?) AND status = 'accepted'`
  ).bind(matchId, user.id, user.id).first();

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

  const partnerId = match.user_a === user.id ? match.user_b : match.user_a;
  const partner = await env.DB.prepare(
    `SELECT nickname, avatar_seed FROM profiles WHERE user_id = ?`
  ).bind(partnerId).first();

  return jsonResponse({
    messages: results || [],
    partner: partner || { nickname: '对方', avatar_seed: 'default' },
    matchStatus: match.status
  });
};
