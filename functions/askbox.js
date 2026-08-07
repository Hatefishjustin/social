/**
 * 路径: /functions/askbox.js
 * 路由: /askbox
 * v3: 提问箱权限升级
 *      - GET 按 answer_visibility 过滤（游客仅能看到 public，箱主看到全部）
 *      - POST 后端生成 visitor_token 存入 cookie
 */

import { parseCookie, getCurrentUser } from './_lib/auth.js';
import { getRequestMeta } from './_lib/ip.js';

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

  // 获取当前用户身份
  const user = await getCurrentUser(request, env);
  const visitorToken = parseCookie(request.headers.get('Cookie'), 'visitor_token');

  // 构建权限过滤条件：
  // 公开可见: answer_visibility = 'public' OR (已回复但 answer_visibility IS NULL，兼容旧数据)
  // 箱主特权: 当前用户是 target_id → 可见全部
  // 提问者特权: 当前用户是 asker_id → 可见自己的 private
  // 匿名提问者: visitor_token 匹配 → 可见自己的 private
  // 未回复的问题：仅箱主和提问者/匿名提问者可见

  let sql, countSql;
  const allParams = [];

  if (targetId) {
    // 查看特定用户提问箱
    allParams.push(targetId);

    if (user && user.id === parseInt(targetId, 10)) {
      // 箱主本人 → 看到全部
      sql = `SELECT q.id, q.asker_id, q.target_id, q.content, q.is_anonymous, q.created_at, q.answered_at, q.answer_content,
                    q.answer_visibility, q.visitor_token,
                    p.nickname as asker_name, a.image_data as asker_avatar
             FROM askbox_questions q
             LEFT JOIN profiles p ON p.user_id = q.asker_id
             LEFT JOIN avatars a ON a.user_id = q.asker_id
             WHERE q.target_id = ? ORDER BY q.created_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) as total FROM askbox_questions WHERE target_id = ?`;
    } else if (visitorToken) {
      // 有 visitor_token 的访客 → 仅看到「已回复的公开内容」+「自己提问的私密回复」（保持原匿名提问者查看自身私密回复能力）
      // 仅返回已回复内容，且对 SELECT 做脱敏：不返回匿名提问者身份（asker_id/asker_name/asker_avatar）
      // 与 visitor_token 标识本身，避免访客视角泄露隐藏数据。
      sql = `SELECT q.id, q.target_id, q.content, q.is_anonymous, q.created_at, q.answered_at, q.answer_content,
                    q.answer_visibility
             FROM askbox_questions q
             WHERE q.target_id = ? AND q.answered_at IS NOT NULL AND (
               (q.answer_visibility = 'public' OR q.answer_visibility IS NULL)
               OR (q.visitor_token = ?)
             )
             ORDER BY q.answered_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) as total FROM askbox_questions
                  WHERE target_id = ? AND answered_at IS NOT NULL AND (
                    (answer_visibility = 'public' OR answer_visibility IS NULL)
                    OR (visitor_token = ?)
                  )`;
      allParams.push(visitorToken);
    } else {
      // 普通访客（无 token）→ 仅看到「已回复的公开内容」，完全脱敏（不返回访客身份敏感字段）
      sql = `SELECT q.id, q.target_id, q.content, q.is_anonymous, q.created_at, q.answered_at, q.answer_content,
                    q.answer_visibility
             FROM askbox_questions q
             WHERE q.target_id = ? AND q.answered_at IS NOT NULL AND q.answer_visibility = 'public'
             ORDER BY q.answered_at DESC LIMIT ? OFFSET ?`;
      countSql = `SELECT COUNT(*) as total FROM askbox_questions
                  WHERE target_id = ? AND answered_at IS NOT NULL AND answer_visibility = 'public'`;
    }
  } else {
    // 提问广场已下线：无 targetId 的请求不再返回任何公共问答数据
    return jsonResponse({
      questions: [],
      pagination: { page, pageSize: PAGE_SIZE, total: 0 },
    });
  }

  const { results } = await env.DB.prepare(sql).bind(...allParams, PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare(countSql).bind(...allParams).first();

  const questions = results || [];

  // ── 追问对话线程 ──
  // 仅「提问者本人 / 箱主本人」可见；其他访客看不到任何追问内容
  // 访客视角：只看到 问题 + 公开回答（S04 逻辑原样保留）
  if (user && questions.length > 0) {
    try {
      // 当前用户有权限查看线程的问题（作为提问者 asker 或箱主 target）
      const allowedIds = questions
        .filter(q =>
          (q.asker_id != null && String(q.asker_id) === String(user.id)) ||
          (q.target_id != null && String(q.target_id) === String(user.id))
        )
        .map(q => q.id);

      if (allowedIds.length > 0) {
        const placeholders = allowedIds.map(() => '?').join(',');
        const msgRes = await env.DB.prepare(
          `SELECT m.id, m.question_id, m.sender_id, m.role, m.message_type, m.content, m.created_at,
                  u.display_name AS sender_name
           FROM askbox_messages m
           LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.question_id IN (${placeholders})
           ORDER BY m.question_id, m.created_at ASC`
        ).bind(...allowedIds).all();

        const msgMap = {};
        (msgRes.results || []).forEach(m => {
          if (!msgMap[m.question_id]) msgMap[m.question_id] = [];
          msgMap[m.question_id].push(m);
        });
        questions.forEach(q => {
          q.messages_thread = msgMap[q.id] || [];
        });
      } else {
        questions.forEach(q => { q.messages_thread = []; });
      }
    } catch (e) {
      console.error('askbox_messages load failed:', e.message);
      questions.forEach(q => { q.messages_thread = []; });
    }
  } else {
    // 未登录 / 游客：不附加任何线程
    questions.forEach(q => { q.messages_thread = []; });
  }

  return jsonResponse({
    questions,
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

  // 后端生成 visitor_token（仅匿名提问时）
  // 从 cookie 中读取已有 visitor_token，若不存在则生成新的
  let visitorToken = null;
  if (!user || !user.id) {
    // 未登录用户（匿名提问）才生成 visitor_token
    visitorToken = parseCookie(request.headers.get('Cookie'), 'visitor_token');
    if (!visitorToken) {
      visitorToken = crypto.randomUUID();
    }
  }

  const result = await env.DB.prepare(
    `INSERT INTO askbox_questions (asker_id, target_id, content, is_anonymous, created_at, visitor_token)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    user ? user.id : null,
    targetId || null,
    content,
    isAnonymous ? 1 : 0,
    now,
    visitorToken
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

  // 构建响应，如果生成了新的 visitor_token 则设置 cookie
  const responseBody = { ok: true, id: questionId };
  const response = new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

  if (visitorToken) {
    // 设置 visitor_token cookie，有效期 1 年
    const expires = new Date(now + 365 * 24 * 60 * 60 * 1000).toUTCString();
    response.headers.append('Set-Cookie', `visitor_token=${visitorToken}; Expires=${expires}; Path=/; SameSite=Lax`);
  }

  return response;
};

export const onRequest = async ({ request, env, next }) => {
  const url = new URL(request.url);
  // 子路径路由转发
  if ((url.pathname === '/askbox/answer' || url.pathname === '/askbox/visibility') && request.method === 'POST') {
    return next();
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
