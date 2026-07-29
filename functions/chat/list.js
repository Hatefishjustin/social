/**
 * Cloudflare Pages Function
 * 路径: /chat/list
 * 方法: GET
 * 功能: 会话列表（含随机匹配+私信），带未读数、最后一条消息
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const sessionToken = parseCookie(request.headers.get('Cookie'), 'session');
  if (!sessionToken) return null;
  const row = await env.DB.prepare(
    `SELECT sessions.expires_at as expires_at, users.id as user_id
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id };
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

  // 查所有 accepted 会话（用户可能是 user_a 或 user_b）
  const { results: matches } = await env.DB.prepare(
    `SELECT m.id, m.match_score, m.match_reason, m.status, m.is_shadow,
            m.created_at, m.user_a, m.user_b
     FROM matches m
     WHERE (m.user_a = ? OR m.user_b = ?) AND m.status = 'accepted'
     ORDER BY m.created_at DESC
     LIMIT 50`
  ).bind(user.id, user.id).all();

  if (!matches || matches.length === 0) {
    return jsonResponse({ conversations: [], totalUnread: 0 });
  }

  // 批量获取 partner 信息、最后一条消息、未读数
  const conversations = [];
  let totalUnread = 0;

  for (const m of matches) {
    const partnerId = m.user_a === user.id ? m.user_b : m.user_a;

    // partner 信息
    const partner = await env.DB.prepare(
      `SELECT nickname, gender, age_group, bio, avatar_seed
       FROM profiles WHERE user_id = ?`
    ).bind(partnerId).first();

    // 最后一条消息
    const lastMsg = await env.DB.prepare(
      `SELECT content, created_at, sender_id, is_system
       FROM messages
       WHERE match_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(m.id).first();

    // 未读数（对方发的、未读的）
    const unreadRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt
       FROM messages
       WHERE match_id = ? AND sender_id != ? AND sender_id IS NOT NULL
       AND is_read = 0 AND is_system = 0`
    ).bind(m.id, user.id).first();

    const unread = unreadRow ? unreadRow.cnt : 0;
    totalUnread += unread;

    conversations.push({
      matchId: m.id,
      matchScore: m.match_score,
      isShadow: m.is_shadow === 1,
      partner: partner ? {
        userId: partnerId,
        nickname: partner.nickname || '匿名用户',
        gender: partner.gender,
        ageGroup: partner.age_group,
        bio: partner.bio,
        avatarSeed: partner.avatar_seed
      } : { userId: partnerId, nickname: '已注销用户' },
      lastMessage: lastMsg ? {
        content: lastMsg.content,
        time: lastMsg.created_at,
        isMine: lastMsg.sender_id === user.id,
        isSystem: lastMsg.is_system === 1
      } : null,
      unread
    });
  }

  // 按最后消息时间排序（有消息的排在没消息的前面）
  conversations.sort((a, b) => {
    const ta = a.lastMessage ? a.lastMessage.time : a.matchId;
    const tb = b.lastMessage ? b.lastMessage.time : b.matchId;
    return tb - ta;
  });

  return jsonResponse({ conversations, totalUnread });
};
