/**
 * Cloudflare Pages Function
 * 路径: /chat/start
 * 方法: POST
 * 功能: 定向私信开聊，复用已有会话，is_shadow=0
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
    `SELECT sessions.expires_at as expires_at, users.id as user_id, users.email as email
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token = ?`
  ).bind(sessionToken).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.user_id, email: row.email };
}

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

  const targetUserId = parseInt(body.targetUserId);
  if (!targetUserId || targetUserId === user.id) {
    return jsonResponse({ error: 'invalid_params', message: '无效的目标用户' }, 400);
  }

  // 检查目标用户是否存在且活跃
  const target = await env.DB.prepare(
    'SELECT user_id FROM profiles WHERE user_id = ? AND is_active = 1'
  ).bind(targetUserId).first();
  if (!target) {
    return jsonResponse({ error: 'not_found', message: '目标用户不存在' }, 404);
  }

  // 查已有 accepted 会话
  const existing = await env.DB.prepare(
    `SELECT id FROM matches
     WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
     AND status = 'accepted'
     LIMIT 1`
  ).bind(user.id, targetUserId, targetUserId, user.id).first();

  if (existing) {
    return jsonResponse({ ok: true, matchId: existing.id, reused: true });
  }

  // 新建会话
  const result = await env.DB.prepare(
    `INSERT INTO matches (user_a, user_b, match_score, match_reason, status, is_shadow, created_at)
     VALUES (?, ?, 85, '对方通过个人主页向你发起了对话', 'accepted', 0, ?)`
  ).bind(user.id, targetUserId, Date.now()).run();

  const matchId = result.meta.last_row_id;

  // 系统消息
  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, is_system, created_at)
     VALUES (?, NULL, '对方通过个人主页向你发起了对话。平台提示：请保持友善交流。', 1, ?)`
  ).bind(matchId, Date.now()).run();

  // 通知对方
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, type, target_type, target_id, actor_email, content_preview, is_read, created_at)
     VALUES (?, 'chat_message', 'chat', ?, ?, '对方发起了对话', 0, ?)`
  ).bind(targetUserId, String(matchId), user.email, Date.now()).run();

  return jsonResponse({ ok: true, matchId, reused: false });
};
