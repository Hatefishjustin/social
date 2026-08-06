/**
 * 路径: /functions/askbox/reply.js
 * 路由: /askbox/reply
 * 用途: 已登录提问者与箱主之间的追问对话
 *   - 提问者（本问题 asker_id）：发送 follow_up 追问
 *   - 箱主（本问题 target_id）：发送 owner_reply 回复
 *   - 前提：根问题必须已被箱主回答（answer_content 非空）
 * 权限:
 *   - 仅提问者本人 / 箱主本人可参与线程
 *   - 其他用户 403，未登录 401，匿名游客不可参与
 */

import { getCurrentUser } from '../_lib/auth.js';
import { getRequestMeta } from '../_lib/ip.js';

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

const MAX_LENGTH = 500;

async function logActivity(env, meta, user, action, targetType, targetId, content) {
  try {
    await env.DB.prepare(
      `INSERT INTO activity_log (user_id, user_email, action, target_type, target_id, content, ip, user_agent, country, city, is_anonymous, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
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
      Date.now()
    ).run();
  } catch (e) {
    console.error('activity_log insert failed:', e.message);
  }
}

export const onRequestPost = async ({ request, env }) => {
  const user = await getCurrentUser(request, env);
  if (!user) return jsonResponse({ error: 'unauthorized', message: '请先登录' }, 401);

  const meta = getRequestMeta(request);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const questionId = body ? body.questionId : null;
  const content = (body ? body.content || '' : '').trim();

  if (!questionId) {
    return jsonResponse({ error: 'invalid_params', message: '缺少问题ID' }, 400);
  }
  if (!content) {
    return jsonResponse({ error: 'invalid_content', message: '内容不能为空' }, 400);
  }
  if (content.length > MAX_LENGTH) {
    return jsonResponse({ error: 'too_long', message: '内容不能超过' + MAX_LENGTH + '字' }, 400);
  }

  // 查询根问题，确认参与者身份
  const q = await env.DB.prepare(
    `SELECT id, asker_id, target_id, answer_content FROM askbox_questions WHERE id = ?`
  ).bind(questionId).first();

  if (!q) return jsonResponse({ error: 'not_found' }, 404);

  // 根问题必须已回复（才有对话基础）
  if (!q.answer_content) {
    return jsonResponse({ error: 'not_answered', message: '箱主回答后才能追问' }, 400);
  }

  // 确定发送者角色与消息类型
  let role = null;
  let messageType = null;
  if (q.asker_id && String(q.asker_id) === String(user.id)) {
    role = 'asker';
    messageType = 'follow_up';
  } else if (q.target_id && String(q.target_id) === String(user.id)) {
    role = 'owner';
    messageType = 'owner_reply';
  }

  if (!role) {
    return jsonResponse({ error: 'forbidden', message: '只有提问者和箱主可以参与对话' }, 403);
  }

  const now = Date.now();
  const result = await env.DB.prepare(
    `INSERT INTO askbox_messages (question_id, sender_id, role, message_type, parent_message_id, content, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).bind(questionId, user.id, role, messageType, content, now).run();

  const messageId = result.meta.last_row_id;
  await logActivity(env, meta, user, 'askbox_reply', 'askbox', questionId, content);

  return jsonResponse({ ok: true, id: messageId });
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