/**
 * 路径: /functions/askbox/answer.js
 * 路由: /askbox/answer
 * v2: 回答时支持设置 answer_visibility（public / private）
 */

import { parseCookie, getCurrentUser } from '../_lib/auth.js';

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
    console.error('Activity log failed:', e);
  }
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  const meta = getRequestMeta(request);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { questionId, answerContent, answerVisibility } = body || {};
  if (!questionId || !answerContent || answerContent.length > 2000) {
    return jsonResponse({ error: 'invalid_params' }, 400);
  }

  // 校验可见性值
  const visibility = answerVisibility === 'private' ? 'private' : 'public';

  const q = await env.DB.prepare(
    `SELECT target_id, content, asker_id, is_anonymous FROM askbox_questions WHERE id = ?`
  ).bind(questionId).first();

  if (!q) return jsonResponse({ error: 'not_found' }, 404);
  if (q.target_id && q.target_id !== user.id) {
    return jsonResponse({ error: 'forbidden', message: '只能回答提给自己的问题' }, 403);
  }

  await env.DB.prepare(
    `UPDATE askbox_questions SET answer_content = ?, answered_at = ?, answer_visibility = ? WHERE id = ?`
  ).bind(answerContent, Date.now(), visibility, questionId).run();

  await logActivity(env, meta, user, 'askbox_answer', 'askbox', questionId, answerContent, false);

  return jsonResponse({ ok: true });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};