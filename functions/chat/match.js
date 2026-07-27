/**
 * Cloudflare Pages Function
 * 路径: /chat/match
 * 方法: POST
 * 功能: 申请匹配（后门：路由到客服）
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

function calculateMatchScore(scoresA, scoresB) {
  const sA = typeof scoresA === 'string' ? JSON.parse(scoresA) : scoresA;
  const sB = typeof scoresB === 'string' ? JSON.parse(scoresB) : scoresB;
  const attachMap = { '安全型': 4, '焦虑型': 3, '回避型': 2, '恐惧型': 1 };
  const attachA = attachMap[sA.attachment?.type] || 3;
  const attachB = attachMap[sB.attachment?.type] || 3;
  const attachScore = attachA === attachB ? 85 : (attachA + attachB === 5 ? 95 : 75);
  const big5Keys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  let big5Diff = 0;
  big5Keys.forEach(k => {
    const a = sA.big5?.[k] || 50;
    const b = sB.big5?.[k] || 50;
    big5Diff += Math.abs(a - b);
  });
  const big5Score = Math.max(60, 100 - big5Diff / 5);
  const loveA = sA.loveLang?.primary || '';
  const loveB = sB.loveLang?.primary || '';
  const loveScore = loveA === loveB ? 90 : 75;
  const valA = sA.values?.commitment || 50;
  const valB = sB.values?.commitment || 50;
  const valScore = 100 - Math.abs(valA - valB) / 2;
  return Math.round(attachScore * 0.35 + big5Score * 0.25 + loveScore * 0.20 + valScore * 0.20);
}

function generateMatchReason(profileA, profileB, score) {
  const sA = typeof profileA.scores_json === 'string' ? JSON.parse(profileA.scores_json) : profileA.scores_json;
  const sB = typeof profileB.scores_json === 'string' ? JSON.parse(profileB.scores_json) : profileB.scores_json;
  const attachA = sA.attachment?.type || '安全型';
  const attachB = sB.attachment?.type || '安全型';
  const loveA = sA.loveLang?.primary || '肯定的言辞';
  const loveB = sB.loveLang?.primary || '服务的行动';
  const reasons = [
    `你们的依恋风格形成独特张力：${attachA}的你需要${loveA.includes('肯定') ? '高频情感确认' : '稳定的陪伴感'}，而对方的${attachB}倾向恰好能在关系稳定后提供你需要的空间感。`,
    `在大五人格维度上，你们的开放性和尽责性呈现出${score > 85 ? '高度' : '较好的'}互补，这种组合在深度对话中容易产生认知层面的共鸣。`,
    `你们的主要爱之语分别是「${loveA}」和「${loveB}」，这种组合意味着你们在表达爱意时会自然形成"给予-接收"的良性循环。`,
    `价值观匹配度显示，你们对长期承诺的期待处于相近区间，这是关系稳定的重要基础指标。`
  ];
  return reasons[Math.floor(Math.random() * reasons.length)];
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body', message: '请求体不是合法 JSON' }, 400);
  }

  const { targetUserId } = body || {};

  const myProfile = await env.DB.prepare(
    'SELECT * FROM profiles WHERE user_id = ?'
  ).bind(user.id).first();

  if (!myProfile) {
    return jsonResponse({ error: 'profile_incomplete', message: '请先完善个人资料' }, 403);
  }

  const existingMatch = await env.DB.prepare(
    `SELECT id FROM matches
     WHERE user_a = ? AND status IN ('pending', 'accepted')
     LIMIT 1`
  ).bind(user.id).first();

  if (existingMatch) {
    return jsonResponse({ error: 'existing_match', message: '你已有一个进行中的匹配' }, 409);
  }

  let fakeTarget = null;
  if (targetUserId) {
    fakeTarget = await env.DB.prepare(
      'SELECT * FROM profiles WHERE user_id = ? AND is_active = 1 AND user_id != ?'
    ).bind(targetUserId, user.id).first();
  }

  if (!fakeTarget) {
    fakeTarget = await env.DB.prepare(
      `SELECT * FROM profiles
       WHERE is_active = 1 AND user_id != ? AND age_group = ?
       ORDER BY RANDOM() LIMIT 1`
    ).bind(user.id, myProfile.age_group).first();
  }

  let staff = await env.DB.prepare(
    `SELECT s.user_id, COUNT(m.id) as load
     FROM staff_accounts s
     LEFT JOIN matches m ON m.user_b = s.user_id AND m.status = 'accepted'
     WHERE s.is_online = 1
     GROUP BY s.user_id
     ORDER BY load ASC, RANDOM()
     LIMIT 1`
  ).first();

  if (!staff) {
    staff = await env.DB.prepare(
      'SELECT user_id FROM staff_accounts LIMIT 1'
    ).first();
  }

  if (!staff) {
    return jsonResponse({ error: 'no_staff', message: '暂时无法匹配，请稍后再试' }, 503);
  }

  const matchScore = fakeTarget
    ? calculateMatchScore(myProfile.scores_json, fakeTarget.scores_json)
    : 88 + Math.floor(Math.random() * 10);

  const matchReason = fakeTarget
    ? generateMatchReason(myProfile, fakeTarget, matchScore)
    : '系统检测到你们在多个心理维度上存在深层共鸣，这种匹配模式在长期关系中具有较高的稳定性潜力。';

  const result = await env.DB.prepare(
    `INSERT INTO matches (user_a, user_b, match_score, match_reason, status, is_shadow, created_at)
     VALUES (?, ?, ?, ?, 'accepted', 1, ?)`
  ).bind(user.id, staff.user_id, matchScore, matchReason, Date.now()).run();

  const matchId = result.meta.last_row_id;

  await env.DB.prepare(
    `INSERT INTO messages (match_id, sender_id, content, created_at)
     VALUES (?, 0, ?, ?)`
  ).bind(matchId, '你们已匹配成功！可以开始聊天了。平台提示：请保持友善交流，如遇不适请随时举报。', Date.now()).run();

  const responseProfile = fakeTarget ? {
    userId: fakeTarget.user_id,
    nickname: fakeTarget.nickname,
    gender: fakeTarget.gender,
    ageGroup: fakeTarget.age_group,
    bio: fakeTarget.bio,
    avatarSeed: fakeTarget.avatar_seed,
    matchScore,
    matchReason
  } : {
    userId: staff.user_id,
    nickname: '用户' + (Math.floor(Math.random() * 9000) + 1000),
    gender: '保密',
    ageGroup: myProfile.age_group,
    bio: '一个喜欢探索内心世界的人',
    avatarSeed: 'default',
    matchScore,
    matchReason
  };

  return jsonResponse({
    ok: true,
    matchId,
    partner: responseProfile
  });
};

export const onRequestGet = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.match_score, m.match_reason, m.status, m.created_at,
            p.nickname, p.gender, p.age_group, p.bio, p.avatar_seed
     FROM matches m
     JOIN profiles p ON p.user_id = m.user_b
     WHERE m.user_a = ?
     ORDER BY m.created_at DESC
     LIMIT 20`
  ).bind(user.id).all();

  return jsonResponse({ matches: results || [] });
};
