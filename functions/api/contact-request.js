/**
 * Cloudflare Pages Function
 * 路径: /api/contact-request
 * POST: {postId, message} - 提交"我想认识TA"请求
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getUser(request, env) {
  if (!env.DB) return null;
  const token = parseCookie(request.headers.get('Cookie'), 'session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`
  ).bind(token).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.id, email: row.email };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'not_logged_in', message: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return json({ error: 'invalid_body' }, 400);
  }

  const { postId, message } = body || {};
  if (!postId || !message || message.trim().length < 2 || message.length > 500) {
    return json({ error: 'invalid_params', message: '请填写有效留言（2-500字）' });
  }

  // 检查是否已经发过请求
  const existing = await env.DB.prepare(
    `SELECT id FROM contact_requests WHERE post_id = ? AND from_user_id = ? AND created_at > ?`
  ).bind(postId, user.id, Date.now() - 3600 * 1000).first(); // 1小时内不能重复
  if (existing) {
    return json({ error: 'rate_limited', message: '你已发送过请求，请稍后再试' });
  }

  // 获取发帖人信息
  const post = await env.DB.prepare(
    `SELECT id, user_id, school FROM wall_posts WHERE id = ?`
  ).bind(postId).first();

  if (!post) return json({ error: 'not_found', message: '帖子不存在' }, 404);

  // 不能给自己发
  if (post.user_id === user.id) {
    return json({ error: 'self', message: '不能向自己的帖子发请求' });
  }

  // 写入 contact_requests
  await env.DB.prepare(
    `INSERT INTO contact_requests (post_id, from_user_id, to_user_id, message, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(postId, user.id, post.user_id, message.trim(), Date.now()).run();

  // 给对方发通知
  try {
    await env.DB.prepare(
      `INSERT INTO notifications (user_id, type, actor_id, actor_email, content_preview, is_read, created_at)
       VALUES (?, 'contact_request', ?, ?, ?, 0, ?)`
    ).bind(post.user_id, user.id, user.email, '有人想认识你！' + message.trim().substring(0, 40), Date.now()).run();
  } catch(e) { /* 通知非致命错误 */ }

  return json({ ok: true });
};
