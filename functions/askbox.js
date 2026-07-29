/**
 * 路径: /functions/askbox.js
 * 路由: /askbox
 * v2: 增加活动日志，记录 IP / 设备 / 地区
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
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function getRequestMeta(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '',
    ua: (request.headers.get('User-Agent') || '').slice(0, 500),
    country: (request.cf || {}).country || '',
    city: (request.cf || {}).city || '',
  };
}

async function logActivity(env, meta, user, action, targetType, targetId, content, isAnonymous) {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log (user_id, user_email, action, target_type, target_id, content, ip, user_agent, country, city, is_anonymous, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user ? user.id : null,
      user ? user.email : null,
      action,
      targetType,
      targetId || null,
      (content || '').slice(0, 500),
      meta.ip,
      meta.ua,
      meta.country,
      meta.city,
      isAnonymous ? 1 : 0,
      Date.now()
    ).run();
  } catch (e) {
    console.error('activity_log insert failed:', e.message);
  }
}

const PAGE_SIZE = 20;

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const targetId = url.searchParams.get('targetId');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  let sql, countSql, params;
  if (targetId) {
    sql = `SELECT q.id, q.asker_id, q.content, q.is_anonymous, q.created_at, q.answered_at, q.answer_content,
                  p.nickname as asker_name, a.image_data as asker_avatar
           FROM askbox_questions q
           LEFT JOIN profiles p ON p.user_id = q.asker_id
           LEFT JOIN avatars a ON a.user_id = q.asker_id
           WHERE q.target_id = ? ORDER BY q.created_at DESC LIMIT ? OFFSET ?`;
    countSql = `SELECT COUNT(*) as total FROM askbox_questions WHERE target_id = ?`;
    params = [targetId];
  } else {
    sql = `SELECT q.id, q.asker_id, q.content, q.is_anonymous, q.created_at, q.answered_at, q.answer_content,
                  p.nickname as asker_name, a.image_data as asker_avatar
           FROM askbox_questions q
           LEFT JOIN profiles p ON p.user_id = q.asker_id
           LEFT JOIN avatars a ON a.user_id = q.asker_id
           WHERE q.answered_at IS NOT NULL
           ORDER BY q.answered_at DESC LIMIT ? OFFSET ?`;
    countSql = `SELECT COUNT(*) as total FROM askbox_questions WHERE answered_at IS NOT NULL`;
    params = [];
  }

  const { results } = await env.DB.prepare(sql).bind(...params, PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare(countSql).bind(...params).first();

  return jsonResponse({
    questions: results,
    pagination: { page, pageSize: PAGE_SIZE, total: countRow?.total || 0 },
  });
};

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  const meta = getRequestMeta(request);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  // 兼容前端 snake_case 与 camelCase
  const targetId = body.targetId || body.target_id;
  const content = body.content;
  const isAnonymous = body.isAnonymous !== undefined ? body.isAnonymous : (body.is_anonymous !== undefined ? body.is_anonymous : true);
  if (!content || typeof content !== 'string' || content.length > 1000) {
    return jsonResponse({ error: 'invalid_content', message: '问题内容不能为空且不超过1000字' }, 400);
  }

  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO askbox_questions (asker_id, target_id, content, is_anonymous, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    user ? user.id : null,
    targetId || null,
    content,
    isAnonymous ? 1 : 0,
    now
  ).run();

  const questionId = result.meta.last_row_id;
  await logActivity(env, meta, user, 'askbox_question', 'askbox', questionId, content, isAnonymous);

  // 发送通知给提问箱主人
  if (targetId) {
    try {
      var askerName = user ? (user.email ? user.email.split('@')[0] : '匿名用户') : '匿名用户';
      var notifContent = (isAnonymous ? '有人' : askerName) + ' 向你提出了一个问题：' + (content.slice(0, 50));
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, type, target_type, target_id, actor_id, actor_email, content_preview, is_read, created_at)
         VALUES (?, 'askbox_question', 'askbox', ?, ?, ?, ?, 0, ?)`
      ).bind(targetId, questionId, user ? user.id : null, user ? user.email : null, notifContent, now).run();
    } catch (e) { console.error('notify fail:', e.message); }
  }

  return jsonResponse({ ok: true, id: questionId });
};

export const onRequest = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (url.pathname === '/askbox/answer' && request.method === 'POST') {
    const user = await getCurrentUser(request, env);
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

    const meta = getRequestMeta(request);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }

    const { questionId, answerContent } = body || {};
    if (!questionId || !answerContent || answerContent.length > 2000) {
      return jsonResponse({ error: 'invalid_params' }, 400);
    }

    const q = await env.DB.prepare(
      `SELECT target_id, content, asker_id, is_anonymous FROM askbox_questions WHERE id = ?`
    ).bind(questionId).first();

    if (!q) return jsonResponse({ error: 'not_found' }, 404);
    if (q.target_id && q.target_id !== user.id) {
      return jsonResponse({ error: 'forbidden', message: '只能回答提给自己的问题' }, 403);
    }

    await env.DB.prepare(
      `UPDATE askbox_questions SET answer_content = ?, answered_at = ? WHERE id = ?`
    ).bind(answerContent, Date.now(), questionId).run();

    await logActivity(env, meta, user, 'askbox_answer', 'askbox', questionId, answerContent, false);

    return jsonResponse({ ok: true });
  }
  return next();
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
};
