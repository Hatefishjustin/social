/**
 * 路径: /functions/askbox.js
 * 路由: /askbox
 *
 * GET  /askbox?targetId=123&page=1   -> 获取提问列表
 * POST /askbox                      -> 提问
 * POST /askbox/answer               -> 回答
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

const PAGE_SIZE = 20;

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const targetId = url.searchParams.get('targetId');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  let sql, countSql, params;
  if (targetId) {
    sql = `SELECT id, asker_id, content, is_anonymous, created_at, answered_at, answer_content
           FROM askbox_questions WHERE target_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    countSql = `SELECT COUNT(*) as total FROM askbox_questions WHERE target_id = ?`;
    params = [targetId];
  } else {
    sql = `SELECT id, asker_id, content, is_anonymous, created_at, answered_at, answer_content
           FROM askbox_questions WHERE answered_at IS NOT NULL
           ORDER BY answered_at DESC LIMIT ? OFFSET ?`;
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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { targetId, content, isAnonymous = true } = body || {};
  if (!content || typeof content !== 'string' || content.length > 1000) {
    return jsonResponse({ error: 'invalid_content', message: '问题内容不能为空且不超过1000字' }, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO askbox_questions (asker_id, target_id, content, is_anonymous, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    user ? user.id : null,
    targetId || null,
    content,
    isAnonymous ? 1 : 0,
    Date.now()
  ).run();

  return jsonResponse({ ok: true, id: result.meta.last_row_id });
};

export const onRequest = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (url.pathname === '/askbox/answer' && request.method === 'POST') {
    const user = await getCurrentUser(request, env);
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

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
      `SELECT target_id FROM askbox_questions WHERE id = ?`
    ).bind(questionId).first();

    if (!q) return jsonResponse({ error: 'not_found' }, 404);
    if (q.target_id && q.target_id !== user.id) {
      return jsonResponse({ error: 'forbidden', message: '只能回答提给自己的问题' }, 403);
    }

    await env.DB.prepare(
      `UPDATE askbox_questions SET answer_content = ?, answered_at = ? WHERE id = ?`
    ).bind(answerContent, Date.now(), questionId).run();

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
