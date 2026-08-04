/**
 * 路径: /functions/askbox/visibility.js
 * 路由: /askbox/visibility
 * 用途: 箱主修改已回答问题的公开状态（public / private）
 */
import { getCurrentUser } from '../_lib/auth.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const { questionId, answerVisibility } = body || {};
  if (!questionId || !answerVisibility || !['public', 'private'].includes(answerVisibility)) {
    return jsonResponse({ error: 'invalid_params' }, 400);
  }

  // 验证问题存在且当前用户是箱主
  const q = await env.DB.prepare(
    `SELECT target_id, answer_content FROM askbox_questions WHERE id = ?`
  ).bind(questionId).first();

  if (!q) return jsonResponse({ error: 'not_found' }, 404);
  if (!q.target_id || q.target_id !== user.id) {
    return jsonResponse({ error: 'forbidden', message: '只能修改自己提问箱的问题状态' }, 403);
  }
  if (!q.answer_content) {
    return jsonResponse({ error: 'not_answered', message: '只能修改已回答问题的可见性' }, 400);
  }

  await env.DB.prepare(
    `UPDATE askbox_questions SET answer_visibility = ? WHERE id = ? AND target_id = ?`
  ).bind(answerVisibility, questionId, user.id).run();

  return jsonResponse({ ok: true, answerVisibility });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};