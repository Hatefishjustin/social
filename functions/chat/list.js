/**
 * Cloudflare Pages Function
 * 路径: /chat/list
 * 方法: GET
 * 功能: 会话列表 + 待处理的对话请求（单次查询，避免 N+1）
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
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  const { results: rows } = await env.DB.prepare(
    `SELECT m.id, m.match_score, m.is_shadow, m.created_at, m.user_a, m.user_b,
            p.nickname, p.gender, p.age_group, p.bio, p.avatar_seed,
            lm.content AS last_content, lm.created_at AS last_time,
            lm.sender_id AS last_sender_id, lm.is_system AS last_is_system,
            (SELECT COUNT(*) FROM messages um
             WHERE um.match_id = m.id AND um.sender_id != ? AND um.sender_id IS NOT NULL
               AND um.is_read = 0 AND um.is_system = 0) AS unread
     FROM matches m
     LEFT JOIN profiles p ON p.user_id = CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END
     LEFT JOIN messages lm ON lm.id = (
       SELECT x.id FROM messages x
       WHERE x.match_id = m.id
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT 1
     )
     WHERE (m.user_a = ? OR m.user_b = ?) AND m.status = 'accepted'
     ORDER BY COALESCE(lm.created_at, m.created_at) DESC
     LIMIT 50`
  ).bind(user.id, user.id, user.id, user.id).all();

  let totalUnread = 0;
  const conversations = (rows || []).map((m) => {
    const partnerId = m.user_a === user.id ? m.user_b : m.user_a;
    const unread = m.unread || 0;
    totalUnread += unread;

    return {
      matchId: m.id,
      matchScore: m.match_score,
      isShadow: !!m.is_shadow,
      partner: {
        userId: partnerId,
        nickname: m.nickname || '匿名用户',
        gender: m.gender,
        ageGroup: m.age_group,
        bio: m.bio,
        avatarSeed: m.avatar_seed,
      },
      lastMessage: m.last_time ? {
        content: m.last_content,
        time: m.last_time,
        isMine: m.last_sender_id === user.id,
        isSystem: !!m.last_is_system,
      } : null,
      unread,
    };
  });

  const { results: requestRows } = await env.DB.prepare(
    `SELECT m.id, m.match_score, m.created_at, m.user_a,
            p.nickname, p.gender, p.age_group, p.avatar_seed
     FROM matches m
     LEFT JOIN profiles p ON p.user_id = m.user_a
     WHERE m.user_b = ? AND m.status = 'pending' AND m.is_shadow = 0
     ORDER BY m.created_at DESC
     LIMIT 20`
  ).bind(user.id).all();

  const requests = (requestRows || []).map((m) => ({
    matchId: m.id,
    matchScore: m.match_score,
    createdAt: m.created_at,
    from: {
      userId: m.user_a,
      nickname: m.nickname || '匿名用户',
      gender: m.gender,
      ageGroup: m.age_group,
      avatarSeed: m.avatar_seed,
    },
  }));

  return jsonResponse({ conversations, totalUnread, requests });
};
