/**
 * Cloudflare Pages Function
 * 路径: /chat/profile
 * 方法: POST/GET
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
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { nickname, gender, ageGroup, bio, scoresJson } = body || {};

  if (!nickname || nickname.length < 2 || nickname.length > 12) {
    return jsonResponse({ error: 'invalid_nickname', message: '昵称2-12字' }, 400);
  }
  if (!['男','女','保密'].includes(gender)) {
    return jsonResponse({ error: 'invalid_gender' }, 400);
  }
  if (!['中学生','大学生'].includes(ageGroup)) {
    return jsonResponse({ error: 'invalid_age_group' }, 400);
  }
  if (bio && bio.length > 30) {
    return jsonResponse({ error: 'bio_too_long', message: '简介最多30字' }, 400);
  }
  if (!scoresJson) {
    return jsonResponse({ error: 'missing_scores', message: '缺少测评数据' }, 400);
  }

  const avatarSeed = nickname + Date.now();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO profiles
     (user_id, nickname, gender, age_group, bio, avatar_seed, scores_json, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(user.id, nickname, gender, ageGroup, bio || '', avatarSeed, scoresJson, now, now).run();

  return jsonResponse({ ok: true });
};

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const profile = await env.DB.prepare(
    'SELECT * FROM profiles WHERE user_id = ?'
  ).bind(user.id).first();

  if (!profile) return jsonResponse({ exists: false });

  return jsonResponse({
    exists: true,
    nickname: profile.nickname,
    gender: profile.gender,
    ageGroup: profile.age_group,
    bio: profile.bio,
    avatarSeed: profile.avatar_seed,
    isActive: profile.is_active
  });
};
