/**
 * Cloudflare Pages Function
 * 路径: /api/user-public
 * 方法: GET ?userId=xxx
 * 功能: 获取用户公开资料（昵称/头像/测评摘要/公开回答列表）
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? match[1] : null;
}

async function getCurrentUser(request, env) {
  if (!env.DB) return null;
  const token = parseCookie(request.headers.get('Cookie'), 'session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`
  ).bind(token).first();
  if (!row || Date.now() > row.expires_at) return null;
  return { id: row.id };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

export const onRequestGet = async ({ request, env }) => {
  const viewer = await getCurrentUser(request, env);
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return json({ error: 'missing_param' }, 400);

  const [profile, avatarRow] = await Promise.all([
    env.DB.prepare(
      `SELECT nickname, gender, age_group, bio, scores_json, is_active
       FROM profiles WHERE user_id = ?`
    ).bind(userId).first(),
    env.DB.prepare(
      `SELECT image_data FROM avatars WHERE user_id = ?`
    ).bind(userId).first()
  ]);

  if (!profile) return json({ error: 'not_found' }, 404);
  if (!profile.is_active) return json({ error: 'inactive' }, 403);

  let scores = null;
  try {
    scores = typeof profile.scores_json === 'string' ? JSON.parse(profile.scores_json) : profile.scores_json;
  } catch(e) {}

  // Get public answers (published answered questions)
  const { results: answers } = await env.DB.prepare(
    `SELECT q.id, q.content as question, q.answer_content as answer, q.answered_at, q.is_anonymous,
            p.nickname as asker_name, a.image_data as asker_avatar
     FROM askbox_questions q
     LEFT JOIN profiles p ON p.user_id = q.asker_id
     LEFT JOIN avatars a ON a.user_id = q.asker_id
     WHERE q.target_id = ? AND q.answered_at IS NOT NULL
     ORDER BY q.answered_at DESC
     LIMIT 30`
  ).bind(userId).all();

  // Check if viewer already has an unanswered question to this user
  let canAsk = true;
  if (viewer && String(viewer.id) !== userId) {
    const existing = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM askbox_questions
       WHERE target_id = ? AND asker_id = ? AND answer_content IS NULL AND created_at > ?`
    ).bind(userId, viewer.id, Date.now() - 86400000).first();
    if (existing.cnt > 0) canAsk = false;
  }

  return json({
    userId,
    nickname: profile.nickname,
    gender: profile.gender,
    ageGroup: profile.age_group,
    bio: profile.bio,
    avatar: avatarRow ? avatarRow.image_data : null,
    scoresPreview: scores ? {
      attachment: scores.attachment?.type || null,
      loveLang: scores.loveLang?.primary || null,
      mbti: scores.mbti?.type || null
    } : null,
    answers: answers || [],
    canAsk: canAsk
  });
};

export const onRequestPost = async ({ request, env }) => {
  const viewer = await getCurrentUser(request, env);
  if (!viewer) return json({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch(e) {
    return json({ error: 'invalid_body' }, 400);
  }

  const { userId, content, isAnonymous } = body || {};
  if (!userId || !content || content.trim().length < 2) {
    return json({ error: 'invalid_params', message: '问题至少2个字' }, 400);
  }
  if (content.length > 500) {
    return json({ error: 'too_long', message: '问题最多500字' }, 400);
  }

  if (userId === String(viewer.id)) {
    return json({ error: 'self_ask', message: '不能向自己提问' }, 400);
  }

  const owner = await env.DB.prepare(
    `SELECT user_id FROM profiles WHERE user_id = ? AND is_active = 1`
  ).bind(userId).first();

  if (!owner) return json({ error: 'not_found' }, 404);

  // Rate limit: max 5 questions per user per day
  const { results: recent } = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM askbox_questions
     WHERE target_id = ? AND asker_id = ? AND created_at > ?`
  ).bind(userId, viewer.id, Date.now() - 86400000).all();

  const unansweredCnt = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM askbox_questions
     WHERE target_id = ? AND asker_id = ? AND answer_content IS NULL`
  ).bind(userId, viewer.id).first();

  if (unansweredCnt.cnt >= 1) {
    return json({ error: 'rate_limit', message: '对方还未回答你的上一条提问，请耐心等待' }, 429);
  }

  const result = await env.DB.prepare(
    `INSERT INTO askbox_questions (target_id, asker_id, content, is_anonymous, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(userId, viewer.id, content.trim(), isAnonymous ? 1 : 0, Date.now()).run();

  // Notification
  await env.DB.prepare(
    `INSERT INTO notifications (user_id, type, target_type, target_id, actor_id, actor_email, content_preview, is_read, created_at)
     VALUES (?, 'askbox_question', 'askbox', ?, ?, ?, ?, 0, ?)`
  ).bind(userId, String(result.meta.last_row_id), viewer.id,
    body.isAnonymous ? '匿名用户' : '',
    content.trim().substring(0, 40),
    Date.now()
  ).run();

  return json({ ok: true, questionId: result.meta.last_row_id });
};
